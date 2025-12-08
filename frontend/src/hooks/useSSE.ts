import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOpenCodeClient } from './useOpenCode'
import type { SSEEvent, MessageListResponse } from '@/api/types'
import { permissionEvents } from './usePermissionRequests'
import { showToast } from '@/lib/toast'
import { settingsApi } from '@/api/settings'
import { useSessionStatus } from '@/stores/sessionStatusStore'

const MAX_RECONNECT_DELAY = 30000
const INITIAL_RECONNECT_DELAY = 1000

const handleRestartServer = async () => {
  showToast.loading('Restarting OpenCode server...', {
    id: 'restart-server',
  })
  
  try {
    const result = await settingsApi.restartOpenCodeServer()
    if (result.success) {
      showToast.success(result.message || 'OpenCode server restarted successfully', {
        id: 'restart-server',
        duration: 3000,
      })
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } else {
      showToast.error(result.message || 'Failed to restart OpenCode server', {
        id: 'restart-server',
        duration: 5000,
      })
    }
  } catch (error) {
    showToast.error(error instanceof Error ? error.message : 'Failed to restart OpenCode server', {
      id: 'restart-server',
      duration: 5000,
    })
  }
}


export const useSSE = (opcodeUrl: string | null | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory)
  const queryClient = useQueryClient()
  const eventSourceRef = useRef<EventSource | null>(null)
  const urlRef = useRef<string | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY)
  const mountedRef = useRef(true)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const setSessionStatus = useSessionStatus((state) => state.setStatus)

  const scheduleReconnect = useCallback((connectFn: () => void) => {
    if (!mountedRef.current) return
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    
    const delay = reconnectDelayRef.current
    setIsReconnecting(true)
    
    reconnectTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY)
      connectFn()
    }, delay)
  }, [])

  const resetReconnectDelay = useCallback(() => {
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY
    setIsReconnecting(false)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    
    if (!client) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
        urlRef.current = null
        setIsConnected(false)
      }
      return
    }

    const eventSourceUrl = client.getEventSourceURL()
    
    if (urlRef.current === eventSourceUrl && eventSourceRef.current) {
      return
    }
    
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    
    urlRef.current = eventSourceUrl

    const handleSSEEvent = (event: SSEEvent) => {
      switch (event.type) {
        case 'session.updated':
          queryClient.invalidateQueries({ queryKey: ['opencode', 'sessions', opcodeUrl, directory] })
          if ('info' in event.properties) {
            queryClient.invalidateQueries({ 
              queryKey: ['opencode', 'session', opcodeUrl, event.properties.info.id, directory] 
            })
          }
          break

        case 'session.deleted':
          queryClient.invalidateQueries({ queryKey: ['opencode', 'sessions', opcodeUrl, directory] })
          if ('sessionID' in event.properties) {
            queryClient.invalidateQueries({ 
              queryKey: ['opencode', 'session', opcodeUrl, event.properties.sessionID, directory] 
            })
          }
          break

        case 'message.part.updated':
        case 'messagev2.part.updated': {
          if (!('part' in event.properties)) break
          
          const { part } = event.properties
          const sessionID = part.sessionID
          const messageID = part.messageID
          
          if (part.type === 'retry') {
            const retryPart = part as { attempt: number; error: { data: { message: string } } }
            setSessionStatus(sessionID, { 
              type: 'retry', 
              attempt: retryPart.attempt,
              message: retryPart.error?.data?.message || 'Retrying...',
              next: Date.now() + 5000
            })
          }
          
          const currentData = queryClient.getQueryData<MessageListResponse>(['opencode', 'messages', opcodeUrl, sessionID, directory])
          if (!currentData) return
          
          const messageExists = currentData.some(msg => msg.info.id === messageID)
          if (!messageExists) return
          
          const updated = currentData.map(msg => {
            if (msg.info.id !== messageID) return msg
            
            const existingPartIndex = msg.parts.findIndex(p => p.id === part.id)
            
            if (existingPartIndex >= 0) {
              const newParts = [...msg.parts]
              newParts[existingPartIndex] = { ...part }
              return { 
                info: { ...msg.info }, 
                parts: newParts 
              }
            } else {
              return { 
                info: { ...msg.info }, 
                parts: [...msg.parts, { ...part }] 
              }
            }
          })
          
          queryClient.setQueryData(['opencode', 'messages', opcodeUrl, sessionID, directory], updated)
          break
        }

        case 'message.updated':
        case 'messagev2.updated': {
          if (!('info' in event.properties)) break
          
          const { info } = event.properties
          const sessionID = info.sessionID
          
          if (info.role === 'assistant') {
            const isComplete = 'completed' in info.time && info.time.completed
            if (!isComplete) {
              setSessionStatus(sessionID, { type: 'busy' })
            }
          }
          
          const currentData = queryClient.getQueryData<MessageListResponse>(['opencode', 'messages', opcodeUrl, sessionID, directory])
          if (!currentData) {
            queryClient.setQueryData(['opencode', 'messages', opcodeUrl, sessionID, directory], [{ info, parts: [] }])
            return
          }
          
          const messageExists = currentData.some(msg => msg.info.id === info.id)
          
          if (!messageExists) {
            const filteredData = info.role === 'user' 
              ? currentData.filter(msg => !msg.info.id.startsWith('optimistic_'))
              : currentData
            queryClient.setQueryData(['opencode', 'messages', opcodeUrl, sessionID, directory], [...filteredData, { info, parts: [] }])
            return
          }
          
          const updated = currentData.map(msg => {
            if (msg.info.id !== info.id) return msg
            return { 
              info: { ...info }, 
              parts: [...msg.parts] 
            }
          })
          
          queryClient.setQueryData(['opencode', 'messages', opcodeUrl, sessionID, directory], updated)
          break
        }

        case 'message.removed':
        case 'messagev2.removed': {
          if (!('sessionID' in event.properties && 'messageID' in event.properties)) break
          
          const { sessionID, messageID } = event.properties
          
          queryClient.setQueryData<MessageListResponse>(
            ['opencode', 'messages', opcodeUrl, sessionID, directory],
            (old) => {
              if (!old) return old
              return old.filter(msg => msg.info.id !== messageID)
            }
          )
          break
        }

        case 'message.part.removed':
        case 'messagev2.part.removed': {
          if (!('sessionID' in event.properties && 'messageID' in event.properties && 'partID' in event.properties)) break
          
          const { sessionID, messageID, partID } = event.properties
          
          queryClient.setQueryData<MessageListResponse>(
            ['opencode', 'messages', opcodeUrl, sessionID, directory],
            (old) => {
              if (!old) return old
              
              return old.map(msg => {
                if (msg.info.id !== messageID) return msg
                return {
                  ...msg,
                  parts: msg.parts.filter(p => p.id !== partID)
                }
              })
            }
          )
          break
        }

        case 'session.compacted': {
          if (!('sessionID' in event.properties)) break
          
          const { sessionID } = event.properties
          queryClient.invalidateQueries({ 
            queryKey: ['opencode', 'messages', opcodeUrl, sessionID, directory] 
          })
          break
        }

        case 'session.idle': {
          if (!('sessionID' in event.properties)) break
          
          const { sessionID } = event.properties
          
          setSessionStatus(sessionID, { type: 'idle' })
          
          const currentData = queryClient.getQueryData<MessageListResponse>(['opencode', 'messages', opcodeUrl, sessionID, directory])
          if (!currentData) break
          
          const now = Date.now()
          const updated = currentData.map(msg => {
            if (msg.info.role !== 'assistant') return msg
            if ('completed' in msg.info.time && msg.info.time.completed) return msg
            return {
              ...msg,
              info: {
                ...msg.info,
                time: { ...msg.info.time, completed: now }
              }
            }
          })
          
          queryClient.setQueryData(['opencode', 'messages', opcodeUrl, sessionID, directory], updated)
          break
        }

        case 'permission.updated':
          if ('id' in event.properties) {
            permissionEvents.emit({ type: 'add', permission: event.properties })
          }
          break

        case 'permission.replied':
          if ('permissionID' in event.properties) {
            permissionEvents.emit({ type: 'remove', permissionID: event.properties.permissionID })
          }
          break

        case 'todo.updated':
          if ('sessionID' in event.properties) {
            queryClient.invalidateQueries({ 
              queryKey: ['opencode', 'todos', opcodeUrl, event.properties.sessionID, directory] 
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
                label: 'Restart to Update',
                onClick: handleRestartServer
              },
              duration: 10000,
            })
          }
          break

        default:
          break
      }
    }
    
    const connectSSE = () => {
      if (!mountedRef.current) return
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }

      try {
        const eventSource = new EventSource(eventSourceUrl)
        eventSourceRef.current = eventSource

        eventSource.onopen = () => {
          if (!mountedRef.current) return
          setIsConnected(true)
          setError(null)
          resetReconnectDelay()
        }

        eventSource.onerror = () => {
          if (!mountedRef.current) return
          
          setIsConnected(false)
          setError('Connection lost. Reconnecting...')
          
          if (eventSourceRef.current) {
            eventSourceRef.current.close()
            eventSourceRef.current = null
          }
          
          scheduleReconnect(connectSSE)
        }

        eventSource.onmessage = (event) => {
          try {
            const data: SSEEvent = JSON.parse(event.data)
            handleSSEEvent(data)
          } catch (err) {
            console.error('Failed to parse SSE event:', err)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect')
        setIsConnected(false)
        scheduleReconnect(connectSSE)
      }
    }

    const handleReconnect = () => {
      if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
        resetReconnectDelay()
        connectSSE()
      }
    }

    connectSSE()

    window.addEventListener('focus', handleReconnect)
    window.addEventListener('online', handleReconnect)

    return () => {
      mountedRef.current = false
      window.removeEventListener('focus', handleReconnect)
      window.removeEventListener('online', handleReconnect)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
        setIsConnected(false)
      }
    }
  }, [client, queryClient, opcodeUrl, directory, scheduleReconnect, resetReconnectDelay, setSessionStatus])

  return { isConnected, error, isReconnecting }
}
