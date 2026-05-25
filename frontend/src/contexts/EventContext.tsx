/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { OpenCodeClient } from '@/api/opencode'
import { listRepos } from '@/api/repos'
import type { PermissionRequest, PermissionResponse, QuestionRequest, SSEEvent, SSHHostKeyRequest, MessageWithParts } from '@/api/types'
import { showToast } from '@/lib/toast'
import { openCodeEventStream, type EventStreamHealthState } from '@/lib/opencode-event-stream'
import { OPENCODE_API_ENDPOINT } from '@/config'
import { addToSessionKeyedState, removeFromSessionKeyedState } from '@/lib/sessionKeyedState'

type PermissionsBySession = Record<string, PermissionRequest[]>
type QuestionsBySession = Record<string, QuestionRequest[]>

type SessionScopedItem = { id: string; sessionID: string }

function groupBySession<T extends SessionScopedItem>(items: T[]): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((grouped, item) => {
    const existing = grouped[item.sessionID] ?? []
    return {
      ...grouped,
      [item.sessionID]: [...existing, item],
    }
  }, {})
}

function sortById<T extends SessionScopedItem>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

function reconcileBySessionForDirectory<T extends SessionScopedItem>(
  prev: Record<string, T[]>,
  directory: string,
  items: T[],
  sessionDirectories: Map<string, string>,
): Record<string, T[]> {
  const grouped = groupBySession(items)
  const next = { ...prev }

  for (const sessionID of Object.keys(prev)) {
    if (grouped[sessionID]) continue
    if (sessionDirectories.get(sessionID) === directory) {
      delete next[sessionID]
    }
  }

  for (const [sessionID, sessionItems] of Object.entries(grouped)) {
    next[sessionID] = sortById(sessionItems)
  }

  return next
}

function optimisticallyErrorToolPart(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionID: string,
  messageID: string,
  callID: string,
  errorMessage: string
) {
  const cache = queryClient.getQueryCache()
  const queries = cache.getAll()
  
  for (const query of queries) {
    const key = query.queryKey
    if (key[0] === 'opencode' && key[1] === 'messages' && key.length >= 5) {
      const querySessionID = key[3] as string
      if (querySessionID !== sessionID) continue
      
      const currentData = queryClient.getQueryData<MessageWithParts[]>(key)
      if (!currentData) continue
      
      const updatedData = currentData.map(msgWithParts => {
        if (msgWithParts.info.id !== messageID) return msgWithParts
        
        const targetPart = msgWithParts.parts.find(p => 
          p.type === 'tool' && 
          'callID' in p && 
          p.callID === callID && 
          'state' in p && 
          p.state && 
          typeof p.state === 'object' && 
          'status' in p.state && 
          (p.state as { status?: string }).status === 'running'
        )
        if (!targetPart) {
          return msgWithParts
        }
        
        const targetPartAny = targetPart as unknown as { state: { status: string; input?: string; time: { start: number } } }
        const targetState = targetPartAny.state
        
        const updatedParts = msgWithParts.parts.map(p => {
          if (p.id !== targetPart.id) return p
          return {
            ...p,
            state: {
              status: 'error' as const,
              input: targetState.input,
              error: errorMessage,
              time: {
                start: targetState.time.start,
                end: Date.now(),
              },
            },
          }
        })
        
        return {
          ...msgWithParts,
          parts: updatedParts,
        }
      })
      
      queryClient.setQueryData(key, updatedData)
      break
    }
  }
}

interface SSHHostKeyState {
  request: SSHHostKeyRequest | null
  respond: (requestId: string, approved: boolean) => Promise<void>
}

interface EventContextValue {
  sshHostKey: SSHHostKeyState
  permissions: {
    current: PermissionRequest | null
    pendingCount: number
    respond: (permissionID: string, sessionID: string, response: PermissionResponse) => Promise<void>
    dismiss: (permissionID: string, sessionID?: string) => void
    getForCallID: (callID: string, sessionID: string) => PermissionRequest | null
    hasForSession: (sessionID: string) => boolean
    showDialog: boolean
    setShowDialog: (show: boolean) => void
    navigateToCurrent: () => void
    syncForSession: (directory: string, sessionID: string) => Promise<void>
  }
  questions: {
    current: QuestionRequest | null
    pendingCount: number
    reply: (requestID: string, answers: string[][]) => Promise<void>
    reject: (requestID: string) => Promise<void>
    dismiss: (requestID: string, sessionID?: string) => void
    getForCallID: (callID: string, sessionID: string) => QuestionRequest | null
    hasForSession: (sessionID: string) => boolean
    navigateToCurrent: () => void
    syncForSession: (directory: string, sessionID: string) => Promise<void>
  }
  sseHealth: EventStreamHealthState
  getRepoIdForSession: (sessionID: string) => number | null
  getClient: (sessionID: string) => OpenCodeClient | null
}

