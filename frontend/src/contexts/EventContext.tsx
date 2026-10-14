/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import {
  cancelForm,
  getSession,
  listActiveSessions,
  listPendingForms,
  listPendingPermissions,
  listShells,
  replyForm,
  replyPermission,
} from '@/api/opencode'
import { listRepos } from '@/api/repos'
import { FetchError } from '@opencode-manager/shared'
import type { FormAnswer, FormInfo, PermissionRequest, V2Event } from '@opencode-manager/shared/opencode'
import type { PermissionResponse, SSHHostKeyRequest, Repo } from '@/api/types'
import { showToast } from '@/lib/toast'
import { openCodeEventStream, type EventStreamHealthState } from '@/lib/opencode-event-stream'
import { addToSessionKeyedState, removeFromSessionKeyedState } from '@/lib/sessionKeyedState'
import { getSessionPath, parseRepoRoute } from '@/lib/navigation'
import { changeWalkthroughQueryKey } from '@/hooks/useChangeWalkthrough'
import { busyStatusesFromActiveSessions, useSessionStatus } from '@/stores/sessionStatusStore'
import {
  invalidateChildSessionCaches,
  invalidateProviderCachesDebounced,
  invalidateQueryKeysDebounced,
  invalidateRepoGitCachesDebounced,
  invalidateSessionListCachesDebounced,
} from '@/lib/queryInvalidation'

const STATUS_POLL_INTERVAL_MS = 5000

const LOCATION_CATALOG_QUERY_KEYS = [
  ['opencode', 'commands'],
  ['opencode', 'agents'],
  ['opencode', 'skills'],
  ['opencode', 'providers'],
] as const

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

function isSessionWithinView(
  sessionID: string,
  viewedSessionID: string,
  parents: Map<string, string | null>,
): boolean {
  const visited = new Set<string>()
  let currentID: string | null = sessionID

  while (currentID !== null && !visited.has(currentID)) {
    if (currentID === viewedSessionID) return true
    visited.add(currentID)
    currentID = parents.get(currentID) ?? null
  }

  return false
}

/**
 * Pins the item currently on screen until it leaves `items`, then advances to the first item whose
 * session is the viewed session or one of its descendants, falling back to the first item.
 * The selection is derived during render so a newly arriving item never displaces the shown one.
 */
