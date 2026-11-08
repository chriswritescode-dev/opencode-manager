import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  buildServerDirectoryKey,
  LOCAL_OPENCODE_SERVER_ID,
  type OpenCodeStreamEvent,
} from '@opencode-manager/shared/schemas'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import { invalidateSessionListCaches, invalidateShellCaches, shellsQueryKey } from '@/lib/queryInvalidation'
import {
  applyShellExit,
  markShellDeleted,
  recordShellDeleted,
  recordShellExit,
  upsertShell,
  type ShellRecord,
} from '@/lib/backgroundWork'
import { showToast } from '@/lib/toast'
import { useSendErrorStore } from '@/stores/sendErrorStore'
import { openCodeEventStream } from '@/lib/opencode-event-stream'
import type { EventStreamSubscription } from '@/lib/opencode-event-stream'
import { serverScopedKey } from '@/lib/serverScope'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'

/**
 * Narrows a stream event to its directory, returning `undefined` when the payload carries no
 * string directory rather than coercing another type.
 */
const getEventDirectory = (event: OpenCodeStreamEvent): string | undefined => {
  return typeof event.directory === 'string' ? event.directory : undefined
}

const invalidateSessionQueryIfCached = (
  queryClient: ReturnType<typeof useQueryClient>,
  sessionID: string,
) => {
  const queryKey = ['opencode', 'session', sessionID]
  if (queryClient.getQueryCache().findAll({ queryKey }).length === 0) return
  queryClient.invalidateQueries({ queryKey })
}

const patchSessionIfCached = (
  queryClient: ReturnType<typeof useQueryClient>,
  sessionID: string,
  patch: Partial<Pick<SessionInfo, 'model' | 'agent' | 'revert'>>,
) => {
  const queryKey = ['opencode', 'session', sessionID]
  if (queryClient.getQueryCache().findAll({ queryKey }).length === 0) return
  queryClient.setQueriesData<SessionInfo>({ queryKey }, (current) =>
    current ? { ...current, ...patch } : current,
  )
}

/**
 * Subscribes the view to the global event stream for one or more directories, projecting session,
 * shell, and status events into the React Query cache. Returns connection state plus the current
 * error text for reconnection UI; it also reports exposure and visibility to the backend.
 */
