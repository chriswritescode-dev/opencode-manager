/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient, useQuery, useQueries } from '@tanstack/react-query'
import {
  cancelForm,
  getSession,
  listActiveSessions,
  listPendingForms,
  listPendingPermissions,
  listProjects,
  listShells,
  replyForm,
  replyPermission,
} from '@/api/opencode'
import { listRepos } from '@/api/repos'
import { FetchError } from '@opencode-manager/shared'
import { buildServerDirectoryKey, LOCAL_OPENCODE_SERVER_ID, parseServerDirectoryKey } from '@opencode-manager/shared/schemas'
import { isLocalOpenCodeServer } from '@/contexts/OpenCodeServerContext'
import { useAuth } from '@/hooks/useAuth'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import type { FormAnswer, FormInfo, PermissionRequest, V2Event } from '@opencode-manager/shared/opencode'
import type { PermissionResponse, SSHHostKeyRequest, Repo } from '@/api/types'
import { showToast } from '@/lib/toast'
import { openCodeEventStream, type EventStreamHealthState } from '@/lib/opencode-event-stream'
import { addToSessionKeyedState, removeFromSessionKeyedState } from '@/lib/sessionKeyedState'
import { getServerSessionPath, getSessionPath, parseRepoRoute, parseServerSessionRoute } from '@/lib/navigation'
import { serverScopedKey } from '@/lib/serverScope'
import { repoMatchesDirectory } from '@/components/navigation/sidebar-session-tree'
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

type ServerScoped<T> = T & { serverId: string }
type PendingPermission = ServerScoped<PermissionRequest>
type PendingForm = ServerScoped<FormInfo>
type PermissionsBySession = Record<string, PendingPermission[]>
type FormsBySession = Record<string, PendingForm[]>
type SSEHealthState = Pick<EventStreamHealthState, 'isConnected' | 'isHealthy' | 'isStalled'>
type StreamEvent =
  | (V2Event & { directory?: string; serverId?: string })
  | { type: 'ssh.host-key-request'; properties: SSHHostKeyRequest }

type SessionScopedItem = { id: string; sessionID: string }

const EMPTY_SESSION_IDS: string[] = []

/**
 * Session ids whose queued item list is non-empty. The array reference is stable across renders
 * while the set of ids is unchanged, even when the backing record is replaced.
 */
function usePendingSessionIDs(bySession: Record<string, unknown[]>): string[] {
  const idsKey = useMemo(
    () => Object.keys(bySession).filter((sessionID) => (bySession[sessionID]?.length ?? 0) > 0).join('\u0000'),
    [bySession],
  )
  return useMemo(() => (idsKey ? idsKey.split('\u0000') : EMPTY_SESSION_IDS), [idsKey])
}

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