function usePinnedViewedItem<T extends SessionScopedItem>(
  items: T[],
  viewedSessionId: string | null,
  parents: Map<string, string | null>,
): T | null {
  const [pinnedId, setPinnedId] = useState<string | null>(null)

  const selected = useMemo(() => {
    if (pinnedId) {
      const pinned = items.find((item) => item.id === pinnedId)
      if (pinned) return pinned
    }

    const forViewedSession = viewedSessionId
      ? items.find((item) => isSessionWithinView(item.sessionID, viewedSessionId, parents)) ?? null
      : null
    return forViewedSession ?? items[0] ?? null
  }, [items, viewedSessionId, parents, pinnedId])

  const selectedId = selected?.id ?? null
  if (selectedId !== pinnedId) setPinnedId(selectedId)

  return selected
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
    /**
     * Session currently being viewed from the route, or null when no session route is active.
     */
    viewedSessionId: string | null
    /**
     * Directory of the current permission's session, resolved from tracked events and the query cache.
     */
    currentDirectory: string | null
    /**
     * True when a session is being viewed and the current permission belongs to neither that session
     * nor one of its descendants.
     */
    currentIsFromDifferentSession: boolean
    /**
     * Replies to a permission request and removes it from the queue. Resolves, after showing an
     * "expired" toast, when the server no longer knows the request (`PermissionNotFoundError`);
     * rejects on any other failure and keeps the request queued.
     */
    respond: (
      permissionID: string,
      sessionID: string,
      response: PermissionResponse,
      message?: string,
    ) => Promise<void>
    dismiss: (permissionID: string, sessionID?: string) => void
    getForToolCall: (toolCallID: string, messageID?: string) => PermissionRequest | null
    hasForSession: (sessionID: string) => boolean
    showDialog: boolean
    setShowDialog: (show: boolean) => void
    navigateToCurrent: () => void
    syncForSession: (directory: string, sessionID: string) => Promise<void>
  }
  forms: {
    current: FormInfo | null
    pendingCount: number
    /**
     * Answers a form and removes it from the queue. Resolves, after showing an "expired" toast,
     * when the server no longer knows the form (`FormNotFoundError`); rejects on any other failure.
     */
    reply: (formID: string, answer: FormAnswer) => Promise<void>
    /**
     * Dismisses a form on the server and removes it from the queue, with the same
     * resolve-on-`FormNotFoundError` contract as `reply`.
     */
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

/**
 * Sends a reply to a pending server request and treats the request as settled when the server
 * reports it no longer exists (`goneCode`), showing `expiredMessage` instead of rejecting.
 * Every other failure is rethrown.
 */
async function settlePendingReply(
  reply: () => Promise<void>,
  goneCode: string,
  expiredMessage: string,
): Promise<void> {
  try {
    await reply()
  } catch (error) {
    if (!(error instanceof FetchError && error.code === goneCode)) throw error
    showToast.info(expiredMessage)
  }
}

const EventContext = createContext<EventContextValue | null>(null)

export function EventProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const sessionParents = useSessionStatus((state) => state.parents)

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
  const statusSyncVersionRef = useRef(0)
  const statusPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const subscriptionRef = useRef<ReturnType<typeof openCodeEventStream.subscribeGlobalMonitor> | null>(null)
  const reposRef = useRef<typeof repos>(null)
  const trackedRepoDirectoriesRef = useRef<Set<string>>(new Set())
  const ancestryInFlightRef = useRef<Set<string>>(new Set())

  const { data: repos } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
  })

  const allPermissions = useMemo(() => Object.values(permissionsBySession).flat(), [permissionsBySession])
  const allForms = useMemo(() => Object.values(formsBySession).flat(), [formsBySession])

  const viewedSessionId = useMemo(
    () => parseRepoRoute(location.pathname).sessionId,
    [location.pathname],
  )

  const currentPermission = usePinnedViewedItem(allPermissions, viewedSessionId, sessionParents)

  const currentForm = usePinnedViewedItem(allForms, viewedSessionId, sessionParents)

  const rememberSessionDirectory = useCallback((sessionID: string, directory?: string) => {
    if (!directory) return
    sessionDirectoriesRef.current.set(sessionID, directory)
  }, [])

  const findCachedSessionDirectory = useCallback((sessionID: string): string | null => {
    const cache = queryClient.getQueryCache()
    const queries = cache.getAll()

    let directory: string | undefined

    for (const query of queries) {
      const key = query.queryKey
      if (key[0] !== 'opencode' || key[1] !== 'session' || key[2] !== sessionID) continue

      const sessionData = query.state.data as { location?: { directory?: string } } | undefined
      const resolvedDirectory = sessionData?.location?.directory
        ?? (typeof key[3] === 'string' ? key[3] : undefined)
      if (resolvedDirectory) {
        directory = resolvedDirectory
        break
      }
    }

    if (!directory) {
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
          if (found?.location?.directory) {
            directory = found.location.directory
            break
          }
        }
        if (directory) break
      }
    }

    return directory ?? null
  }, [queryClient])

  const findSessionDirectory = useCallback((sessionID: string): string | null => {
    const remembered = sessionDirectoriesRef.current.get(sessionID)
    if (remembered) return remembered
    return findCachedSessionDirectory(sessionID)
  }, [findCachedSessionDirectory])

  const getRepoIdForSession = useCallback((sessionID: string): number | null => {
    if (!repos) return null
    const directory = findSessionDirectory(sessionID)
    if (!directory) return null
    const repo = repos.find(r => repoMatchesDirectory(r, directory))
    return repo?.id ?? null
  }, [repos, findSessionDirectory])

  const currentPermissionDirectory = useMemo(
    () => (currentPermission ? findSessionDirectory(currentPermission.sessionID) : null),
    [currentPermission, findSessionDirectory],
  )

  const currentIsFromDifferentSession = viewedSessionId !== null
    && currentPermission !== null
    && !isSessionWithinView(currentPermission.sessionID, viewedSessionId, sessionParents)

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
    await settlePendingReply(
      () => replyPermission(sessionID, permissionID, response, message),
      'PermissionNotFoundError',
      'Permission request expired',
    )
    removePermission(permissionID, sessionID)
  }, [removePermission])

  const replyToForm = useCallback(async (formID: string, answer: FormAnswer) => {
    const form = Object.values(formsBySession).flat().find(f => f.id === formID)
    if (!form) throw new Error('Form not found')
    await settlePendingReply(() => replyForm(form.sessionID, formID, answer), 'FormNotFoundError', 'Form expired')
    removeForm(formID, form.sessionID)
  }, [formsBySession, removeForm])

  const cancelPendingForm = useCallback(async (formID: string) => {
    const form = Object.values(formsBySession).flat().find(f => f.id === formID)
    if (!form) throw new Error('Form not found')
    await settlePendingReply(() => cancelForm(form.sessionID, formID), 'FormNotFoundError', 'Form expired')
    removeForm(formID, form.sessionID)
  }, [formsBySession, removeForm])

  const hasPermissionsForSession = useCallback((sessionID: string): boolean => {
    return (permissionsBySession[sessionID]?.length ?? 0) > 0
  }, [permissionsBySession])

  const getPermissionForToolCall = useCallback((
    toolCallID: string,
    messageID?: string,
  ): PermissionRequest | null => {
    const match = allPermissions.find(
      (permission) =>
        permission.source?.type === 'tool' &&
        permission.source.id === toolCallID &&
        (messageID === undefined || permission.source.messageID === messageID),
    )
    return match ?? null
  }, [allPermissions])

  const getFormForSession = useCallback((sessionID: string): FormInfo | null => {
    return formsBySession[sessionID]?.[0] ?? null
  }, [formsBySession])

  const hasFormsForSession = useCallback((sessionID: string): boolean => {
    return (formsBySession[sessionID]?.length ?? 0) > 0
  }, [formsBySession])

  const navigateToSession = useCallback((sessionID: string) => {
    const repoId = getRepoIdForSession(sessionID)
    if (repoId === null) return
    const targetPath = getSessionPath(repoId, sessionID)
    if (`${window.location.pathname}${window.location.search}` !== targetPath) {
      navigate(targetPath)
    }
  }, [getRepoIdForSession, navigate])

  const navigateToCurrentForm = useCallback(() => {
    if (!currentForm) return
    navigateToSession(currentForm.sessionID)
  }, [currentForm, navigateToSession])

  const navigateToCurrentPermission = useCallback(() => {
    if (!currentPermission) return
    navigateToSession(currentPermission.sessionID)
  }, [currentPermission, navigateToSession])

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

  const resolveSessionAncestry = useCallback(async (sessionIDs: string[]) => {
    const resolveUp = async (startID: string): Promise<void> => {
      let currentID: string | null = startID
      const visited = new Set<string>()
      while (currentID !== null) {
        if (visited.has(currentID)) return
        visited.add(currentID)

        const parents = useSessionStatus.getState().parents
        if (parents.has(currentID)) {
          currentID = parents.get(currentID) ?? null
          continue
        }
        if (ancestryInFlightRef.current.has(currentID)) return

        const lookupID = currentID
        ancestryInFlightRef.current.add(lookupID)
        try {
          const session = await getSession(lookupID)
          useSessionStatus.getState().setSessionParent(lookupID, session.parentID ?? null)
          currentID = session.parentID ?? null
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn(`Failed to resolve session ancestry for ${lookupID}:`, error)
          }
          return
        } finally {
          ancestryInFlightRef.current.delete(lookupID)
        }
      }
    }

    await Promise.allSettled(sessionIDs.map((sessionID) => resolveUp(sessionID)))
  }, [])

  const syncRunningShells = useCallback(async (directories: string[]) => {
    await Promise.all(directories.map(async (directory) => {
      const token = useSessionStatus.getState().beginShellSnapshot()
      try {
        const shells = await listShells(directory)
        const runningShells = shells.flatMap((shell) => {
          const sessionID = shell.metadata.sessionID
          if (shell.status !== 'running' || typeof sessionID !== 'string') return []
          return [{ id: shell.id, sessionID }]
        })
        useSessionStatus.getState().replaceRunningShells(directory, runningShells, token)
        await resolveSessionAncestry(runningShells.map((shell) => shell.sessionID))
      } catch (error) {
        useSessionStatus.getState().endShellSnapshot(token)
        if (import.meta.env.DEV) {
          console.warn(`Failed to fetch running shells for ${directory}:`, error)
        }
      }
    }))
  }, [resolveSessionAncestry])

  const fetchInitialPendingData = useCallback(async () => {
    const reposToUse = reposRef.current
    if (!reposToUse || reposToUse.length === 0) return

    await reconcilePendingActionsForDirectories([...new Set(reposToUse.map(r => r.fullPath))])
  }, [reconcilePendingActionsForDirectories])

  const fetchInitialSessionStatuses = useCallback(async () => {
    const syncVersion = ++statusSyncVersionRef.current
    const snapshotToken = useSessionStatus.getState().beginStatusSnapshot()

    try {
      const active = await listActiveSessions()
      if (statusSyncVersionRef.current !== syncVersion) {
        useSessionStatus.getState().endStatusSnapshot(snapshotToken)
        return
      }
      const busyBeforeSnapshot = new Set<string>()
      for (const [sessionID, status] of useSessionStatus.getState().statuses.entries()) {
        if (status.type !== 'idle') busyBeforeSnapshot.add(sessionID)
      }
      useSessionStatus.getState().replaceStatuses(
        busyStatusesFromActiveSessions(active),
        snapshotToken,
      )
      const knownAfterSnapshot = useSessionStatus.getState().knownSessions
      const becameUnknown = [...busyBeforeSnapshot].filter(
        (sessionID) => !knownAfterSnapshot.has(sessionID),
      )
      if (becameUnknown.length > 0) {
        invalidateChildSessionCaches(queryClient, becameUnknown)
      }
      await resolveSessionAncestry(Object.keys(active))
    } catch (error) {
      useSessionStatus.getState().endStatusSnapshot(snapshotToken)
      if (import.meta.env.DEV) {
        console.warn('Failed to fetch active sessions:', error)
      }
    }
  }, [queryClient, resolveSessionAncestry])

  const stopStatusPoll = useCallback(() => {
    if (statusPollIntervalRef.current === null) return
    clearInterval(statusPollIntervalRef.current)
    statusPollIntervalRef.current = null
  }, [])

  const startStatusPoll = useCallback(() => {
    stopStatusPoll()
    statusPollIntervalRef.current = setInterval(() => {
      void fetchInitialSessionStatuses()
    }, STATUS_POLL_INTERVAL_MS)
  }, [fetchInitialSessionStatuses, stopStatusPoll])

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
          if (!useSessionStatus.getState().parents.has(request.sessionID)) {
            void resolveSessionAncestry([request.sessionID])
          }
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
          if (!useSessionStatus.getState().parents.has(form.sessionID)) {
            void resolveSessionAncestry([form.sessionID])
          }
          break
        }
        case 'form.replied':
        case 'form.cancelled': {
          const { id, sessionID } = event.data
          removeForm(id, sessionID)
          break
        }
        case 'session.status': {
          const { sessionID, status } = event.data
          useSessionStatus.getState().setStatus(sessionID, status)
          break
        }
        case 'session.idle': {
          useSessionStatus.getState().setStatus(event.data.sessionID, { type: 'idle' })
          break
        }
        case 'session.execution.started': {
          useSessionStatus.getState().clearOutcome(event.data.sessionID)
          useSessionStatus.getState().setStatus(event.data.sessionID, { type: 'busy' })
          break
        }
        case 'session.execution.succeeded': {
          useSessionStatus.getState().setOutcome(event.data.sessionID, 'succeeded')
          useSessionStatus.getState().setStatus(event.data.sessionID, { type: 'idle' })
          invalidateSessionListCachesDebounced(queryClient, event.directory)
          queryClient.invalidateQueries({ queryKey: changeWalkthroughQueryKey(event.data.sessionID) })
          break
        }
        case 'session.execution.failed': {
          useSessionStatus.getState().setOutcome(event.data.sessionID, 'failed')
          useSessionStatus.getState().setStatus(event.data.sessionID, { type: 'idle' })
          invalidateSessionListCachesDebounced(queryClient, event.directory)
          queryClient.invalidateQueries({ queryKey: changeWalkthroughQueryKey(event.data.sessionID) })
          break
        }
        case 'session.execution.interrupted': {
          useSessionStatus.getState().setOutcome(event.data.sessionID, 'interrupted')
          useSessionStatus.getState().setStatus(event.data.sessionID, { type: 'idle' })
          invalidateSessionListCachesDebounced(queryClient, event.directory)
          queryClient.invalidateQueries({ queryKey: changeWalkthroughQueryKey(event.data.sessionID) })
          break
        }
        case 'session.deleted': {
          useSessionStatus.getState().forgetSession(event.data.sessionID)
          invalidateSessionListCachesDebounced(queryClient, event.directory)
          break
        }
        case 'session.created': {
          invalidateSessionListCachesDebounced(queryClient, event.directory)
          if (typeof event.data.parentID === 'string') {
            useSessionStatus.getState().setSessionParent(event.data.sessionID, event.data.parentID)
          }
          break
        }
        case 'session.forked':
        case 'session.renamed':
        case 'session.moved':
        case 'session.metadata.updated':
          invalidateSessionListCachesDebounced(queryClient, event.directory)
          break
        case 'shell.created': {
          const info = event.data.info
          if (
            info.status === 'running' &&
            typeof info.metadata.sessionID === 'string' &&
            event.directory
          ) {
            const sessionID = info.metadata.sessionID
            useSessionStatus.getState().setShellRunning(info.id, sessionID, event.directory)
            if (!useSessionStatus.getState().parents.has(sessionID)) {
              void resolveSessionAncestry([sessionID])
            }
          }
          break
        }
        case 'shell.exited': {
          if (event.data.status !== 'running') {
            useSessionStatus.getState().clearShell(event.data.id)
          }
          break
        }
        case 'shell.deleted': {
          useSessionStatus.getState().clearShell(event.data.id)
          break
        }
        case 'credential.updated':
        case 'credential.switched':
        case 'integration.updated':
        case 'provider.updated':
        case 'model.updated':
          invalidateProviderCachesDebounced(queryClient)
          break
        case 'agent.updated':
          invalidateQueryKeysDebounced(queryClient, [['opencode', 'agents']])
          break
        case 'command.updated':
          invalidateQueryKeysDebounced(queryClient, [['opencode', 'commands']])
          break
        case 'skill.updated':
          invalidateQueryKeysDebounced(queryClient, [['opencode', 'skills']])
          break
        case 'config.updated':
          invalidateQueryKeysDebounced(queryClient, [['opencode', 'config'], ['opencode-config']])
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
        fetchInitialSessionStatuses()
        void syncRunningShells(collectTrackedDirectories())
        invalidateChildSessionCaches(queryClient)
        invalidateQueryKeysDebounced(queryClient, LOCATION_CATALOG_QUERY_KEYS)
        startStatusPoll()
      } else {
        statusSyncVersionRef.current += 1
        stopStatusPoll()
      }
    }

    const handleResync = () => {
      void reconcilePendingActionsForDirectories(collectTrackedDirectories())
      void fetchInitialSessionStatuses()
      void syncRunningShells(collectTrackedDirectories())
      invalidateChildSessionCaches(queryClient)
      invalidateQueryKeysDebounced(queryClient, LOCATION_CATALOG_QUERY_KEYS)
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
      statusSyncVersionRef.current += 1
      stopStatusPoll()
      subscription.dispose()
      subscriptionRef.current = null
    }
  }, [addPermission, removePermission, addForm, removeForm, rememberSessionDirectory, fetchInitialPendingData, fetchInitialSessionStatuses, startStatusPoll, stopStatusPoll, queryClient, handleHealthChange, reconcilePendingActionsForDirectories, collectTrackedDirectories, syncRunningShells, resolveSessionAncestry])

  useEffect(() => {
    reposRef.current = repos
    const directories = [...new Set((repos ?? []).map(r => r.fullPath))]
    const previousDirectories = trackedRepoDirectoriesRef.current
    const addedDirectories = directories.filter((directory) => !previousDirectories.has(directory))
    trackedRepoDirectoriesRef.current = new Set(directories)
    const sub = subscriptionRef.current
    if (!sub) return
    sub.updateDirectories(directories)
    if (addedDirectories.length > 0) {
      void syncRunningShells(addedDirectories)
    }
  }, [repos, syncRunningShells])

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
      viewedSessionId,
      currentDirectory: currentPermissionDirectory,
      currentIsFromDifferentSession,
      respond: replyToPermission,
      dismiss: removePermission,
      getForToolCall: getPermissionForToolCall,
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
    viewedSessionId,
    currentPermissionDirectory,
    currentIsFromDifferentSession,
    replyToPermission,
    removePermission,
    hasPermissionsForSession,
    getPermissionForToolCall,
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

export function useToolCallPermission(
  toolCallID: string,
  messageID?: string,
): PermissionRequest | null {
  const context = useContext(EventContext)
  return context?.permissions.getForToolCall(toolCallID, messageID) ?? null
}

export function useForms() {
  const { forms } = useEventContext()
  return forms
}

export function useSSEHealth(): SSEHealthState {
  return useEventContext().sseHealth
}
