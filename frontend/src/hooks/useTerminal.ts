import { useEffect, useRef, useCallback, useState } from 'react'
import { API_BASE_URL } from '@/config'

interface TerminalMessage {
  type: 'output' | 'exit' | 'input' | 'resize'
  data?: string
  exitCode?: number
  signal?: number
  cols?: number
  rows?: number
}

interface UseTerminalOptions {
  sessionId: string
  cwd?: string
  autoConnect?: boolean
  onData?: (data: string) => void
  onExit?: (exitCode: number, signal?: number) => void
  onConnect?: () => void
  onDisconnect?: () => void
  onError?: (error: Event) => void
}

function getWebSocketUrl(sessionId: string, cwd?: string): string {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  
  let wsHost: string
  if (API_BASE_URL && API_BASE_URL.length > 0) {
    wsHost = API_BASE_URL.replace(/^https?:\/\//, '')
  } else {
    wsHost = `${window.location.hostname}:5001`
  }
  
  const wsUrl = new URL(`${wsProtocol}//${wsHost}/api/terminal/ws/${sessionId}`)
  
  if (cwd) {
    wsUrl.searchParams.set('cwd', cwd)
  }
  
  return wsUrl.toString()
}

export function useTerminal(options: UseTerminalOptions) {
  const { sessionId, cwd, autoConnect = true } = options
  const optionsRef = useRef(options)
  optionsRef.current = options
  
  const wsRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const connectingRef = useRef(false)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || connectingRef.current) {
      return
    }

    connectingRef.current = true
    const wsUrl = getWebSocketUrl(sessionId, cwd)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      connectingRef.current = false
      setIsConnected(true)
      optionsRef.current.onConnect?.()
    }

    ws.onmessage = (event) => {
      try {
        const message: TerminalMessage = JSON.parse(event.data)
        
        switch (message.type) {
          case 'output':
            if (message.data) {
              optionsRef.current.onData?.(message.data)
            }
            break
          case 'exit':
            optionsRef.current.onExit?.(message.exitCode ?? 0, message.signal)
            break
        }
      } catch (error) {
        console.error('Failed to parse terminal message:', error)
      }
    }

    ws.onclose = () => {
      connectingRef.current = false
      setIsConnected(false)
      optionsRef.current.onDisconnect?.()
      wsRef.current = null
    }

    ws.onerror = (error) => {
      connectingRef.current = false
      optionsRef.current.onError?.(error)
    }
  }, [sessionId, cwd])

  const disconnect = useCallback(() => {
    connectingRef.current = false
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsConnected(false)
  }, [])

  const write = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }))
    }
  }, [])

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }))
    }
  }, [])

  useEffect(() => {
    if (autoConnect) {
      const timer = setTimeout(() => {
        connect()
      }, 100)
      return () => {
        clearTimeout(timer)
        disconnect()
      }
    }
    return () => disconnect()
  }, [sessionId, cwd, autoConnect, connect, disconnect])

  return {
    isConnected,
    write,
    resize,
    connect,
    disconnect,
  }
}
