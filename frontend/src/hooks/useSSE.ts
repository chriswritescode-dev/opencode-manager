import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SessionInfo, V2Event } from '@opencode-manager/shared/opencode'
import { invalidateSessionListCaches, shellsQueryKey } from '@/lib/queryInvalidation'
import { showToast } from '@/lib/toast'
import { useSendErrorStore } from '@/stores/sendErrorStore'
import { openCodeEventStream } from '@/lib/opencode-event-stream'
import type { EventStreamSubscription } from '@/lib/opencode-event-stream'
import type { ShellInfo } from '@/api/opencode'

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

  const handleSSEEvent = useCallback((event: V2StreamEvent) => {
    const eventDirectory = getEventDirectory(event)
    const cacheDirectory = resolveCacheDirectory(eventDirectory)
    if (eventDirectory && directorySet.size > 0 && cacheDirectory !== eventDirectory) return

    switch (event.type) {
      case 'session.created':
        invalidateSessionQueryIfCached(queryClient, event.data.sessionID)
        break

      case 'session.renamed':
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
        queryClient.setQueryData<ShellInfo[]>(shellsQueryKey(cacheDirectory), (current) =>
          current ? [...current.filter((shell) => shell.id !== info.id), info] : current,
        )
        break
      }

      case 'shell.exited':
      case 'shell.deleted': {
        const id = event.data.id
        queryClient.setQueryData<ShellInfo[]>(shellsQueryKey(cacheDirectory), (current) =>
          current?.filter((shell) => shell.id !== id),
        )
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
  }, [queryClient, directorySet, resolveCacheDirectory])

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
        syncCurrentSession()
        eventStreamSubscriptionRef.current?.reportVisibility(document.visibilityState === 'visible', sessionIdRef.current)
      } else {
        setError('Connection lost. Reconnecting...')
      }
    }

    const handleResync = () => {
      if (!mountedRef.current) return
      invalidateSessionListCaches(queryClient)
      queryClient.invalidateQueries({ queryKey: ['opencode', 'shells'] })
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
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleReconnect)
      window.removeEventListener('online', handleReconnect)
      subscription.reportVisibility(false, undefined)
      subscription.dispose()
      if (eventStreamSubscriptionRef.current === subscription) {
        eventStreamSubscriptionRef.current = null
      }
    }
  }, [directoryKey, directoriesList, handleSSEEvent, syncCurrentSession, refreshCurrentSession, queryClient])

  useEffect(() => {
    if (isConnected && document.visibilityState === 'visible') {
      eventStreamSubscriptionRef.current?.reportVisibility(true, currentSessionId)
    }
  }, [currentSessionId, isConnected])

  return { isConnected, error, isReconnecting }
}
