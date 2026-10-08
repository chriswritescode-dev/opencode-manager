import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CreatePreviewSessionResponse, PreviewPort } from '@opencode-manager/shared/types'
import { ExternalLink, Globe, Loader2, Monitor, RefreshCw, Smartphone, Tablet, X } from 'lucide-react'
import { createPreviewSession, usePreviewPorts } from '@/api/preview'
import { Button } from '@/components/ui/button'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useMobile } from '@/hooks/useMobile'
import { useUrlParams } from '@/hooks/useUrlParams'
import { getOpenCodeApiErrorMessage } from '@/lib/opencode-errors'
import { buildPreviewStartUrl, getPreviewOrigin, isSameOriginAsManager, parsePort } from '@/lib/preview-url'
import { cn, shortenPath } from '@/lib/utils'

interface PreviewPanelProps {
  isOpen: boolean
  onClose: () => void
  directory: string | undefined
}

interface PreviewWorkspaceProps {
  isOpen: boolean
  directory: string | undefined
  compact: boolean
}

type ViewportPreset = 'mobile' | 'tablet' | 'full'

const VIEWPORT_WIDTHS: Record<ViewportPreset, number | null> = {
  mobile: 390,
  tablet: 820,
  full: null,
}

const VIEWPORT_PRESETS: Array<{ preset: ViewportPreset; label: string; icon: typeof Monitor }> = [
  { preset: 'mobile', label: 'Mobile viewport', icon: Smartphone },
  { preset: 'tablet', label: 'Tablet viewport', icon: Tablet },
  { preset: 'full', label: 'Full width viewport', icon: Monitor },
]

const PORT_WAIT_TIMEOUT_MS = 60_000

function formatPortLabel(entry: PreviewPort): string {
  return entry.command ? `:${entry.port} ${entry.command}` : `:${entry.port}`
}

function toPortOptions(ports: PreviewPort[]): ComboboxOption[] {
  const hasRepoPorts = ports.some((entry) => entry.inDirectory)
  return ports.map((entry) => ({
    value: String(entry.port),
    label: formatPortLabel(entry),
    description: entry.cwd ? shortenPath(entry.cwd) : undefined,
    group: hasRepoPorts ? (entry.inDirectory ? 'This repo' : 'Other ports') : undefined,
  }))
}

function describeListeningPorts(count: number, qualifier = ''): string {
  return count === 1 ? `1 ${qualifier}port is listening` : `${count} ${qualifier}ports are listening`
}

interface ActiveSession {
  targetPort: number
  path: string
  renderKey: number
  data: CreatePreviewSessionResponse
}

