import { useEffect, useRef, useCallback, useState } from 'react'
import { API_BASE_URL } from '@/config'
import { io, Socket } from 'socket.io-client'

interface UseTerminalOptions {
  sessionId: string
  cwd?: string
  autoConnect?: boolean
  onData?: (data: string) => void
  onExit?: (exitCode: number, signal?: number) => void
  onConnect?: () => void
  onDisconnect?: () => void
  onError?: (error: Error) => void
}

function getSocketUrl(): string {
  // Check if we're running behind a proxy/tunnel (like Cloudflare or ngrok)
  const isTunnel = window.location.hostname.endsWith('.trycloudflare.com') || 
                  window.location.hostname.endsWith('.ngrok.io') ||
                  window.location.hostname.endsWith('.ngrok-free.app');

  if (!isTunnel && API_BASE_URL && API_BASE_URL.startsWith('http')) {
    return API_BASE_URL
  }
  
  // If we are in a tunnel, or no API_BASE_URL is set, use the current origin
  // This ensures that if the page is loaded via https, the WSS connection also uses SSL
  
  // Make sure to strip credentials from the origin if present (e.g. user:pass@host)
  try {
    const url = new URL(window.location.href)
    url.username = ''
    url.password = ''
    return url.origin
  } catch {
    return window.location.origin
  }
}

export function useTerminal(options: UseTerminalOptions) {
  const { sessionId, cwd, autoConnect = true } = options
  const optionsRef = useRef(options)
  optionsRef.current = options
  
  const socketRef = useRef<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const connectingRef = useRef(false)

  const connect = useCallback(() => {
    if (socketRef.current?.connected || connectingRef.current) {
      console.log('[Terminal] Already connected or connecting')
      return
    }

    connectingRef.current = true
    const socketUrl = getSocketUrl()
    console.log('[Terminal] Connecting to Socket.IO at:', socketUrl)
    
    // Explicitly configure path to match backend configuration
    const socket = io(socketUrl, {
      path: '/api/terminal/socket.io',
      query: {
        sessionId,
        cwd
      },
      transports: ['polling', 'websocket'], // Start with polling for better reliability behind tunnels
      withCredentials: true, // Required for Cloudflare Tunnel / Access to send cookies
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      forceNew: true // Ensure a new connection is created for each session
    })
    
    socketRef.current = socket
    
    socket.on('connect', () => {
      console.log('[Terminal] Socket.IO Connected!', socket.id)
      connectingRef.current = false
      setIsConnected(true)
      optionsRef.current.onConnect?.()
    })

    socket.on('output', (data: string) => {
      optionsRef.current.onData?.(data)
    })

    socket.on('exit', (data: { exitCode: number, signal?: number }) => {
      optionsRef.current.onExit?.(data.exitCode, data.signal)
    })

    socket.on('disconnect', (reason) => {
      console.log('[Terminal] Socket.IO Disconnected:', reason)
      connectingRef.current = false
      setIsConnected(false)
      optionsRef.current.onDisconnect?.()
    })

    socket.on('connect_error', (error) => {
      console.error('[Terminal] Socket.IO Connection Error:', error)
      connectingRef.current = false
      optionsRef.current.onError?.(error)
    })

  }, [sessionId, cwd])

  const disconnect = useCallback(() => {
    connectingRef.current = false
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    setIsConnected(false)
  }, [])

  const write = useCallback((data: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('input', data)
    }
  }, [])

  const resize = useCallback((cols: number, rows: number) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('resize', { cols, rows })
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
