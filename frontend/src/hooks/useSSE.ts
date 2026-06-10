import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOpenCodeClient } from './useOpenCode'
import { invalidateSessionListCaches, invalidateSessionListCachesDebounced, messagesQueryKey } from '@/lib/queryInvalidation'
import type { SSEEvent, MessageWithParts } from '@/api/types'
import { showToast } from '@/lib/toast'
import { settingsApi } from '@/api/settings'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useSessionTodos } from '@/stores/sessionTodosStore'
import { useSendErrorStore } from '@/stores/sendErrorStore'
import { openCodeEventStream } from '@/lib/opencode-event-stream'
import type { EventStreamSubscription } from '@/lib/opencode-event-stream'
import { parseOpenCodeError } from '@/lib/opencode-errors'
import { createPartsBatcher } from '@/lib/partsBatcher'

const STATUS_POLL_INTERVAL_MS = 5000

const getEventDirectory = (event: SSEEvent): string | undefined => {
  const directory = (event as { directory?: unknown }).directory
  return typeof directory === 'string' ? directory : undefined
}

const handleRestartServer = async () => {
  showToast.loading('Reloading OpenCode configuration...', {
    id: 'restart-server',
  })

  try {
    const result = await settingsApi.reloadOpenCodeConfig()
    if (result.success) {
      showToast.success(result.message || 'OpenCode configuration reloaded successfully', {
        id: 'restart-server',
        duration: 3000,
      })
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } else {
      showToast.error(result.message || 'Failed to reload OpenCode configuration', {
        id: 'restart-server',
        duration: 5000,
      })
    }
  } catch (error) {
    showToast.error(error instanceof Error ? error.message : 'Failed to reload OpenCode configuration', {
      id: 'restart-server',
      duration: 5000,
    })
  }
}


