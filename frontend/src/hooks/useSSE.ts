import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SessionInfo, V2Event } from '@opencode-manager/shared/opencode'
import { invalidateSessionListCaches, invalidateSessionListCachesDebounced } from '@/lib/queryInvalidation'
import { showToast } from '@/lib/toast'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useSendErrorStore } from '@/stores/sendErrorStore'
import { openCodeEventStream } from '@/lib/opencode-event-stream'
import type { EventStreamSubscription } from '@/lib/opencode-event-stream'
import { listActiveSessions } from '@/api/opencode'

const STATUS_POLL_INTERVAL_MS = 5000

type V2StreamEvent = V2Event & { directory?: string }

const getEventDirectory = (event: V2StreamEvent): string | undefined => {
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

export const useSSE = (directory?: string | string[], currentSessionId?: string) => {
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
  const statusSyncVersionRef = useRef(0)
  const eventStreamSubscriptionRef = useRef<EventStreamSubscription | null>(null)
  sessionIdRef.current = currentSessionId
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const setSessionStatus = useSessionStatus((state) => state.setStatus)
  const replaceSessionStatuses = useSessionStatus((state) => state.replaceStatuses)

  const resolveCacheDirectory = useCallback(
    (eventDirectory: string | undefined): string | undefined => {
      if (!eventDirectory) return primaryDirectory
      return directorySet.has(eventDirectory) ? eventDirectory : primaryDirectory
    },
    [directorySet, primaryDirectory],
  )

  const handleSSEEvent = useCallback((event: V2StreamEvent) => {
    const eventDirectory = getEventDirectory(event)
    const cacheDirectory = resolveCacheDirectory(eventDirectory)
    if (eventDirectory && directorySet.size > 0 && cacheDirectory !== eventDirectory) return

    switch (event.type) {
      case 'session.created':
        invalidateSessionListCachesDebounced(queryClient)
        invalidateSessionQueryIfCached(queryClient, event.data.sessionID)
        break

      case 'session.renamed':
        invalidateSessionListCachesDebounced(queryClient)
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
        invalidateSessionListCaches(queryClient)
        queryClient.removeQueries({ queryKey: ['opencode', 'session', event.data.sessionID] })
        break

      case 'session.moved':
        invalidateSessionListCachesDebounced(queryClient)
        break

      case 'session.status':
        setSessionStatus(event.data.sessionID, event.data.status)
        break

      case 'session.idle':
        setSessionStatus(event.data.sessionID, { type: 'idle' })
        useSendErrorStore.getState().clearNetworkError(event.data.sessionID)
        break

      case 'session.execution.started':
        setSessionStatus(event.data.sessionID, { type: 'busy' })
        break

      case 'session.execution.succeeded':
      case 'session.execution.failed':
      case 'session.execution.interrupted':
        setSessionStatus(event.data.sessionID, { type: 'idle' })
        invalidateSessionListCachesDebounced(queryClient)
        break

      case 'session.metadata.updated':
      case 'session.usage.updated':
        invalidateSessionListCachesDebounced(queryClient)
        break

      case 'installation.updated':
        showToast.success(`OpenCode updated to v${event.data.version}`, {
          description: 'The server has been successfully upgraded.',
          duration: 5000,
        })
        break

      default:
        break
    }
  }, [queryClient, directorySet, resolveCacheDirectory, setSessionStatus])

  const fetchInitialData = useCallback(async () => {
    if (!primaryDirectory || !mountedRef.current) return
    const syncVersion = ++statusSyncVersionRef.current

    try {
      const active = await listActiveSessions()
      if (mountedRef.current && statusSyncVersionRef.current === syncVersion && active) {
        const statuses = Object.fromEntries(
          Object.keys(active).map((sessionID) => [sessionID, { type: 'busy' as const }]),
        )
        replaceSessionStatuses(statuses)
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('aborted')) {
        throw err
      }
    }
  }, [primaryDirectory, replaceSessionStatuses])

  useEffect(() => {
    if (!primaryDirectory) return

    const interval = setInterval(() => {
      void fetchInitialData().catch(() => undefined)
    }, STATUS_POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [primaryDirectory, fetchInitialData])

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
      statusSyncVersionRef.current += 1
      setIsConnected(false)
      setIsReconnecting(false)
      return
    }

    const handleMessage = (data: unknown) => {
      if (data && typeof data === 'object' && 'type' in data) {
        handleSSEEvent(data as V2StreamEvent)
      }
    }

    const handleStatusChange = (connected: boolean) => {
      if (!mountedRef.current) return
      setIsConnected(connected)
      setIsReconnecting(!connected)
      
      if (connected) {
        setError(null)
        void fetchInitialData().catch(() => undefined)
        syncCurrentSession()
        eventStreamSubscriptionRef.current?.reportVisibility(document.visibilityState === 'visible', sessionIdRef.current)
      } else {
        setError('Connection lost. Reconnecting...')
      }
    }

    const handleResync = () => {
      if (!mountedRef.current) return
      invalidateSessionListCaches(queryClient)
      refreshCurrentSession()
    }

    const subscription = openCodeEventStream.subscribeGlobalMonitor({
      directories: directoriesList,
      onEvent: handleMessage,
      onStatusChange: handleStatusChange,
      onResync: handleResync,
    })
    eventStreamSubscriptionRef.current = subscription

    const handleReconnect = () => {
      subscription.reconnect()
    }

    const handleVisibilityChange = () => {
      subscription.reportVisibility(document.visibilityState === 'visible', sessionIdRef.current)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleReconnect)
    window.addEventListener('online', handleReconnect)

    return () => {
      mountedRef.current = false
      statusSyncVersionRef.current += 1
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleReconnect)
      window.removeEventListener('online', handleReconnect)
      subscription.reportVisibility(false, undefined)
      subscription.dispose()
      if (eventStreamSubscriptionRef.current === subscription) {
        eventStreamSubscriptionRef.current = null
      }
    }
  }, [directoryKey, directoriesList, handleSSEEvent, fetchInitialData, syncCurrentSession, refreshCurrentSession, queryClient])

  useEffect(() => {
    if (isConnected && document.visibilityState === 'visible') {
      eventStreamSubscriptionRef.current?.reportVisibility(true, currentSessionId)
    }
  }, [currentSessionId, isConnected])

  return { isConnected, error, isReconnecting }
}
