import { useCallback, useEffect, useRef, useState } from 'react'
import { terminalConnectPath, type TerminalTarget } from '@/lib/terminal-target'
import { TerminalFrameDecoder } from '@/lib/terminal-protocol'
import { toWebSocketUrl } from '@/lib/websocket-url'

export type TerminalSocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface UseTerminalSocketOptions {
  target: TerminalTarget
  directory: string | undefined
  ptyID: string
  onOutput: (text: string) => void
  onExit: () => void
  enabled: boolean
}

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 5000, 5000]
const TERMINAL_CLOSE_CODES = new Set([1000, 4404])

function buildSocketUrl(
  connectPath: string,
  directory: string | undefined,
  cursor: number | undefined,
): string {
  const params = new URLSearchParams()
  if (directory !== undefined) params.set('directory', directory)
  if (cursor !== undefined) params.set('cursor', String(cursor))
  const query = params.toString()
  return toWebSocketUrl(`${connectPath}${query ? `?${query}` : ''}`)
}

export function useTerminalSocket({
  target,
  directory,
  ptyID,
  onOutput,
  onExit,
  enabled,
}: UseTerminalSocketOptions) {
  const socketRef = useRef<WebSocket | null>(null)
  const cursorRef = useRef<number | undefined>(undefined)
  const onOutputRef = useRef(onOutput)
  const onExitRef = useRef(onExit)
  onOutputRef.current = onOutput
  onExitRef.current = onExit

  const connectPath = terminalConnectPath(target, ptyID)

  const [status, setStatus] = useState<TerminalSocketStatus>(enabled ? 'connecting' : 'closed')

  const send = useCallback((data: string) => {
    const socket = socketRef.current
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(data)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setStatus('closed')
      return
    }

    let disposed = false
    let attempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    const decoder = new TerminalFrameDecoder()
    cursorRef.current = undefined

    const connect = () => {
      if (disposed) return
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting')

      const socket = new WebSocket(buildSocketUrl(connectPath, directory, cursorRef.current))
      socket.binaryType = 'arraybuffer'
      socketRef.current = socket

      socket.onopen = () => {
        if (disposed || socketRef.current !== socket) return
        setStatus('open')
      }

      socket.onmessage = (event) => {
        if (disposed || socketRef.current !== socket) return
        const frame = decoder.decode(event.data as string | ArrayBuffer)
        if (frame.type === 'cursor') {
          attempt = 0
          cursorRef.current = frame.cursor
          return
        }
        cursorRef.current = (cursorRef.current ?? 0) + frame.text.length
        onOutputRef.current(frame.text)
      }

      socket.onclose = (event) => {
        if (disposed || socketRef.current !== socket) return
        socketRef.current = null

        if (TERMINAL_CLOSE_CODES.has(event.code)) {
          setStatus('closed')
          onExitRef.current()
          return
        }

        if (attempt >= RECONNECT_DELAYS_MS.length) {
          setStatus('closed')
          return
        }

        const delay = RECONNECT_DELAYS_MS[attempt]
        attempt += 1
        setStatus('reconnecting')
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      const socket = socketRef.current
      socketRef.current = null
      if (socket) {
        socket.onopen = null
        socket.onmessage = null
        socket.onclose = null
        socket.onerror = null
        socket.close()
      }
    }
  }, [connectPath, directory, enabled])

  return { send, status }
}
