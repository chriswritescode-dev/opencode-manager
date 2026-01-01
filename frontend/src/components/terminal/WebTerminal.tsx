import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useTerminal } from '@/hooks/useTerminal'
import { cn } from '@/lib/utils'
import { Maximize2, Minimize2, RotateCcw, X } from 'lucide-react'

interface WebTerminalProps {
  sessionId: string
  cwd?: string
  className?: string
  onClose?: () => void
  showControls?: boolean
  onMaximize?: () => void
  onMinimize?: () => void
  isMaximized?: boolean
}

export function WebTerminal({
  sessionId,
  cwd,
  className,
  onClose,
  showControls = true,
  onMaximize,
  onMinimize,
  isMaximized = false,
}: WebTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const writeRef = useRef<(data: string) => void>(() => {})
  const resizeRef = useRef<(cols: number, rows: number) => void>(() => {})
  const [terminalReady, setTerminalReady] = useState(false)

  const handleData = useCallback((data: string) => {
    terminalRef.current?.write(data)
  }, [])

  const handleExit = useCallback((exitCode: number) => {
    terminalRef.current?.write(`\r\n\x1b[33mProcess exited with code ${exitCode}\x1b[0m\r\n`)
  }, [])

  const handleConnect = useCallback(() => {
    terminalRef.current?.write('\x1b[32mConnected to terminal\x1b[0m\r\n')
  }, [])

  const handleDisconnect = useCallback(() => {
    terminalRef.current?.write('\r\n\x1b[31mDisconnected from terminal\x1b[0m\r\n')
  }, [])

  const { isConnected, write, resize, connect: reconnect } = useTerminal({
    sessionId,
    cwd,
    autoConnect: true,
    onData: handleData,
    onExit: handleExit,
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
  })

  writeRef.current = write
  resizeRef.current = resize

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return

    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      // rendererType is not valid in standard xterm.js options, but we are using dom renderer by default in recent versions
      // or we can remove it if it's causing type errors and rely on default
      theme: {
        background: '#0a0a0a',
        foreground: '#e4e4e7',
        cursor: '#e4e4e7',
        cursorAccent: '#0a0a0a',
        selectionBackground: '#3f3f46',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#fafafa',
      },
      scrollback: 5000,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.open(containerRef.current)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    setTimeout(() => {
      fitAddon.fit()
      setTerminalReady(true)
    }, 0)

    terminal.onData((data) => {
      writeRef.current(data)
    })

    terminal.onResize(({ cols, rows }) => {
      resizeRef.current(cols, rows)
    })

    const handleWindowResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit()
      }
    }

    window.addEventListener('resize', handleWindowResize)

    return () => {
      window.removeEventListener('resize', handleWindowResize)
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => {
    if (terminalReady && fitAddonRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit()
        if (terminalRef.current) {
          const { cols, rows } = terminalRef.current
          resizeRef.current(cols, rows)
        }
      }, 100)
    }
  }, [isMaximized, terminalReady])

  const handleReconnect = useCallback(() => {
    reconnect()
  }, [reconnect])

  return (
    <div className={cn('flex flex-col bg-[#0a0a0a] rounded-lg overflow-hidden border border-border', className)}>
      {showControls && (
        <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-border">
          <div className="flex items-center gap-2">
            <div className={cn(
              'w-2 h-2 rounded-full',
              isConnected ? 'bg-green-500' : 'bg-red-500'
            )} />
            <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
              {cwd?.split('/').slice(-2).join('/') || 'Terminal'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleReconnect}
              className="p-1.5 rounded hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition-colors"
              title="Reconnect"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            {onMaximize && onMinimize && (
              <button
                onClick={isMaximized ? onMinimize : onMaximize}
                className="p-1.5 rounded hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition-colors"
                title={isMaximized ? 'Minimize' : 'Maximize'}
              >
                {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded hover:bg-zinc-800 text-muted-foreground hover:text-red-400 transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
      <div 
        ref={containerRef} 
        className="flex-1 min-h-0 p-1"
        style={{ minHeight: '200px' }}
      />
    </div>
  )
}
