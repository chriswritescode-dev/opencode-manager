/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import {
  cancelForm,
  listPendingForms,
  listPendingPermissions,
  replyForm,
  replyPermission,
} from '@/api/opencode'
import { listRepos } from '@/api/repos'
import type { FormAnswer, FormInfo, PermissionRequest, V2Event } from '@opencode-manager/shared/opencode'
import type { PermissionResponse, SSHHostKeyRequest, Repo } from '@/api/types'
import { showToast } from '@/lib/toast'
import { openCodeEventStream, type EventStreamHealthState } from '@/lib/opencode-event-stream'
import { addToSessionKeyedState, removeFromSessionKeyedState } from '@/lib/sessionKeyedState'
import { invalidateProviderCaches, invalidateRepoGitCachesDebounced } from '@/lib/queryInvalidation'

type PermissionsBySession = Record<string, PermissionRequest[]>
type FormsBySession = Record<string, FormInfo[]>
type SSEHealthState = Pick<EventStreamHealthState, 'isConnected' | 'isHealthy' | 'isStalled'>
type StreamEvent = (V2Event & { directory?: string }) | { type: 'ssh.host-key-request'; properties: SSHHostKeyRequest }

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

function normalizeDirectory(directory?: string | null) {
  return directory?.replace(/\/+$/, '') ?? null
}