function reconcileBySessionForDirectory<T extends SessionScopedItem & { serverId: string }>(
  prev: Record<string, T[]>,
  directoryKey: string,
  serverId: string,
  items: T[],
  sessionDirectories: ReadonlyMap<string, string>,
): Record<string, T[]> {
  const grouped = groupBySession(items)
  const next = { ...prev }

  for (const sessionID of Object.keys(prev)) {
    if (grouped[sessionID]) continue
    if (sessionDirectories.get(sessionID) !== directoryKey) continue
    if ((prev[sessionID]?.[0]?.serverId ?? LOCAL_OPENCODE_SERVER_ID) === serverId) {
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
    current: PendingPermission | null
    pendingCount: number
    /**
     * Ids of sessions with at least one pending permission request, stable while the queue is unchanged.
     */
    pendingSessionIDs: string[]
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
    syncForSession: (directory: string, sessionID: string, serverId?: string) => Promise<void>
  }
  forms: {
    current: PendingForm | null
    pendingCount: number
    /**
     * Ids of sessions with at least one pending form, stable while the queue is unchanged.
     */
    pendingSessionIDs: string[]
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
    syncForSession: (directory: string, sessionID: string, serverId?: string) => Promise<void>
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

/**
 * Primitive key of every directory that hosts an active session: the recorded directory of each
 * session whose status is not `idle`, plus each running shell's directory, sorted and de-duplicated.
 * A string keeps the zustand subscription stable across store updates that do not change the set.
 */
export function selectActiveSessionDirectoriesKey(
  state: Pick<ReturnType<typeof useSessionStatus.getState>, 'statuses' | 'directories' | 'runningShells'>,
): string {
  const directories = new Set<string>()
  for (const [sessionID, status] of state.statuses.entries()) {
    if (status.type === 'idle') continue
    const directory = state.directories.get(sessionID)
    if (directory) directories.add(directory)
  }
  for (const shell of state.runningShells.values()) {
    if (shell.directory) directories.add(shell.directory)
  }
  return [...directories].sort().join('\n')
}

const EventContext = createContext<EventContextValue | null>(null)

export function EventProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const sessionParents = useSessionStatus((state) => state.parents)
  const activeSessionDirectoriesKey = useSessionStatus(selectActiveSessionDirectoriesKey)

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

  const prevPermissionCountRef = useRef(0)
  const initialFetchDoneRef = useRef(false)
  const statusSyncVersionRef = useRef(0)
  const remoteStatusSyncVersionsRef = useRef(new Map<string, number>())
  const statusPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const subscriptionRef = useRef<ReturnType<typeof openCodeEventStream.subscribeGlobalMonitor> | null>(null)
  const reposRef = useRef<typeof repos>(null)
  const ancestryInFlightRef = useRef<Set<string>>(new Set())

  const { data: repos } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
  })

  const { isAuthenticated } = useAuth()
  const { servers } = useOpenCodeServers({ enabled: isAuthenticated })
  const enabledRemoteServers = useMemo(() => servers.filter((server) => server.enabled), [servers])
  const enabledRemoteServersRef = useRef(enabledRemoteServers)
  useEffect(() => {
    enabledRemoteServersRef.current = enabledRemoteServers
  }, [enabledRemoteServers])
  const remoteProjectQueries = useQueries({
    queries: enabledRemoteServers.map((server) => ({
      queryKey: serverScopedKey(['opencode', 'projects'], server.id),
      queryFn: () => listProjects(server.id),
      enabled: isAuthenticated,
      retry: false,
    })),
  })
  const remoteProjectDirectoriesKey = useMemo(() => {
    if (!isAuthenticated) return ''
    const keys = new Set<string>()
    enabledRemoteServers.forEach((server, index) => {
      for (const project of remoteProjectQueries[index]?.data ?? []) {
        if (project.canonical) keys.add(buildServerDirectoryKey(server.id, project.canonical))
      }
    })
    return [...keys].sort().join('\n')
  }, [isAuthenticated, enabledRemoteServers, remoteProjectQueries])

  const allPermissions = useMemo(() => Object.values(permissionsBySession).flat(), [permissionsBySession])
  const allForms = useMemo(() => Object.values(formsBySession).flat(), [formsBySession])

  const pendingPermissionSessionIDs = usePendingSessionIDs(permissionsBySession)
  const pendingFormSessionIDs = usePendingSessionIDs(formsBySession)

  const viewedSessionId = useMemo(
    () => parseServerSessionRoute(location.pathname)?.sessionId ?? parseRepoRoute(location.pathname).sessionId,
    [location.pathname],
  )

  const currentPermission = usePinnedViewedItem(allPermissions, viewedSessionId, sessionParents)

  const currentForm = usePinnedViewedItem(allForms, viewedSessionId, sessionParents)

  const rememberSessionDirectory = useCallback((
    sessionID: string,
    directory?: string,
    serverId: string = LOCAL_OPENCODE_SERVER_ID,
  ) => {
    if (!directory) return
    const state = useSessionStatus.getState()
    state.setSessionServer(sessionID, serverId)
    state.setSessionDirectory(sessionID, buildServerDirectoryKey(serverId, directory))
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

  const findSessionDirectoryKey = useCallback((sessionID: string): string | null => {
    const remembered = useSessionStatus.getState().directories.get(sessionID)
    if (remembered) return remembered
    return findCachedSessionDirectory(sessionID)
  }, [findCachedSessionDirectory])

  const findSessionDirectory = useCallback((sessionID: string): string | null => {
    const key = findSessionDirectoryKey(sessionID)
    return key ? parseServerDirectoryKey(key).directory : null
  }, [findSessionDirectoryKey])

  const getRepoIdForSession = useCallback((sessionID: string): number | null => {
    if (!repos) return null
    if (useSessionStatus.getState().sessionServers.has(sessionID)) return null
    const key = findSessionDirectoryKey(sessionID)
    if (!key) return null
    const { serverId, directory } = parseServerDirectoryKey(key)
    if (!isLocalOpenCodeServer(serverId)) return null
    const repo = repos.find(r => repoMatchesDirectory(r, directory))
    return repo?.id ?? null
  }, [repos, findSessionDirectoryKey])

  const currentPermissionDirectory = useMemo(
    () => (currentPermission ? findSessionDirectory(currentPermission.sessionID) : null),
    [currentPermission, findSessionDirectory],
  )

  const currentIsFromDifferentSession = viewedSessionId !== null
    && currentPermission !== null
    && !isSessionWithinView(currentPermission.sessionID, viewedSessionId, sessionParents)

  const addPermission = useCallback((permission: PermissionRequest, serverId: string) => {
    addToSessionKeyedState(setPermissionsBySession, { ...permission, serverId })
  }, [])

  const removePermission = useCallback((permissionID: string, sessionID?: string) => {
    removeFromSessionKeyedState(setPermissionsBySession, permissionID, sessionID)
  }, [])

  const addForm = useCallback((form: FormInfo, serverId: string) => {
    addToSessionKeyedState(setFormsBySession, { ...form, serverId })
  }, [])

  const removeForm = useCallback((formID: string, sessionID?: string) => {
    removeFromSessionKeyedState(setFormsBySession, formID, sessionID)
  }, [])

  const reconcilePermissionsForDirectory = useCallback((
    directory: string,
    permissions: PermissionRequest[],
    serverId: string,
  ) => {
    permissions.forEach(permission => {
      rememberSessionDirectory(permission.sessionID, directory, serverId)
    })

    setPermissionsBySession(prev =>
      reconcileBySessionForDirectory(
        prev,
        buildServerDirectoryKey(serverId, directory),
        serverId,
        permissions.map(permission => ({ ...permission, serverId })),
        useSessionStatus.getState().directories,
      ),
    )
  }, [rememberSessionDirectory])

  const reconcileFormsForDirectory = useCallback((
    directory: string,
    forms: FormInfo[],
    serverId: string,
  ) => {
    forms.forEach(form => {
      rememberSessionDirectory(form.sessionID, directory, serverId)
    })

    setFormsBySession(prev =>
      reconcileBySessionForDirectory(
        prev,
        buildServerDirectoryKey(serverId, directory),
        serverId,
        forms.map(form => ({ ...form, serverId })),
        useSessionStatus.getState().directories,
      ),
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
    const permission = allPermissions.find(candidate => candidate.id === permissionID)
    await settlePendingReply(
      () => replyPermission(sessionID, permissionID, response, message, permission?.serverId),
      'PermissionNotFoundError',
      'Permission request expired',
    )
    removePermission(permissionID, sessionID)
  }, [allPermissions, removePermission])

  const replyToForm = useCallback(async (formID: string, answer: FormAnswer) => {
    const form = Object.values(formsBySession).flat().find(f => f.id === formID)
    if (!form) throw new Error('Form not found')
    await settlePendingReply(
      () => replyForm(form.sessionID, formID, answer, form.serverId),
      'FormNotFoundError',
      'Form expired',
    )
    removeForm(formID, form.sessionID)
  }, [formsBySession, removeForm])

  const cancelPendingForm = useCallback(async (formID: string) => {
    const form = Object.values(formsBySession).flat().find(f => f.id === formID)
    if (!form) throw new Error('Form not found')
    await settlePendingReply(
      () => cancelForm(form.sessionID, formID, form.serverId),
      'FormNotFoundError',
      'Form expired',
    )
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

  const navigateToSession = useCallback((sessionID: string, serverId: string) => {
    let targetPath: string
    if (isLocalOpenCodeServer(serverId)) {
      const repoId = getRepoIdForSession(sessionID)
      if (repoId === null) return
      targetPath = getSessionPath(repoId, sessionID)
    } else {
      targetPath = getServerSessionPath(serverId, sessionID)
    }
    if (`${window.location.pathname}${window.location.search}` !== targetPath) {
      navigate(targetPath)
    }
  }, [getRepoIdForSession, navigate])

  const navigateToCurrentForm = useCallback(() => {
    if (!currentForm) return
    navigateToSession(currentForm.sessionID, currentForm.serverId)
  }, [currentForm, navigateToSession])

  const navigateToCurrentPermission = useCallback(() => {
    if (!currentPermission) return
    navigateToSession(currentPermission.sessionID, currentPermission.serverId)
  }, [currentPermission, navigateToSession])

  const reconcilePendingActionsForDirectories = useCallback(async (directories: string[]) => {
    await Promise.all(directories.map(async (key) => {
      const { serverId, directory } = parseServerDirectoryKey(key)
      try {
        const [pendingPermissions, pendingForms] = await Promise.all([
          listPendingPermissions(directory, serverId),
          listPendingForms(directory, serverId),
        ])
        reconcilePermissionsForDirectory(directory, pendingPermissions, serverId)
        reconcileFormsForDirectory(directory, pendingForms, serverId)
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
    for (const directory of useSessionStatus.getState().directories.values()) {
      if (directory) directories.add(directory)
    }
    return [...directories]
  }, [])

  const resolveSessionAncestry = useCallback(async (
    sessionIDs: string[],
    serverId: string = LOCAL_OPENCODE_SERVER_ID,
  ) => {
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
          const session = await getSession(lookupID, serverId)
          useSessionStatus.getState().setSessionParent(lookupID, session.parentID ?? null)
          useSessionStatus.getState().setSessionServer(lookupID, serverId)
          useSessionStatus.getState().setSessionDirectory(
            lookupID,
            buildServerDirectoryKey(serverId, session.location.directory),
          )
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
    await Promise.all(directories.map(async (key) => {
      const { serverId, directory } = parseServerDirectoryKey(key)
      const token = useSessionStatus.getState().beginShellSnapshot()
      try {
        const shells = await listShells(directory, serverId)
        const runningShells = shells.flatMap((shell) => {
          const sessionID = shell.metadata.sessionID
          if (shell.status !== 'running' || typeof sessionID !== 'string') return []
          return [{ id: shell.id, sessionID }]
        })
        useSessionStatus.getState().replaceRunningShells(key, runningShells, token)
        await resolveSessionAncestry(runningShells.map((shell) => shell.sessionID), serverId)
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
        if (status.type === 'idle') continue
        if (useSessionStatus.getState().sessionServers.has(sessionID)) continue
        busyBeforeSnapshot.add(sessionID)
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

  const invalidateRemoteStatusSyncs = useCallback(() => {
    const versions = remoteStatusSyncVersionsRef.current
    for (const [serverId, version] of versions.entries()) {
      versions.set(serverId, version + 1)
    }
  }, [])

  const reconcileRemoteSessionStatuses = useCallback(async (serverId: string) => {
    const versions = remoteStatusSyncVersionsRef.current
    const syncVersion = (versions.get(serverId) ?? 0) + 1
    versions.set(serverId, syncVersion)
    const snapshotToken = useSessionStatus.getState().beginStatusSnapshot()

    try {
      const active = await listActiveSessions(serverId)
      if (versions.get(serverId) !== syncVersion) {
        useSessionStatus.getState().endStatusSnapshot(snapshotToken)
        return
      }
      useSessionStatus.getState().replaceServerStatuses(
        serverId,
        busyStatusesFromActiveSessions(active),
        snapshotToken,
      )
      await resolveSessionAncestry(Object.keys(active), serverId)
    } catch (error) {
      useSessionStatus.getState().endStatusSnapshot(snapshotToken)
      if (import.meta.env.DEV) {
        console.warn(`Failed to fetch active sessions for ${serverId}:`, error)
      }
    }
  }, [resolveSessionAncestry])

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

  const syncPermissionsForSession = useCallback(async (
    directory: string,
    sessionID: string,
    serverId: string = LOCAL_OPENCODE_SERVER_ID,
  ) => {
    const pendingPermissions = await listPendingPermissions(directory, serverId)
    rememberSessionDirectory(sessionID, directory, serverId)
    reconcilePermissionsForDirectory(directory, pendingPermissions, serverId)
  }, [rememberSessionDirectory, reconcilePermissionsForDirectory])

  const syncFormsForSession = useCallback(async (
    directory: string,
    sessionID: string,
    serverId: string = LOCAL_OPENCODE_SERVER_ID,
  ) => {
    const pendingForms = await listPendingForms(directory, serverId)
    rememberSessionDirectory(sessionID, directory, serverId)
    reconcileFormsForDirectory(directory, pendingForms, serverId)
  }, [rememberSessionDirectory, reconcileFormsForDirectory])

  useEffect(() => {
    const handleSSEMessage = (data: unknown) => {
      if (!data || typeof data !== 'object' || !('type' in data)) return
      
      const event = data as StreamEvent
      const serverId = (event as { serverId?: string }).serverId ?? LOCAL_OPENCODE_SERVER_ID

      switch (event.type) {
        case 'permission.asked': {
          const request = event.data
          rememberSessionDirectory(request.sessionID, event.directory, serverId)
          addPermission(request, serverId)
          if (!useSessionStatus.getState().parents.has(request.sessionID)) {
            void resolveSessionAncestry([request.sessionID], serverId)
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
          rememberSessionDirectory(form.sessionID, event.directory, serverId)
          addForm(form, serverId)
          if (!useSessionStatus.getState().parents.has(form.sessionID)) {
            void resolveSessionAncestry([form.sessionID], serverId)
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
          useSessionStatus.getState().setSessionServer(sessionID, serverId)
          rememberSessionDirectory(sessionID, event.directory, serverId)
          useSessionStatus.getState().setStatus(sessionID, status)
          break
        }
        case 'session.idle': {
          useSessionStatus.getState().setSessionServer(event.data.sessionID, serverId)
          useSessionStatus.getState().setStatus(event.data.sessionID, { type: 'idle' })
          break
        }
        case 'session.execution.started': {
          useSessionStatus.getState().setSessionServer(event.data.sessionID, serverId)
          rememberSessionDirectory(event.data.sessionID, event.directory, serverId)
          useSessionStatus.getState().clearOutcome(event.data.sessionID)
          useSessionStatus.getState().setStatus(event.data.sessionID, { type: 'busy' })
          break
        }
        case 'session.execution.succeeded': {
          useSessionStatus.getState().setSessionServer(event.data.sessionID, serverId)
          useSessionStatus.getState().setOutcome(event.data.sessionID, 'succeeded')
          useSessionStatus.getState().setStatus(event.data.sessionID, { type: 'idle' })
          invalidateSessionListCachesDebounced(queryClient, event.directory)
          queryClient.invalidateQueries({ queryKey: changeWalkthroughQueryKey(event.data.sessionID) })
          break
        }
        case 'session.execution.failed': {
          useSessionStatus.getState().setSessionServer(event.data.sessionID, serverId)
          useSessionStatus.getState().setOutcome(event.data.sessionID, 'failed')
          useSessionStatus.getState().setStatus(event.data.sessionID, { type: 'idle' })
          invalidateSessionListCachesDebounced(queryClient, event.directory)
          queryClient.invalidateQueries({ queryKey: changeWalkthroughQueryKey(event.data.sessionID) })
          break
        }
        case 'session.execution.interrupted': {
          useSessionStatus.getState().setSessionServer(event.data.sessionID, serverId)
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
          useSessionStatus.getState().setSessionServer(event.data.sessionID, serverId)
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
            useSessionStatus.getState().setShellRunning(
              info.id,
              sessionID,
              buildServerDirectoryKey(serverId, event.directory),
            )
            rememberSessionDirectory(sessionID, event.directory, serverId)
            if (!useSessionStatus.getState().parents.has(sessionID)) {
              void resolveSessionAncestry([sessionID], serverId)
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
          if (!repo) {
            queryClient.invalidateQueries({ queryKey: ['repo', 'siblings'] })
            break
          }

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
        for (const server of enabledRemoteServersRef.current) {
          void reconcileRemoteSessionStatuses(server.id)
        }
        void syncRunningShells(collectTrackedDirectories())
        invalidateChildSessionCaches(queryClient)
        invalidateQueryKeysDebounced(queryClient, LOCATION_CATALOG_QUERY_KEYS)
        startStatusPoll()
      } else {
        statusSyncVersionRef.current += 1
        invalidateRemoteStatusSyncs()
        stopStatusPoll()
      }
    }

    const handleResync = (subscribedDirectories: string[], serverId?: string) => {
      if (serverId && !isLocalOpenCodeServer(serverId)) {
        const directories = subscribedDirectories.filter(
          (key) => parseServerDirectoryKey(key).serverId === serverId,
        )
        void reconcilePendingActionsForDirectories(directories)
        void reconcileRemoteSessionStatuses(serverId)
        void syncRunningShells(directories)
        invalidateQueryKeysDebounced(
          queryClient,
          LOCATION_CATALOG_QUERY_KEYS.map((key) => serverScopedKey(key, serverId)),
        )
        return
      }
      const directories = [...new Set([...collectTrackedDirectories(), ...subscribedDirectories])]
      void reconcilePendingActionsForDirectories(directories)
      void fetchInitialSessionStatuses()
      void syncRunningShells(directories)
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
      onDirectoriesSubscribed: (directories) => {
        void reconcilePendingActionsForDirectories(directories)
        void syncRunningShells(directories)
      },
    })
    subscriptionRef.current = subscription
    
    return () => {
      statusSyncVersionRef.current += 1
      invalidateRemoteStatusSyncs()
      stopStatusPoll()
      subscription.dispose()
      subscriptionRef.current = null
    }
  }, [addPermission, removePermission, addForm, removeForm, rememberSessionDirectory, fetchInitialPendingData, fetchInitialSessionStatuses, startStatusPoll, stopStatusPoll, queryClient, handleHealthChange, reconcilePendingActionsForDirectories, collectTrackedDirectories, syncRunningShells, resolveSessionAncestry, reconcileRemoteSessionStatuses, invalidateRemoteStatusSyncs])

  useEffect(() => {
    reposRef.current = repos
    const directories = new Set((repos ?? []).map(r => r.fullPath))
    for (const directory of activeSessionDirectoriesKey.split('\n')) {
      if (directory) directories.add(directory)
    }
    for (const key of remoteProjectDirectoriesKey.split('\n')) {
      if (key) directories.add(key)
    }
    subscriptionRef.current?.updateDirectories([...directories])
  }, [repos, activeSessionDirectoriesKey, remoteProjectDirectoriesKey])

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
      pendingSessionIDs: pendingPermissionSessionIDs,
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
      pendingSessionIDs: pendingFormSessionIDs,
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
    pendingPermissionSessionIDs,
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
    pendingFormSessionIDs,
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
