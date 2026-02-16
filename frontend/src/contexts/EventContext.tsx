/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { OpenCodeClient } from '@/api/opencode'
import { listRepos } from '@/api/repos'
import type { PermissionRequest, PermissionResponse, QuestionRequest, SSEEvent, SSHHostKeyRequest, MessageWithParts } from '@/api/types'
import { showToast } from '@/lib/toast'
import { subscribeToSSE, addSSEDirectory, ensureSSEConnected } from '@/lib/sseManager'
import { OPENCODE_API_ENDPOINT } from '@/config'
import { addToSessionKeyedState, removeFromSessionKeyedState } from '@/lib/sessionKeyedState'

type PermissionsBySession = Record<string, PermissionRequest[]>
type QuestionsBySession = Record<string, QuestionRequest[]>

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
  }
  getRepoIdForSession: (sessionID: string) => number | null
  getClient: (sessionID: string) => OpenCodeClient | null
}

const EventContext = createContext<EventContextValue | null>(null)

export function EventProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  const [sshHostKeyRequest, setSSHHostKeyRequest] = useState<SSHHostKeyRequest | null>(null)

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
  const prevPermissionCountRef = useRef(0)
  const initialFetchDoneRef = useRef(false)
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

  const getRepoIdForSession = useCallback((sessionID: string): number | null => {
    if (!repos) return null
    
    const cache = queryClient.getQueryCache()
    const queries = cache.getAll()
    
    for (const query of queries) {
      const key = query.queryKey
      if (key[0] === 'opencode' && key[1] === 'session' && key.length >= 5) {
        const sessionData = query.state.data as { id: string } | undefined
        if (sessionData?.id === sessionID) {
          const directory = key[4] as string | undefined
          if (directory) {
            const repo = repos.find(r => r.fullPath === directory)
            if (repo) return repo.id
          }
        }
      }
    }
    return null
  }, [repos, queryClient])

  const getClient = useCallback((sessionID: string): OpenCodeClient | null => {
    const cache = queryClient.getQueryCache()
    const queries = cache.getAll()

    for (const query of queries) {
      const key = query.queryKey
      if (key[0] === 'opencode' && key[1] === 'session' && key.length >= 5) {
        const sessionData = query.state.data as { id: string } | undefined
        if (sessionData?.id === sessionID) {
          const url = key[2] as string
          const directory = key[4] as string | undefined

          if (!url || typeof url !== 'string') continue

          const clientKey = `${url}|${directory ?? ''}`
          let client = clientsRef.current.get(clientKey)
          if (!client) {
            if (clientsRef.current.size >= MAX_CACHED_CLIENTS) {
              const firstKey = clientsRef.current.keys().next().value
              if (firstKey) clientsRef.current.delete(firstKey)
            }
            client = new OpenCodeClient(url, directory)
            clientsRef.current.set(clientKey, client)
          }
          return client
        }
      }
    }
    return null
  }, [queryClient])

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
    const connected = await ensureSSEConnected()
    if (!connected) {
      showToast.error('Unable to connect. Please try again.')
      throw new Error('SSE connection failed')
    }
    const client = getClient(sessionID)
    if (!client) throw new Error('No client found for session')

    if (response === 'reject') {
      const permission = (permissionsBySession[sessionID] ?? []).find(p => p.id === permissionID)
      if (permission?.tool) {
        optimisticallyErrorToolPart(queryClient, sessionID, permission.tool.messageID, permission.tool.callID, 'Permission denied')
      }
    }

    await client.respondToPermission(sessionID, permissionID, response)
  }, [getClient, permissionsBySession, queryClient])

  const replyToQuestion = useCallback(async (requestID: string, answers: string[][]) => {
    const connected = await ensureSSEConnected()
    if (!connected) {
      showToast.error('Unable to connect. Please try again.')
      throw new Error('SSE connection failed')
    }
    const question = Object.values(questionsBySession).flat().find(q => q.id === requestID)
    if (!question) throw new Error('Question not found')
    const client = getClient(question.sessionID)
    if (!client) throw new Error('No client found for session')
    await client.replyToQuestion(requestID, answers)
  }, [getClient, questionsBySession])

  const rejectQuestion = useCallback(async (requestID: string) => {
    const connected = await ensureSSEConnected()
    if (!connected) {
      showToast.error('Unable to connect. Please try again.')
      throw new Error('SSE connection failed')
    }
    const question = Object.values(questionsBySession).flat().find(q => q.id === requestID)
    if (!question) throw new Error('Question not found')
    const client = getClient(question.sessionID)
    if (!client) throw new Error('No client found for session')

    if (question.tool) {
      optimisticallyErrorToolPart(queryClient, question.sessionID, question.tool.messageID, question.tool.callID, 'Question rejected')
    }

    await client.rejectQuestion(requestID)
  }, [getClient, questionsBySession, queryClient])

  const getPermissionForCallID = useCallback((callID: string, sessionID: string): PermissionRequest | null => {
    const perms = permissionsBySession[sessionID] ?? []
    return perms.find(p => {
      const metadata = p.metadata as { tool?: { id?: string } } | undefined
      return metadata?.tool?.id === callID
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
      if (location.pathname !== targetPath) {
        navigate(targetPath)
      }
    }
  }, [currentQuestion, getRepoIdForSession, navigate, location.pathname])

  const fetchInitialPendingData = useCallback(async () => {
    if (!repos || repos.length === 0) return

    const uniqueDirectories = [...new Set(repos.map(r => r.fullPath))]
    
    for (const directory of uniqueDirectories) {
      try {
        const client = new OpenCodeClient(OPENCODE_API_ENDPOINT, directory)
        const pendingQuestions = await client.listPendingQuestions()
        if (pendingQuestions && pendingQuestions.length > 0) {
          pendingQuestions.forEach(addQuestion)
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn(`Failed to fetch pending questions for ${directory}:`, error)
        }
      }
    }
  }, [repos, addQuestion])

  useEffect(() => {
    const handleSSEMessage = (data: unknown) => {
      if (!data || typeof data !== 'object' || !('type' in data)) return
      
      const event = data as SSEEvent
      
      switch (event.type) {
        case 'permission.asked':
          if ('permission' in event.properties && 'sessionID' in event.properties) {
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
      }
    }

    const handleStatusChange = (connected: boolean) => {
      if (connected) {
        initialFetchDoneRef.current = false
        fetchInitialPendingData()
      }
    }

    const unsubscribe = subscribeToSSE(handleSSEMessage, handleStatusChange)
    return unsubscribe
  }, [addPermission, removePermission, addQuestion, removeQuestion, fetchInitialPendingData, queryClient])

  useEffect(() => {
    if (!repos || repos.length === 0) return

    const cleanupFns: (() => void)[] = []
    const uniqueDirectories = [...new Set(repos.map(r => r.fullPath))]

    uniqueDirectories.forEach(directory => {
      const cleanup = addSSEDirectory(directory)
      cleanupFns.push(cleanup)
    })

    return () => {
      cleanupFns.forEach(fn => fn())
    }
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
    },
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
    currentQuestion,
    allQuestions.length,
    replyToQuestion,
    rejectQuestion,
    removeQuestion,
    getQuestionForCallID,
    hasQuestionsForSession,
    navigateToCurrentQuestion,
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