const EventContext = createContext<EventContextValue | null>(null)

export function EventProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [sshHostKeyRequest, setSSHHostKeyRequest] = useState<SSHHostKeyRequest | null>(null)
  const [sseHealth, setSseHealth] = useState<EventStreamHealthState>(() => openCodeEventStream.getHealth())

  const respondToSSHHostKey = useCallback(async (requestId: string, approved: boolean) => {
    try {
      const { respondSSHHostKey } = await import('@/api/ssh')
      await respondSSHHostKey(requestId, approved)
      setSSHHostKeyRequest(null)
    } catch {
      showToast.error('Failed to respond to SSH host key verification')
    }
  }, [])

  const [permissionsBySession, setPermissionsBySession] = useState<PermissionsBySession>({})
  const [questionsBySession, setQuestionsBySession] = useState<QuestionsBySession>({})
  const [showPermissionDialog, setShowPermissionDialog] = useState(true)

  const clientsRef = useRef<Map<string, OpenCodeClient>>(new Map())
  const sessionDirectoriesRef = useRef<Map<string, string>>(new Map())
  const prevPermissionCountRef = useRef(0)
  const initialFetchDoneRef = useRef(false)
  const subscriptionRef = useRef<ReturnType<typeof openCodeEventStream.subscribeGlobalMonitor> | null>(null)
  const reposRef = useRef<typeof repos>(null)
  const MAX_CACHED_CLIENTS = 50

  useEffect(() => {
    const clients = clientsRef.current
    return () => {
      clients.clear()
    }
  }, [])

  const { data: repos } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
  })

  const allPermissions = useMemo(() => Object.values(permissionsBySession).flat(), [permissionsBySession])
  const allQuestions = useMemo(() => Object.values(questionsBySession).flat(), [questionsBySession])

  const currentPermission = allPermissions[0] ?? null
  const currentQuestion = allQuestions[0] ?? null

  const rememberSessionDirectory = useCallback((sessionID: string, directory?: string) => {
    if (!directory) return
    sessionDirectoriesRef.current.set(sessionID, directory)
  }, [])

  const findSessionDirectory = useCallback((sessionID: string): string | null => {
    const remembered = sessionDirectoriesRef.current.get(sessionID)
    if (remembered) return remembered

    const cache = queryClient.getQueryCache()
    const queries = cache.getAll()

    for (const query of queries) {
      const key = query.queryKey
      if (key[0] === 'opencode' && key[1] === 'session' && key.length >= 5) {
        const sessionData = query.state.data as { id: string } | undefined
        if (sessionData?.id === sessionID) {
          const directory = key[4] as string
          if (directory) return directory
        }
      }
    }

    for (const query of queries) {
      const key = query.queryKey
      if (key[0] === 'opencode' && key[1] === 'sessions' && key.length >= 4) {
        const sessionsList = query.state.data as Array<{ id: string }> | undefined
        if (!sessionsList) continue
        const found = sessionsList.find(s => s.id === sessionID)
        if (found) {
          const directory = key[3] as string
          if (directory) return directory
        }
      }
    }

    return null
  }, [queryClient])

  const findSessionInCache = useCallback((sessionID: string): { url: string; directory: string } | null => {
    const directory = findSessionDirectory(sessionID)
    if (!directory) return null
    return { url: OPENCODE_API_ENDPOINT, directory }
  }, [findSessionDirectory])

  const getRepoIdForSession = useCallback((sessionID: string): number | null => {
    if (!repos) return null
    const directory = findSessionDirectory(sessionID)
    if (!directory) return null
    const repo = repos.find(r => r.fullPath === directory)
    return repo?.id ?? null
  }, [repos, findSessionDirectory])

  const getClient = useCallback((sessionID: string): OpenCodeClient | null => {
    const result = findSessionInCache(sessionID)
    if (!result) return null

    const clientKey = `${result.url}|${result.directory}`
    let client = clientsRef.current.get(clientKey)
    if (!client) {
      if (clientsRef.current.size >= MAX_CACHED_CLIENTS) {
        const firstKey = clientsRef.current.keys().next().value
        if (firstKey) clientsRef.current.delete(firstKey)
      }
      client = new OpenCodeClient(result.url, result.directory)
      clientsRef.current.set(clientKey, client)
    }
    return client
  }, [findSessionInCache])

  const addPermission = useCallback((permission: PermissionRequest) => {
    addToSessionKeyedState(setPermissionsBySession, permission)
  }, [])

  const removePermission = useCallback((permissionID: string, sessionID?: string) => {
    removeFromSessionKeyedState(setPermissionsBySession, permissionID, sessionID)
  }, [])

  const addQuestion = useCallback((question: QuestionRequest) => {
    addToSessionKeyedState(setQuestionsBySession, question)
  }, [])

  const removeQuestion = useCallback((requestID: string, sessionID?: string) => {
    removeFromSessionKeyedState(setQuestionsBySession, requestID, sessionID)
  }, [])

  const reconcilePermissionsForDirectory = useCallback((directory: string, permissions: PermissionRequest[]) => {
    permissions.forEach(permission => {
      rememberSessionDirectory(permission.sessionID, directory)
    })

    setPermissionsBySession(prev =>
      reconcileBySessionForDirectory(prev, directory, permissions, sessionDirectoriesRef.current),
    )
  }, [rememberSessionDirectory])

  const reconcileQuestionsForDirectory = useCallback((directory: string, questions: QuestionRequest[]) => {
    questions.forEach(question => {
      rememberSessionDirectory(question.sessionID, directory)
    })

    setQuestionsBySession(prev =>
      reconcileBySessionForDirectory(prev, directory, questions, sessionDirectoriesRef.current),
    )
  }, [rememberSessionDirectory])

  useEffect(() => {
    const permissionCount = allPermissions.length
    if (permissionCount > prevPermissionCountRef.current && permissionCount > 0 && !showPermissionDialog) {
      showToast.info(`${permissionCount} pending permission${permissionCount > 1 ? 's' : ''}`, {
        duration: 5000,
        action: {
          label: 'View',
          onClick: () => setShowPermissionDialog(true),
        },
      })
    }
    prevPermissionCountRef.current = permissionCount
  }, [allPermissions.length, showPermissionDialog])

  const respondToPermission = useCallback(async (permissionID: string, sessionID: string, response: PermissionResponse) => {
    const client = getClient(sessionID)
    if (!client) throw new Error('No client found for session')

    if (response === 'reject') {
      const permission = (permissionsBySession[sessionID] ?? []).find(p => p.id === permissionID)
      if (permission?.tool) {
        optimisticallyErrorToolPart(queryClient, sessionID, permission.tool.messageID, permission.tool.callID, 'Permission denied')
      }
    }

    await client.respondToPermission(sessionID, permissionID, response)
    removePermission(permissionID, sessionID)
  }, [getClient, permissionsBySession, queryClient, removePermission])

  const replyToQuestion = useCallback(async (requestID: string, answers: string[][]) => {
    const question = Object.values(questionsBySession).flat().find(q => q.id === requestID)
    if (!question) throw new Error('Question not found')
    const client = getClient(question.sessionID)
    if (!client) throw new Error('No client found for session')
    await client.replyToQuestion(requestID, answers)
    removeQuestion(requestID, question.sessionID)
  }, [getClient, questionsBySession, removeQuestion])

  const rejectQuestion = useCallback(async (requestID: string) => {
    const question = Object.values(questionsBySession).flat().find(q => q.id === requestID)
    if (!question) throw new Error('Question not found')
    const client = getClient(question.sessionID)
    if (!client) throw new Error('No client found for session')

    if (question.tool) {
      optimisticallyErrorToolPart(queryClient, question.sessionID, question.tool.messageID, question.tool.callID, 'Question rejected')
    }

    await client.rejectQuestion(requestID)
    removeQuestion(requestID, question.sessionID)
  }, [getClient, questionsBySession, queryClient, removeQuestion])

  const getPermissionForCallID = useCallback((callID: string, sessionID: string): PermissionRequest | null => {
    const perms = permissionsBySession[sessionID] ?? []
    return perms.find(p => {
      const metadata = p.metadata as { tool?: { id?: string } } | undefined
      return p.tool?.callID === callID || metadata?.tool?.id === callID
    }) ?? null
  }, [permissionsBySession])

  const getQuestionForCallID = useCallback((callID: string, sessionID: string): QuestionRequest | null => {
    const questions = questionsBySession[sessionID] ?? []
    return questions.find(q => q.tool?.callID === callID) ?? null
  }, [questionsBySession])

  const hasPermissionsForSession = useCallback((sessionID: string): boolean => {
    return (permissionsBySession[sessionID]?.length ?? 0) > 0
  }, [permissionsBySession])

  const hasQuestionsForSession = useCallback((sessionID: string): boolean => {
    return (questionsBySession[sessionID]?.length ?? 0) > 0
  }, [questionsBySession])

  const navigateToCurrentQuestion = useCallback(() => {
    if (!currentQuestion) return
    const repoId = getRepoIdForSession(currentQuestion.sessionID)
    if (repoId) {
      const targetPath = `/repos/${repoId}/sessions/${currentQuestion.sessionID}`
      if (window.location.pathname !== targetPath) {
        navigate(targetPath)
      }
    }
  }, [currentQuestion, getRepoIdForSession, navigate])

  const navigateToCurrentPermission = useCallback(() => {
    if (!currentPermission) return
    const repoId = getRepoIdForSession(currentPermission.sessionID)
    if (repoId) {
      const targetPath = `/repos/${repoId}/sessions/${currentPermission.sessionID}`
      if (window.location.pathname !== targetPath) {
        navigate(targetPath)
      }
    }
  }, [currentPermission, getRepoIdForSession, navigate])

  const fetchInitialPendingData = useCallback(async () => {
    const reposToUse = reposRef.current
    if (!reposToUse || reposToUse.length === 0) return

    const uniqueDirectories = [...new Set(reposToUse.map(r => r.fullPath))]
    
    for (const directory of uniqueDirectories) {
      try {
        const client = new OpenCodeClient(OPENCODE_API_ENDPOINT, directory)
        const pendingPermissions = await client.listPendingPermissions()
        reconcilePermissionsForDirectory(directory, pendingPermissions ?? [])
        const pendingQuestions = await client.listPendingQuestions()
        reconcileQuestionsForDirectory(directory, pendingQuestions ?? [])
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn(`Failed to fetch pending actions for ${directory}:`, error)
        }
      }
    }
  }, [reconcilePermissionsForDirectory, reconcileQuestionsForDirectory])

  const syncPermissionsForSession = useCallback(async (directory: string, sessionID: string) => {
    const client = new OpenCodeClient(OPENCODE_API_ENDPOINT, directory)
    const pendingPermissions = await client.listPendingPermissions()
    rememberSessionDirectory(sessionID, directory)
    reconcilePermissionsForDirectory(directory, pendingPermissions ?? [])
  }, [rememberSessionDirectory, reconcilePermissionsForDirectory])

  const syncQuestionsForSession = useCallback(async (directory: string, sessionID: string) => {
    const client = new OpenCodeClient(OPENCODE_API_ENDPOINT, directory)
    const pendingQuestions = await client.listPendingQuestions()
    rememberSessionDirectory(sessionID, directory)
    reconcileQuestionsForDirectory(directory, pendingQuestions ?? [])
  }, [rememberSessionDirectory, reconcileQuestionsForDirectory])

  useEffect(() => {
    const handleSSEMessage = (data: unknown) => {
      if (!data || typeof data !== 'object' || !('type' in data)) return
      
      const event = data as SSEEvent
      
      switch (event.type) {
        case 'permission.asked':
          if ('permission' in event.properties && 'sessionID' in event.properties) {
            rememberSessionDirectory(event.properties.sessionID as string, event.directory)
            addPermission(event.properties as PermissionRequest)
          }
          break
        case 'permission.replied':
          if ('requestID' in event.properties && 'sessionID' in event.properties) {
            removePermission(
              event.properties.requestID as string,
              event.properties.sessionID as string
            )
          }
          break
        case 'question.asked':
          if ('questions' in event.properties && 'sessionID' in event.properties && 'id' in event.properties) {
            rememberSessionDirectory(event.properties.sessionID as string, event.directory)
            addQuestion(event.properties as QuestionRequest)
          }
          break
        case 'ssh.host-key-request':
          if ('requestId' in event.properties && 'host' in event.properties) {
            setSSHHostKeyRequest(event.properties as SSHHostKeyRequest)
          }
          break
        case 'question.replied':
        case 'question.rejected':
          if ('requestID' in event.properties && 'sessionID' in event.properties) {
            const sessionID = event.properties.sessionID as string
            removeQuestion(
              event.properties.requestID as string,
              sessionID
            )
            queryClient.invalidateQueries({ 
              queryKey: ['opencode', 'messages'],
              predicate: (query) => query.queryKey.includes(sessionID)
            })
          }
          break
        case 'session.updated':
          if ('info' in event.properties) {
            const sessionInfo = event.properties.info as { id: string }
            const cache = queryClient.getQueryCache()
            for (const query of cache.getAll()) {
              const key = query.queryKey
              if (key[0] === 'opencode' && key[1] === 'sessions' && key.length >= 4) {
                const currentList = query.state.data as Array<{ id: string }> | undefined
                if (!currentList) continue
                const exists = currentList.some(s => s.id === sessionInfo.id)
                if (!exists) {
                  queryClient.setQueryData(key, [...currentList, sessionInfo])
                }
              }
            }
          }
          break
        case 'lsp.updated':
          queryClient.invalidateQueries({
            queryKey: ['opencode', 'lsp']
          })
          break
      }
    }

    const handleStatusChange = (connected: boolean) => {
      if (connected) {
        initialFetchDoneRef.current = false
        fetchInitialPendingData()
      }
    }

    const initialDirectories = [...new Set((reposRef.current ?? []).map(r => r.fullPath))]
    const subscription = openCodeEventStream.subscribeGlobalMonitor({
      directories: initialDirectories,
      onEvent: handleSSEMessage,
      onStatusChange: handleStatusChange,
      onHealthChange: setSseHealth,
    })
    subscriptionRef.current = subscription
    
    return () => {
      subscription.dispose()
      subscriptionRef.current = null
    }
  }, [addPermission, removePermission, addQuestion, removeQuestion, rememberSessionDirectory, fetchInitialPendingData, queryClient, setSseHealth])

  useEffect(() => {
    reposRef.current = repos
    const sub = subscriptionRef.current
    if (!sub) return
    const directories = [...new Set((repos ?? []).map(r => r.fullPath))]
    sub.updateDirectories(directories)
  }, [repos])

  useEffect(() => {
    if (!repos || repos.length === 0) return
    if (initialFetchDoneRef.current) return

    initialFetchDoneRef.current = true
    fetchInitialPendingData()
  }, [repos, fetchInitialPendingData])

  const value: EventContextValue = useMemo(() => ({
    sshHostKey: {
      request: sshHostKeyRequest,
      respond: respondToSSHHostKey,
    },
    permissions: {
      current: currentPermission,
      pendingCount: allPermissions.length,
      respond: respondToPermission,
      dismiss: removePermission,
      getForCallID: getPermissionForCallID,
      hasForSession: hasPermissionsForSession,
      showDialog: showPermissionDialog,
      setShowDialog: setShowPermissionDialog,
      navigateToCurrent: navigateToCurrentPermission,
      syncForSession: syncPermissionsForSession,
    },
    questions: {
      current: currentQuestion,
      pendingCount: allQuestions.length,
      reply: replyToQuestion,
      reject: rejectQuestion,
      dismiss: removeQuestion,
      getForCallID: getQuestionForCallID,
      hasForSession: hasQuestionsForSession,
      navigateToCurrent: navigateToCurrentQuestion,
      syncForSession: syncQuestionsForSession,
    },
    sseHealth,
    getRepoIdForSession,
    getClient,
  }), [
    sshHostKeyRequest,
    respondToSSHHostKey,
    currentPermission,
    allPermissions.length,
    respondToPermission,
    removePermission,
    getPermissionForCallID,
    hasPermissionsForSession,
    showPermissionDialog,
    navigateToCurrentPermission,
    syncPermissionsForSession,
    currentQuestion,
    allQuestions.length,
    replyToQuestion,
    rejectQuestion,
    removeQuestion,
    getQuestionForCallID,
    hasQuestionsForSession,
    navigateToCurrentQuestion,
    syncQuestionsForSession,
    sseHealth,
    getRepoIdForSession,
    getClient,
  ])

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>
}

export function useEventContext() {
  const context = useContext(EventContext)
  if (!context) {
    throw new Error('useEventContext must be used within EventProvider')
  }
  return context
}

export function usePermissions() {
  const { permissions } = useEventContext()
  return permissions
}

export function useQuestions() {
  const { questions } = useEventContext()
  return questions
}

export function useSSEHealth(): EventStreamHealthState {
  return useEventContext().sseHealth
}