export const useSSE = (opcodeUrl: string | null | undefined, directory?: string | string[], currentSessionId?: string) => {
  const directoriesList = useMemo(() => {
    if (!directory) return [] as string[]
    if (Array.isArray(directory)) return directory.filter(Boolean)
    return [directory]
  }, [directory])
  const directoryKey = directoriesList.join('|')
  const primaryDirectory = directoriesList[0]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const directorySet = useMemo(() => new Set(directoriesList), [directoryKey])
  const client = useOpenCodeClient(opcodeUrl, primaryDirectory)
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
  const setSessionTodos = useSessionTodos((state) => state.setTodos)
  const batcherRef = useRef<ReturnType<typeof createPartsBatcher> | null>(null)

  useEffect(() => {
    if (!opcodeUrl) {
      batcherRef.current?.destroy()
      batcherRef.current = null
      return
    }

    if (!batcherRef.current) {
      batcherRef.current = createPartsBatcher(queryClient, opcodeUrl)
    }

    return () => {
      batcherRef.current?.destroy()
      batcherRef.current = null
    }
  }, [queryClient, opcodeUrl])

  const resolveCacheDirectory = useCallback(
    (eventDirectory: string | undefined): string | undefined => {
      if (!eventDirectory) return primaryDirectory
      return directorySet.has(eventDirectory) ? eventDirectory : primaryDirectory
    },
    [directorySet, primaryDirectory],
  )

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    const eventDirectory = getEventDirectory(event)
    if (eventDirectory && directorySet.size > 0 && !directorySet.has(eventDirectory)) return
    const cacheDirectory = resolveCacheDirectory(eventDirectory)

    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        if ('info' in event.properties) {
          const session = event.properties.info
          const sessionQueryKey = ['opencode', 'session', opcodeUrl, session.id, cacheDirectory]

          queryClient.setQueryData(sessionQueryKey, session)
          invalidateSessionListCachesDebounced(queryClient)
          break
        }
        invalidateSessionListCachesDebounced(queryClient)
        break

      case 'session.deleted':
        invalidateSessionListCaches(queryClient, opcodeUrl)
        if ('sessionID' in event.properties) {
          queryClient.invalidateQueries({ 
            queryKey: ['opencode', 'session', opcodeUrl, event.properties.sessionID, cacheDirectory] 
          })
        }
        break

      case 'session.status': {
        if (!('sessionID' in event.properties && 'status' in event.properties)) break
        const { sessionID, status } = event.properties
        setSessionStatus(sessionID, status)
        break
      }

      case 'message.part.updated':
      case 'messagev2.part.updated': {
        if (!('part' in event.properties)) break
        const { part } = event.properties
        batcherRef.current?.queuePartUpdate(part.sessionID, part, cacheDirectory)
        break
      }

      case 'message.part.delta': {
        if (!('sessionID' in event.properties && 'messageID' in event.properties && 'partID' in event.properties && 'field' in event.properties && 'delta' in event.properties)) break
        const { sessionID, messageID, partID, field, delta } = event.properties
        batcherRef.current?.queuePartDelta(sessionID, messageID, partID, field, delta, cacheDirectory)
        break
      }

      case 'message.updated':
      case 'messagev2.updated': {
        if (!('info' in event.properties)) break
        
        const { info } = event.properties
        const sessionID = info.sessionID
        if (info.role === 'user') {
          useSendErrorStore.getState().clearQueuedPrompt(sessionID)
        }

        const queryKey = messagesQueryKey(opcodeUrl, sessionID, cacheDirectory)
        const currentData = queryClient.getQueryData<MessageWithParts[]>(queryKey)
        if (!currentData) {
          queryClient.invalidateQueries({ queryKey })
          return
        }
        
        const messageExists = currentData.some(msgWithParts => msgWithParts.info.id === info.id)
        
        if (!messageExists) {
          const filteredData = info.role === 'user' 
            ? currentData.filter(msgWithParts => !msgWithParts.info.id.startsWith('optimistic_'))
            : currentData
          queryClient.setQueryData(queryKey, [...filteredData, { info, parts: [] }])
        } else {
          const updated = currentData.map(msgWithParts => {
            if (msgWithParts.info.id !== info.id) return msgWithParts
            return { ...msgWithParts, info: { ...info } }
          })
          queryClient.setQueryData(queryKey, updated)
        }
        
        batcherRef.current?.flush({ sessionID, directory: cacheDirectory })
        break
      }

      case 'message.removed':
      case 'messagev2.removed': {
        if (!('sessionID' in event.properties && 'messageID' in event.properties)) break
        
        const { sessionID, messageID } = event.properties
        
        queryClient.setQueryData<MessageWithParts[]>(
          messagesQueryKey(opcodeUrl, sessionID, cacheDirectory),
          (old) => {
            if (!old) return old
            return old.filter(msgWithParts => msgWithParts.info.id !== messageID)
          }
        )
        break
      }

      case 'message.part.removed':
      case 'messagev2.part.removed': {
        if (!('sessionID' in event.properties && 'messageID' in event.properties && 'partID' in event.properties)) break
        
        const { sessionID, messageID, partID } = event.properties
        
        batcherRef.current?.queuePartRemoval(sessionID, messageID, partID, cacheDirectory)
        break
      }

      case 'session.compacted': {
        if (!('sessionID' in event.properties)) break
        
        const { sessionID } = event.properties
        setSessionStatus(sessionID, { type: 'idle' })
        showToast.dismiss(`compact-${sessionID}`)
        showToast.success('Session compacted')
        queryClient.invalidateQueries({ 
          queryKey: messagesQueryKey(opcodeUrl, sessionID, cacheDirectory) 
        })
        break
      }

      case 'session.idle': {
        if (!('sessionID' in event.properties)) break
        
        const { sessionID } = event.properties
        
        setSessionStatus(sessionID, { type: 'idle' })
        
        batcherRef.current?.flush({ sessionID, directory: cacheDirectory })
        
        const queryKey = messagesQueryKey(opcodeUrl, sessionID, cacheDirectory)
        const currentData = queryClient.getQueryData<MessageWithParts[]>(queryKey)
        if (!currentData) {
          queryClient.invalidateQueries({ queryKey })
          break
        }
        
        const now = Date.now()
        const updated = currentData.map(msgWithParts => {
          const msg = msgWithParts.info
          if (msg.role !== 'assistant') return msgWithParts
          
          if ('completed' in msg.time && msg.time.completed) return msgWithParts
          
          const updatedParts = msgWithParts.parts.map(part => {
            if (part.type !== 'tool') return part
            if (part.state.status !== 'running' && part.state.status !== 'pending') return part
            return {
              ...part,
              state: {
                ...part.state,
                status: 'completed' as const,
                output: part.state.status === 'running' ? '[Session ended - output not captured]' : '[Tool was pending when session ended]',
                title: part.state.status === 'running' ? (part.state as { title?: string }).title || '' : '',
                metadata: (part.state as { metadata?: Record<string, unknown> }).metadata || {},
                time: {
                  start: (part.state as { time?: { start: number } }).time?.start || now,
                  end: now
                }
              }
            }
          })
          
          return {
            ...msgWithParts,
            info: {
              ...msg,
              time: { ...msg.time, completed: now }
            },
            parts: updatedParts
          }
        })
        
        queryClient.setQueryData(queryKey, updated)
        break
      }

      case 'todo.updated':
        if ('sessionID' in event.properties && 'todos' in event.properties) {
          const { sessionID, todos } = event.properties
          setSessionTodos(sessionID, todos)
          queryClient.invalidateQueries({ 
            queryKey: ['opencode', 'todos', opcodeUrl, sessionID, cacheDirectory] 
          })
        }
        break

      case 'installation.updated':
        if ('version' in event.properties) {
          showToast.success(`OpenCode updated to v${event.properties.version}`, {
            description: 'The server has been successfully upgraded.',
            duration: 5000,
          })
        }
        break

      case 'installation.update-available':
        if ('version' in event.properties) {
          showToast.info(`OpenCode v${event.properties.version} is available`, {
            description: 'A new version is ready to install.',
            action: {
              label: 'Reload to Update',
              onClick: handleRestartServer
            },
            duration: 10000,
          })
        }
        break

      case 'session.error': {
        if (!('error' in event.properties)) break
        const sessionID = 'sessionID' in event.properties ? event.properties.sessionID : undefined
        const parsed = parseOpenCodeError(event.properties.error)
        if (sessionID && parsed) {
          useSendErrorStore.getState().failQueuedPrompt({
            sessionID,
            title: parsed.title,
            message: parsed.message,
          })
        }
        if (sessionID === currentSessionId) break
        
        const error = event.properties.error
        if (error?.name === 'MessageAbortedError') break
        
        if (parsed) {
          showToast.error(parsed.title, {
            description: parsed.message,
            duration: 2500,
          })
        }
        break
      }

      case 'question.replied':
      case 'question.rejected': {
        if (!('sessionID' in event.properties)) break
        const { sessionID } = event.properties
        queryClient.invalidateQueries({ 
          queryKey: messagesQueryKey(opcodeUrl, sessionID, cacheDirectory) 
        })
        break
      }

      default:
        break
    }
  }, [queryClient, opcodeUrl, directorySet, resolveCacheDirectory, setSessionStatus, setSessionTodos, currentSessionId])

  const fetchInitialData = useCallback(async () => {
    if (!client || !primaryDirectory || !mountedRef.current) return
    const syncVersion = ++statusSyncVersionRef.current
    
    try {
      const statuses = await client.getSessionStatuses()
      if (mountedRef.current && statusSyncVersionRef.current === syncVersion && statuses) {
        replaceSessionStatuses(statuses)
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('aborted')) {
        throw err
      }
    }
  }, [client, primaryDirectory, replaceSessionStatuses])

  useEffect(() => {
    if (!client || !primaryDirectory) return

    const interval = setInterval(() => {
      void fetchInitialData().catch(() => undefined)
    }, STATUS_POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [client, primaryDirectory, fetchInitialData])

  const syncCurrentSession = useCallback(() => {
    const sessionId = sessionIdRef.current
    if (!sessionId || !opcodeUrl || !primaryDirectory) return

    queryClient.invalidateQueries({
      queryKey: ['opencode', 'session', opcodeUrl, sessionId, primaryDirectory],
    })
    queryClient.invalidateQueries({
      queryKey: messagesQueryKey(opcodeUrl, sessionId, primaryDirectory),
    })
    queryClient.invalidateQueries({
      queryKey: ['opencode', 'pending-actions', opcodeUrl, sessionId, primaryDirectory],
    })
  }, [queryClient, opcodeUrl, primaryDirectory])

  useEffect(() => {
    mountedRef.current = true
    
    if (!opcodeUrl || directoriesList.length === 0) {
      statusSyncVersionRef.current += 1
      setIsConnected(false)
      setIsReconnecting(false)
      return
    }

    const handleMessage = (data: unknown) => {
      if (data && typeof data === 'object' && 'type' in data) {
        handleSSEEvent(data as SSEEvent)
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

    const subscription = openCodeEventStream.subscribeGlobalMonitor({
      directories: directoriesList,
      onEvent: handleMessage,
      onStatusChange: handleStatusChange,
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
  }, [opcodeUrl, directoryKey, directoriesList, handleSSEEvent, fetchInitialData, syncCurrentSession])

  useEffect(() => {
    if (isConnected && document.visibilityState === 'visible') {
      eventStreamSubscriptionRef.current?.reportVisibility(true, currentSessionId)
    }
  }, [currentSessionId, isConnected])

  return { isConnected, error, isReconnecting }
}