function repoMatchesDirectory(repo: Repo, directory?: string | null) {
  const normalizedDirectory = normalizeDirectory(directory)
  if (!normalizedDirectory) return false

  return [repo.fullPath, repo.localPath, repo.sourcePath]
    .some((path) => normalizeDirectory(path) === normalizedDirectory)
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

interface SSHHostKeyState {
  request: SSHHostKeyRequest | null
  respond: (requestId: string, approved: boolean) => Promise<void>
}

interface EventContextValue {
  sshHostKey: SSHHostKeyState
  permissions: {
    current: PermissionRequest | null
    pendingCount: number
    respond: (
      permissionID: string,
      sessionID: string,
      response: PermissionResponse,
      message?: string,
    ) => Promise<void>
    dismiss: (permissionID: string, sessionID?: string) => void
    hasForSession: (sessionID: string) => boolean
    showDialog: boolean
    setShowDialog: (show: boolean) => void
    navigateToCurrent: () => void
    syncForSession: (directory: string, sessionID: string) => Promise<void>
  }
  forms: {
    current: FormInfo | null
    pendingCount: number
    reply: (formID: string, answer: FormAnswer) => Promise<void>
    cancel: (formID: string) => Promise<void>
    dismiss: (formID: string, sessionID?: string) => void
    getForSession: (sessionID: string) => FormInfo | null
    hasForSession: (sessionID: string) => boolean
    navigateToCurrent: () => void
    syncForSession: (directory: string, sessionID: string) => Promise<void>
  }
  sseHealth: SSEHealthState
  getRepoIdForSession: (sessionID: string) => number | null
}

const EventContext = createContext<EventContextValue | null>(null)

export function EventProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [sshHostKeyRequest, setSSHHostKeyRequest] = useState<SSHHostKeyRequest | null>(null)
  const [sseHealth, setSseHealth] = useState<SSEHealthState>(() => {
    const { isConnected, isHealthy, isStalled } = openCodeEventStream.getHealth()
    return { isConnected, isHealthy, isStalled }
  })

  const respondToSSHHostKey = useCallback(async (requestId: string, approved: boolean) => {
    try {
      const { respondSSHHostKey } = await import('@/api/ssh')
      await respondSSHHostKey(requestId, approved)
      setSSHHostKeyRequest(null)
    } catch {
      showToast.error('Failed to respond to SSH host key verification')
    }
  }, [])

  const handleHealthChange = useCallback((next: EventStreamHealthState) => {
    setSseHealth((prev) => {
      if (prev.isConnected === next.isConnected && prev.isHealthy === next.isHealthy && prev.isStalled === next.isStalled) {
        return prev
      }
      return { isConnected: next.isConnected, isHealthy: next.isHealthy, isStalled: next.isStalled }
    })
  }, [])

  const [permissionsBySession, setPermissionsBySession] = useState<PermissionsBySession>({})
  const [formsBySession, setFormsBySession] = useState<FormsBySession>({})
  const [showPermissionDialog, setShowPermissionDialog] = useState(true)

  const sessionDirectoriesRef = useRef<Map<string, string>>(new Map())
  const prevPermissionCountRef = useRef(0)
  const initialFetchDoneRef = useRef(false)
  const subscriptionRef = useRef<ReturnType<typeof openCodeEventStream.subscribeGlobalMonitor> | null>(null)
  const reposRef = useRef<typeof repos>(null)

  const { data: repos } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
  })

  const allPermissions = useMemo(() => Object.values(permissionsBySession).flat(), [permissionsBySession])
  const allForms = useMemo(() => Object.values(formsBySession).flat(), [formsBySession])

  const currentPermission = allPermissions[0] ?? null
  const currentForm = allForms[0] ?? null

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
      if (key[0] !== 'opencode' || key[1] !== 'session' || key[2] !== sessionID) continue

      const sessionData = query.state.data as { location?: { directory?: string } } | undefined
      const directory = sessionData?.location?.directory ?? (typeof key[3] === 'string' ? key[3] : null)
      if (directory) return directory
    }

    for (const query of queries) {
      const key = query.queryKey
      if (key[0] !== 'opencode' || key[1] !== 'sessions') continue

      const sessionsData = query.state.data
      if (!sessionsData || typeof sessionsData !== 'object' || !('pages' in sessionsData)) continue

      const pages = (sessionsData as {
        pages?: Array<{ items?: Array<{ id: string; location?: { directory?: string } }> }>
      }).pages
      if (!Array.isArray(pages)) continue

      for (const page of pages) {
        const found = page.items?.find(s => s.id === sessionID)
        const directory = found?.location?.directory
        if (directory) return directory
      }
    }

    return null
  }, [queryClient])

  const getRepoIdForSession = useCallback((sessionID: string): number | null => {
    if (!repos) return null
    const directory = findSessionDirectory(sessionID)
    if (!directory) return null
    const repo = repos.find(r => repoMatchesDirectory(r, directory))
    return repo?.id ?? null
  }, [repos, findSessionDirectory])

  const addPermission = useCallback((permission: PermissionRequest) => {
    addToSessionKeyedState(setPermissionsBySession, permission)
  }, [])

  const removePermission = useCallback((permissionID: string, sessionID?: string) => {
    removeFromSessionKeyedState(setPermissionsBySession, permissionID, sessionID)
  }, [])

  const addForm = useCallback((form: FormInfo) => {
    addToSessionKeyedState(setFormsBySession, form)
  }, [])

  const removeForm = useCallback((formID: string, sessionID?: string) => {
    removeFromSessionKeyedState(setFormsBySession, formID, sessionID)
  }, [])

  const reconcilePermissionsForDirectory = useCallback((directory: string, permissions: PermissionRequest[]) => {
    permissions.forEach(permission => {
      rememberSessionDirectory(permission.sessionID, directory)
    })

    setPermissionsBySession(prev =>
      reconcileBySessionForDirectory(prev, directory, permissions, sessionDirectoriesRef.current),
    )
  }, [rememberSessionDirectory])

  const reconcileFormsForDirectory = useCallback((directory: string, forms: FormInfo[]) => {
    forms.forEach(form => {
      rememberSessionDirectory(form.sessionID, directory)
    })

    setFormsBySession(prev =>
      reconcileBySessionForDirectory(prev, directory, forms, sessionDirectoriesRef.current),
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

  const replyToPermission = useCallback(async (
    permissionID: string,
    sessionID: string,
    response: PermissionResponse,
    message?: string,
  ) => {
    await replyPermission(sessionID, permissionID, response, message)
    removePermission(permissionID, sessionID)
  }, [removePermission])

  const replyToForm = useCallback(async (formID: string, answer: FormAnswer) => {
    const form = Object.values(formsBySession).flat().find(f => f.id === formID)
    if (!form) throw new Error('Form not found')
    await replyForm(form.sessionID, formID, answer)
    removeForm(formID, form.sessionID)
  }, [formsBySession, removeForm])

  const cancelPendingForm = useCallback(async (formID: string) => {
    const form = Object.values(formsBySession).flat().find(f => f.id === formID)
    if (!form) throw new Error('Form not found')
    await cancelForm(form.sessionID, formID)
    removeForm(formID, form.sessionID)
  }, [formsBySession, removeForm])

  const hasPermissionsForSession = useCallback((sessionID: string): boolean => {
    return (permissionsBySession[sessionID]?.length ?? 0) > 0
  }, [permissionsBySession])

  const getFormForSession = useCallback((sessionID: string): FormInfo | null => {
    return formsBySession[sessionID]?.[0] ?? null
  }, [formsBySession])

  const hasFormsForSession = useCallback((sessionID: string): boolean => {
    return (formsBySession[sessionID]?.length ?? 0) > 0
  }, [formsBySession])

  const navigateToCurrentForm = useCallback(() => {
    if (!currentForm) return
    const repoId = getRepoIdForSession(currentForm.sessionID)
    if (repoId) {
      const targetPath = `/repos/${repoId}/sessions/${currentForm.sessionID}`
      if (window.location.pathname !== targetPath) {
        navigate(targetPath)
      }
    }
  }, [currentForm, getRepoIdForSession, navigate])

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

  const reconcilePendingActionsForDirectories = useCallback(async (directories: string[]) => {
    await Promise.all(directories.map(async (directory) => {
      try {
        const [pendingPermissions, pendingForms] = await Promise.all([
          listPendingPermissions(directory),
          listPendingForms(directory),
        ])
        reconcilePermissionsForDirectory(directory, pendingPermissions)
        reconcileFormsForDirectory(directory, pendingForms)
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn(`Failed to fetch pending actions for ${directory}:`, error)
        }
      }
    }))
  }, [reconcilePermissionsForDirectory, reconcileFormsForDirectory])

  const collectTrackedDirectories = useCallback((): string[] => {
    const directories = new Set<string>()
    for (const repo of reposRef.current ?? []) {
      if (repo.fullPath) directories.add(repo.fullPath)
    }
    for (const directory of sessionDirectoriesRef.current.values()) {
      if (directory) directories.add(directory)
    }
    return [...directories]
  }, [])

  const fetchInitialPendingData = useCallback(async () => {
    const reposToUse = reposRef.current
    if (!reposToUse || reposToUse.length === 0) return

    await reconcilePendingActionsForDirectories([...new Set(reposToUse.map(r => r.fullPath))])
  }, [reconcilePendingActionsForDirectories])

  const syncPermissionsForSession = useCallback(async (directory: string, sessionID: string) => {
    const pendingPermissions = await listPendingPermissions(directory)
    rememberSessionDirectory(sessionID, directory)
    reconcilePermissionsForDirectory(directory, pendingPermissions)
  }, [rememberSessionDirectory, reconcilePermissionsForDirectory])

  const syncFormsForSession = useCallback(async (directory: string, sessionID: string) => {
    const pendingForms = await listPendingForms(directory)
    rememberSessionDirectory(sessionID, directory)
    reconcileFormsForDirectory(directory, pendingForms)
  }, [rememberSessionDirectory, reconcileFormsForDirectory])

  useEffect(() => {
    const handleSSEMessage = (data: unknown) => {
      if (!data || typeof data !== 'object' || !('type' in data)) return
      
      const event = data as StreamEvent

      switch (event.type) {
        case 'permission.asked': {
          const request = event.data
          rememberSessionDirectory(request.sessionID, event.directory)
          addPermission(request)
          break
        }
        case 'permission.replied': {
          const { requestID, sessionID } = event.data
          removePermission(requestID, sessionID)
          break
        }
        case 'form.created': {
          const form = event.data.form
          rememberSessionDirectory(form.sessionID, event.directory)
          addForm(form)
          break
        }
        case 'form.replied':
        case 'form.cancelled': {
          const { id, sessionID } = event.data
          removeForm(id, sessionID)
          break
        }
        case 'credential.updated':
        case 'credential.switched':
        case 'integration.updated':
        case 'provider.updated':
        case 'model.updated':
          invalidateProviderCaches(queryClient)
          break
        case 'ssh.host-key-request':
          setSSHHostKeyRequest(event.properties)
          break
        case 'vcs.branch.updated': {
          const repo = reposRef.current?.find((candidate) => repoMatchesDirectory(candidate, event.directory))
          if (!repo) break

          const branch = event.data.branch
          if (branch) {
            const updatedRepo = { ...repo, currentBranch: branch, branch }
            queryClient.setQueryData(['repo', repo.id], updatedRepo)
            queryClient.setQueryData<Repo[]>(['repos'], (current) =>
              current?.map((candidate) => candidate.id === repo.id ? updatedRepo : candidate)
            )
          }

          invalidateRepoGitCachesDebounced(queryClient, repo.id)
          break
        }
      }
    }

    const handleStatusChange = (connected: boolean) => {
      if (connected) {
        initialFetchDoneRef.current = false
        fetchInitialPendingData()
      }
    }

    const handleResync = () => {
      void reconcilePendingActionsForDirectories(collectTrackedDirectories())
    }

    const initialDirectories = [...new Set((reposRef.current ?? []).map(r => r.fullPath))]
    const subscription = openCodeEventStream.subscribeGlobalMonitor({
      directories: initialDirectories,
      onEvent: handleSSEMessage,
      onStatusChange: handleStatusChange,
      onHealthChange: handleHealthChange,
      onResync: handleResync,
    })
    subscriptionRef.current = subscription
    
    return () => {
      subscription.dispose()
      subscriptionRef.current = null
    }
  }, [addPermission, removePermission, addForm, removeForm, rememberSessionDirectory, fetchInitialPendingData, queryClient, handleHealthChange, reconcilePendingActionsForDirectories, collectTrackedDirectories])

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
      respond: replyToPermission,
      dismiss: removePermission,
      hasForSession: hasPermissionsForSession,
      showDialog: showPermissionDialog,
      setShowDialog: setShowPermissionDialog,
      navigateToCurrent: navigateToCurrentPermission,
      syncForSession: syncPermissionsForSession,
    },
    forms: {
      current: currentForm,
      pendingCount: allForms.length,
      reply: replyToForm,
      cancel: cancelPendingForm,
      dismiss: removeForm,
      getForSession: getFormForSession,
      hasForSession: hasFormsForSession,
      navigateToCurrent: navigateToCurrentForm,
      syncForSession: syncFormsForSession,
    },
    sseHealth,
    getRepoIdForSession,
  }), [
    sshHostKeyRequest,
    respondToSSHHostKey,
    currentPermission,
    allPermissions.length,
    replyToPermission,
    removePermission,
    hasPermissionsForSession,
    showPermissionDialog,
    navigateToCurrentPermission,
    syncPermissionsForSession,
    currentForm,
    allForms.length,
    replyToForm,
    cancelPendingForm,
    removeForm,
    getFormForSession,
    hasFormsForSession,
    navigateToCurrentForm,
    syncFormsForSession,
    sseHealth,
    getRepoIdForSession,
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

export function useForms() {
  const { forms } = useEventContext()
  return forms
}

export function useSSEHealth(): SSEHealthState {
  return useEventContext().sseHealth
}