export const useSSE = (directory?: string | string[], currentSessionId?: string) => {
  const serverId = useOpenCodeServerId()
  const directoriesList = useMemo(() => {
    if (!directory) return [] as string[]
    if (Array.isArray(directory)) return directory.filter(Boolean)
    return [directory]
  }, [directory])
  const directoryKey = directoriesList.join('|')
  const primaryDirectory = directoriesList[0]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const directorySet = useMemo(() => new Set(directoriesList), [directoryKey])
  const queryClient = useQueryClient()
  const mountedRef = useRef(true)
  const sessionIdRef = useRef(currentSessionId)
  const eventStreamSubscriptionRef = useRef<EventStreamSubscription | null>(null)
  sessionIdRef.current = currentSessionId
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isReconnecting, setIsReconnecting] = useState(false)

  const resolveCacheDirectory = useCallback(
    (eventDirectory: string | undefined): string | undefined => {
      if (!eventDirectory) return primaryDirectory
      return directorySet.has(eventDirectory) ? eventDirectory : primaryDirectory
    },
    [directorySet, primaryDirectory],
  )

  const handleSSEEvent = useCallback((event: OpenCodeStreamEvent) => {
    if ((event.serverId ?? LOCAL_OPENCODE_SERVER_ID) !== serverId) return
    const eventDirectory = getEventDirectory(event)
    const cacheDirectory = resolveCacheDirectory(eventDirectory)
    if (eventDirectory && directorySet.size > 0 && cacheDirectory !== eventDirectory) return

    switch (event.type) {
      case 'session.created':
        invalidateSessionQueryIfCached(queryClient, event.data.sessionID)
        break

      case 'session.renamed':
      case 'session.moved':
        invalidateSessionQueryIfCached(queryClient, event.data.sessionID)
        break

      case 'session.model.selected':
        patchSessionIfCached(queryClient, event.data.sessionID, {
          model: event.data.model,
        })
        break

      case 'session.agent.selected':
        patchSessionIfCached(queryClient, event.data.sessionID, {
          agent: event.data.agent,
        })
        break

      case 'session.revert.staged':
        patchSessionIfCached(queryClient, event.data.sessionID, {
          revert: event.data.revert,
        })
        break

      case 'session.revert.cleared':
      case 'session.revert.committed':
        patchSessionIfCached(queryClient, event.data.sessionID, { revert: undefined })
        break

      case 'session.deleted':
        queryClient.removeQueries({ queryKey: ['opencode', 'session', event.data.sessionID] })
        break

      case 'session.idle':
        useSendErrorStore.getState().clearNetworkError(event.data.sessionID)
        break

      case 'shell.created': {
        const info = event.data.info
        const key = serverScopedKey(shellsQueryKey(cacheDirectory), serverId)
        const current = queryClient.getQueryData<ShellRecord[]>(key)
        if (!current) {
          queryClient.invalidateQueries({ queryKey: key })
          break
        }
        queryClient.setQueryData<ShellRecord[]>(key, (shells) => upsertShell(shells ?? [], info, cacheDirectory ?? ''))
        break
      }

      case 'shell.exited': {
        recordShellExit(cacheDirectory ?? '', event.data)
        const key = serverScopedKey(shellsQueryKey(cacheDirectory), serverId)
        const current = queryClient.getQueryData<ShellRecord[]>(key)
        if (!current || !current.some((shell) => shell.id === event.data.id)) {
          queryClient.invalidateQueries({ queryKey: key })
          break
        }
        queryClient.setQueryData<ShellRecord[]>(key, (shells) => applyShellExit(shells ?? [], event.data))
        break
      }

      case 'shell.deleted': {
        recordShellDeleted(cacheDirectory ?? '', event.data.id)
        const key = serverScopedKey(shellsQueryKey(cacheDirectory), serverId)
        const current = queryClient.getQueryData<ShellRecord[]>(key)
        if (!current || !current.some((shell) => shell.id === event.data.id)) break
        queryClient.setQueryData<ShellRecord[]>(key, (shells) => markShellDeleted(shells ?? [], event.data.id))
        break
      }

      case 'installation.updated':
        showToast.success(`OpenCode updated to v${event.data.version}`, {
          description: 'The server has been successfully upgraded.',
          duration: 5000,
        })
        break

      default:
        break
    }
  }, [queryClient, directorySet, resolveCacheDirectory, serverId])

  const refreshCurrentSession = useCallback(() => {
    const sessionId = sessionIdRef.current
    if (!sessionId || !primaryDirectory) return

    queryClient.invalidateQueries({
      queryKey: ['opencode', 'session', sessionId, primaryDirectory],
    })
  }, [queryClient, primaryDirectory])

  const syncCurrentSession = useCallback(() => {
    const sessionId = sessionIdRef.current
    if (!sessionId || !primaryDirectory) return

    refreshCurrentSession()
    queryClient.invalidateQueries({
      queryKey: ['opencode', 'pending-actions', sessionId, primaryDirectory],
    })
  }, [queryClient, primaryDirectory, refreshCurrentSession])

  useEffect(() => {
    mountedRef.current = true
    
    if (directoriesList.length === 0) {
      setIsConnected(false)
      setIsReconnecting(false)
      return
    }

    const handleStatusChange = (connected: boolean) => {
      if (!mountedRef.current) return
      setIsConnected(connected)
      setIsReconnecting(!connected)
      
      if (connected) {
        setError(null)
        syncCurrentSession()
        invalidateShellCaches(queryClient)
        eventStreamSubscriptionRef.current?.reportVisibility(document.visibilityState === 'visible', sessionIdRef.current, serverId)
      } else {
        setError('Connection lost. Reconnecting...')
      }
    }

    /**
     * Drops cached session and shell data for this server and re-reads the current session after
     * the stream reports missed events. Resyncs for a different server are ignored.
     */
    const handleResync = (_subscribedDirectories: string[], resyncServerId?: string) => {
      if (!mountedRef.current) return
      if ((resyncServerId ?? LOCAL_OPENCODE_SERVER_ID) !== serverId) return
      invalidateSessionListCaches(queryClient)
      invalidateShellCaches(queryClient)
      refreshCurrentSession()
    }

    const subscription = openCodeEventStream.subscribeGlobalMonitor({
      directories: directoriesList.map((entry) => buildServerDirectoryKey(serverId, entry)),
      onEvent: handleSSEEvent,
      onStatusChange: handleStatusChange,
      onResync: handleResync,
    })
    eventStreamSubscriptionRef.current = subscription

    const handleVisibilityChange = () => {
      subscription.reportVisibility(document.visibilityState === 'visible', sessionIdRef.current, serverId)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mountedRef.current = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      subscription.reportVisibility(false, undefined, serverId)
      subscription.dispose()
      if (eventStreamSubscriptionRef.current === subscription) {
        eventStreamSubscriptionRef.current = null
      }
    }
  }, [directoryKey, directoriesList, handleSSEEvent, syncCurrentSession, refreshCurrentSession, queryClient, serverId])

  useEffect(() => {
    if (isConnected && document.visibilityState === 'visible') {
      eventStreamSubscriptionRef.current?.reportVisibility(true, currentSessionId, serverId)
    }
  }, [currentSessionId, isConnected, serverId])

  return { isConnected, error, isReconnecting }
}
