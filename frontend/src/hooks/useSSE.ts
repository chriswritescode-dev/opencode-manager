import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOpenCodeClient } from './useOpenCode'
import type { SSEEvent, MessageListResponse } from '@/api/types'
import { showToast } from '@/lib/toast'
import { settingsApi } from '@/api/settings'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useSessionTodos } from '@/stores/sessionTodosStore'
import { subscribeToSSE, reconnectSSE, addSSEDirectory, removeSSEDirectory } from '@/lib/sseManager'
import { parseOpenCodeError } from '@/lib/opencode-errors'

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


export const useSSE = (opcodeUrl: string | null | undefined, directory?: string, currentSessionId?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory)
  const queryClient = useQueryClient()
  const mountedRef = useRef(true)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const setSessionStatus = useSessionStatus((state) => state.setStatus)
  const setSessionTodos = useSessionTodos((state) => state.setTodos)

  const handleSSEEvent = useCallback((event: SSEEvent) => {
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
        const sessionID = part.sessionID
        const messageID = part.messageID
        
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
        setSessionStatus(sessionID, { type: 'idle' })
        showToast.dismiss(`compact-${sessionID}`)
        showToast.success('Session compacted')
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
          
          const updatedParts = msg.parts.map(part => {
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
          
          const msgUpdated = updatedParts !== msg.parts
          if ('completed' in msg.info.time && msg.info.time.completed && !msgUpdated) return msg
          
          return {
            ...msg,
            info: {
              ...msg.info,
              time: { ...msg.info.time, completed: now }
            },
            parts: updatedParts
          }
        })
        
        queryClient.setQueryData(['opencode', 'messages', opcodeUrl, sessionID, directory], updated)
        break
      }

      case 'todo.updated':
        if ('sessionID' in event.properties && 'todos' in event.properties) {
          const { sessionID, todos } = event.properties
          setSessionTodos(sessionID, todos)
          queryClient.invalidateQueries({ 
            queryKey: ['opencode', 'todos', opcodeUrl, sessionID, directory] 
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
        if ('sessionID' in event.properties && event.properties.sessionID === currentSessionId) break
        
        const parsed = parseOpenCodeError(event.properties.error)
        if (parsed) {
          showToast.error(parsed.title, {
            description: parsed.message,
            duration: 6000,
          })
        }
        break
      }

      default:
        break
    }
  }, [queryClient, opcodeUrl, directory, setSessionStatus, setSessionTodos, currentSessionId])

  const fetchInitialData = useCallback(async () => {
    if (!client || !mountedRef.current) return
    
    try {
      const statuses = await client.getSessionStatuses()
      if (mountedRef.current && statuses) {
        Object.entries(statuses).forEach(([sessionID, status]) => {
          setSessionStatus(sessionID, status)
        })
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('aborted')) {
        throw err
      }
    }
  }, [client, setSessionStatus])

  useEffect(() => {
    mountedRef.current = true
    
    if (!opcodeUrl) {
      setIsConnected(false)
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
        fetchInitialData()
      } else {
        setError('Connection lost. Reconnecting...')
      }
    }

    if (directory) {
      addSSEDirectory(directory)
    }

    const unsubscribe = subscribeToSSE(handleMessage, handleStatusChange)

    const handleReconnect = () => {
      reconnectSSE()
    }

    window.addEventListener('focus', handleReconnect)
    window.addEventListener('online', handleReconnect)

    return () => {
      mountedRef.current = false
      window.removeEventListener('focus', handleReconnect)
      window.removeEventListener('online', handleReconnect)
      unsubscribe()
      if (directory) {
        removeSSEDirectory(directory)
      }
    }
  }, [opcodeUrl, directory, handleSSEEvent, fetchInitialData])

  return { isConnected, error, isReconnecting }
}