export function PreviewWorkspace({ isOpen, directory, compact }: PreviewWorkspaceProps) {
  const { searchParams, updateParams } = useUrlParams()

  const requestedPort = useMemo(() => {
    const port = parsePort(searchParams.get('previewPort') ?? '')
    return port ?? undefined
  }, [searchParams])
  const requestedPath = searchParams.get('previewPath') || '/'

  const [pathDraft, setPathDraft] = useState(requestedPath)
  const [viewport, setViewport] = useState<ViewportPreset>('full')
  const [session, setSession] = useState<ActiveSession | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [waitExpired, setWaitExpired] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const sessionPortRef = useRef<number | null>(null)
  const activePathRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)

  const activeSession = session && session.targetPort === requestedPort ? session : null

  const portsQuery = usePreviewPorts(directory, {
    enabled: isOpen,
    refetchInterval: isOpen && !activeSession ? 2000 : false,
  })
  const ports = useMemo(() => portsQuery.data?.ports ?? [], [portsQuery.data])
  const portOptions = useMemo(() => toPortOptions(ports), [ports])
  const repoPorts = useMemo(() => ports.filter((entry) => entry.inDirectory), [ports])
  const enabled = portsQuery.data?.enabled ?? true
  const portListed = requestedPort !== undefined && ports.some((entry) => entry.port === requestedPort)

  useEffect(() => {
    setPathDraft(requestedPath)
  }, [requestedPath])

  useEffect(() => {
    if (!isOpen) {
      requestIdRef.current += 1
      sessionPortRef.current = null
      activePathRef.current = null
      setSession(null)
      setSessionError(null)
    }
  }, [isOpen])

  useEffect(() => {
    if (portListed) return
    requestIdRef.current += 1
    sessionPortRef.current = null
    activePathRef.current = null
    setSession(null)
  }, [portListed])

  useEffect(() => {
    if (!isOpen || !requestedPort || !enabled || portListed) {
      setWaitExpired(false)
      return
    }
    setWaitExpired(false)
    const timer = setTimeout(() => setWaitExpired(true), PORT_WAIT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [isOpen, requestedPort, enabled, portListed, retryNonce])

  const startSession = useCallback((port: number, path: string) => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    sessionPortRef.current = port
    activePathRef.current = path
    setSessionError(null)
    setSession(null)
    return createPreviewSession(port)
      .then((data) => {
        if (requestIdRef.current !== requestId) return
        setSession({ targetPort: port, path, renderKey: requestId, data })
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId) return
        sessionPortRef.current = null
        activePathRef.current = null
        setSessionError(getOpenCodeApiErrorMessage(error, 'Failed to start preview'))
      })
  }, [])

  useEffect(() => {
    if (!isOpen || !requestedPort || !enabled || !portListed) return
    if (sessionPortRef.current === requestedPort && activePathRef.current === requestedPath) return
    void startSession(requestedPort, requestedPath)
  }, [isOpen, requestedPort, requestedPath, enabled, portListed, startSession])

  const selectPort = useCallback((port: number) => {
    updateParams((params) => {
      params.set('previewPort', String(port))
      params.delete('previewPath')
    }, 'replace')
  }, [updateParams])

  const handlePortChange = useCallback((value: string) => {
    const port = parsePort(value)
    if (port) selectPort(port)
  }, [selectPort])

  const reload = useCallback(() => {
    if (!requestedPort) return
    void startSession(requestedPort, requestedPath)
  }, [requestedPort, requestedPath, startSession])

  const handleGo = useCallback(() => {
    const nextPath = pathDraft.trim() || '/'
    updateParams((params) => {
      params.set('previewPath', nextPath)
    }, 'replace')
    if (requestedPort) {
      void startSession(requestedPort, nextPath)
    }
  }, [pathDraft, requestedPort, updateParams, startSession])

  const handleOpenInNewTab = useCallback(() => {
    if (!requestedPort) return
    createPreviewSession(requestedPort)
      .then((data) => {
        window.open(buildPreviewStartUrl(data, requestedPath), '_blank', 'noopener,noreferrer')
      })
      .catch((error: unknown) => {
        setSessionError(getOpenCodeApiErrorMessage(error, 'Failed to open preview'))
      })
  }, [requestedPort, requestedPath])

  const retry = useCallback(() => {
    if (portListed && requestedPort) {
      void startSession(requestedPort, requestedPath)
      return
    }
    setWaitExpired(false)
    setRetryNonce((nonce) => nonce + 1)
    void portsQuery.refetch()
  }, [portListed, requestedPort, requestedPath, startSession, portsQuery])

  const previewOrigin = activeSession ? getPreviewOrigin(activeSession.data) : null
  const sameOrigin = previewOrigin ? isSameOriginAsManager(previewOrigin) : false
  const viewportWidth = VIEWPORT_WIDTHS[viewport]

  const renderMessage = (message: ReactNode, options: { retry?: boolean; alert?: boolean } = {}) => (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <div role={options.alert ? 'alert' : undefined} className="flex items-center gap-2">
        {message}
      </div>
      {options.retry && (
        <Button size="sm" variant="outline" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  )

  const renderPortChooser = () => {
    if (ports.length === 0) {
      return renderMessage(
        <div className="space-y-1">
          <p className="font-medium text-foreground">No dev server is listening</p>
          <p>Start one in the Terminal or from Actions. It appears here automatically.</p>
        </div>,
      )
    }
    if (repoPorts.length === 0) {
      return renderMessage(
        <div className="space-y-1">
          <p className="font-medium text-foreground">Select a port to preview</p>
          <p>{describeListeningPorts(ports.length)}. Choose one from the port menu above.</p>
        </div>,
      )
    }
    const otherPortCount = ports.length - repoPorts.length
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-3">
          <h3 className="text-sm font-medium text-foreground">Dev servers in this repo</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
            {repoPorts.map((entry) => (
              <li key={entry.port}>
                <button
                  type="button"
                  onClick={() => selectPort(entry.port)}
                  aria-label={formatPortLabel(entry)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span className="font-mono font-medium tabular-nums text-foreground">:{entry.port}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.command}</span>
                  {entry.cwd && (
                    <span className="max-w-[45%] truncate text-xs text-muted-foreground" title={entry.cwd}>
                      {shortenPath(entry.cwd)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {otherPortCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {describeListeningPorts(otherPortCount, 'other ')} elsewhere. Choose one from the port menu above.
            </p>
          )}
        </div>
      </div>
    )
  }

  const body = () => {
    if (!enabled) {
      return renderMessage('Preview is unavailable')
    }
    if (!requestedPort) {
      return renderPortChooser()
    }
    if (!portListed) {
      if (waitExpired) {
        return renderMessage(`Port ${requestedPort} is not listening`, { retry: true, alert: true })
      }
      return renderMessage(
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Waiting for port {requestedPort}…
        </>,
      )
    }
    if (sessionError) {
      return renderMessage(sessionError, { retry: true, alert: true })
    }
    if (activeSession) {
      if (sameOrigin) {
        return renderMessage('Preview must run on a different origin than OpenCode Manager.', { alert: true })
      }
      return (
        <div className="flex h-full justify-center overflow-hidden">
          <iframe
            key={activeSession.renderKey}
            title="Preview"
            src={buildPreviewStartUrl(activeSession.data, activeSession.path)}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            className="h-full border-0 bg-white"
            style={{ width: viewportWidth ?? '100%', maxWidth: '100%' }}
          />
        </div>
      )
    }
    return renderMessage(
      <>
        <Loader2 className="h-4 w-4 animate-spin" />
        Starting preview…
      </>,
    )
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div
        className={cn(
          'flex flex-col gap-2 border-b border-border px-3 py-2 flex-shrink-0',
          !compact && 'sm:flex-row sm:items-center',
        )}
      >
        <Combobox
          value={requestedPort ? String(requestedPort) : ''}
          onChange={handlePortChange}
          options={portOptions}
          placeholder="Select port"
          disabled={!enabled}
          allowCustomValue={false}
          ariaLabel="Preview port"
          onOpen={() => { void portsQuery.refetch() }}
          className={compact ? 'w-full' : 'sm:w-72 sm:flex-shrink-0'}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Input
            aria-label="Preview path"
            value={pathDraft}
            onChange={(event) => setPathDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') handleGo() }}
            className="h-9 min-w-0 flex-1 bg-transparent px-3 py-1"
            placeholder="/"
          />
          <Button size="sm" variant="outline" onClick={handleGo} disabled={!requestedPort} className="h-9">
            Go
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={reload}
            disabled={!requestedPort}
            aria-label="Reload preview"
            className="h-9 w-9 p-0"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleOpenInNewTab}
            disabled={!requestedPort}
            aria-label="Open preview in new tab"
            className="h-9 w-9 p-0"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          {!compact && (
            <div className="ml-auto hidden items-center gap-1 sm:flex">
              {VIEWPORT_PRESETS.map(({ preset, label, icon: Icon }) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={viewport === preset ? 'secondary' : 'ghost'}
                  onClick={() => setViewport(preset)}
                  aria-label={label}
                  aria-pressed={viewport === preset}
                  className="h-9 w-9 p-0"
                >
                  <Icon className="h-4 w-4" />
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="relative flex-1 min-h-0">{body()}</div>
    </div>
  )
}

export function PreviewPanel({ isOpen, onClose, directory }: PreviewPanelProps) {
  const isMobile = useMobile()
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        ref={contentRef}
        mobileFullscreen
        hideCloseButton={isMobile}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.focus()
        }}
        className={cn(
          'p-0 flex flex-col bg-card border-border gap-0 focus:outline-none',
          isMobile ? 'h-full' : 'w-[90vw] sm:max-w-6xl h-[90vh] sm:pb-0',
        )}
      >
        <DialogHeader className={cn('px-4 py-2 border-b border-border flex-shrink-0', isMobile && 'relative')}>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Preview
          </DialogTitle>
          {isMobile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close preview panel"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 p-0"
            >
              <X className="h-6 w-6" />
            </Button>
          )}
        </DialogHeader>

        <PreviewWorkspace isOpen={isOpen} directory={directory} compact={isMobile} />
      </DialogContent>
    </Dialog>
  )
}
