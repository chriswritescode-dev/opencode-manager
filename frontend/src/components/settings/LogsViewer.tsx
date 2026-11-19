import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Pause, Play, Trash2 } from 'lucide-react'
import { z } from 'zod'
import type { ManagerLogLevel, ManagerLogSource } from '@opencode-manager/shared/schemas'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { useManagerLogs } from '@/hooks/useManagerLogs'
import { getOpenCodeServerIssue, useServerHealth, type OpenCodeServerIssue } from '@/hooks/useServerHealth'
import { DEFAULTS } from '@/config'
import { cn } from '@/lib/utils'

const ISSUE_TITLES = {
  failed: 'OpenCode server failed',
  recovering: 'OpenCode server is recovering',
  unhealthy: 'OpenCode server is unhealthy',
} satisfies Record<OpenCodeServerIssue['state'], string>

const levelFilterSchema = z.enum(['all', 'info', 'warn', 'error'])
const sourceFilterSchema = z.enum(['all', 'manager', 'opencode'])

type LevelFilter = z.infer<typeof levelFilterSchema>
type SourceFilter = z.infer<typeof sourceFilterSchema>

const SOURCE_LABELS = {
  manager: 'Manager',
  opencode: 'OpenCode server',
} satisfies Record<ManagerLogSource, string>

const LEVEL_OPTIONS: Array<{ value: LevelFilter; label: string }> = [
  { value: 'all', label: 'All levels' },
  { value: 'info', label: 'Info and above' },
  { value: 'warn', label: 'Warnings and above' },
  { value: 'error', label: 'Errors' },
]

const SOURCE_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'manager', label: SOURCE_LABELS.manager },
  { value: 'opencode', label: SOURCE_LABELS.opencode },
]

const LEVEL_CHIP_CLASSES = {
  error: 'bg-destructive/15 text-destructive',
  warn: 'bg-warning/15 text-warning',
  info: 'bg-accent text-accent-foreground',
  debug: 'bg-muted text-muted-foreground',
} satisfies Record<ManagerLogLevel, string>

export function LogsViewer() {
  const [level, setLevel] = useState<LevelFilter>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [search, setSearch] = useState('')
  const [paused, setPaused] = useState(false)
  const [isFollowing, setIsFollowing] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { data: health } = useServerHealth()
  const serverIssue = getOpenCodeServerIssue(health)

  const { entries, dropped, clear } = useManagerLogs({
    level: level === 'all' ? undefined : level,
    source: source === 'all' ? undefined : source,
    paused,
  })

  const displayedEntries = useMemo(() => {
    const query = search.toLowerCase()
    if (!query) return entries
    return entries.filter((entry) => entry.message.toLowerCase().includes(query))
  }, [entries, search])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || !isFollowing) return
    container.scrollTop = container.scrollHeight
  }, [displayedEntries, isFollowing])

  const handleScroll = () => {
    const container = scrollRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    setIsFollowing(distanceFromBottom <= 48)
  }

  const copyContent = displayedEntries
    .map((entry) => `${entry.timestamp} ${entry.level} ${entry.source} ${entry.message}`)
    .join('\n')

  return (
    <Card className="flex h-full min-h-0 flex-col border-0 bg-transparent shadow-none">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-0">
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Select value={level} onValueChange={(value) => {
            const parsed = levelFilterSchema.safeParse(value)
            if (parsed.success) setLevel(parsed.data)
          }}>
            <SelectTrigger className="min-w-0 flex-1 sm:w-44 sm:flex-none" aria-label="Log level filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVEL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={(value) => {
            const parsed = sourceFilterSchema.safeParse(value)
            if (parsed.success) setSource(parsed.data)
          }}>
            <SelectTrigger className="min-w-0 flex-1 sm:w-44 sm:flex-none" aria-label="Log source filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search messages"
            className="order-last w-full sm:order-none sm:w-56"
            aria-label="Search log messages"
          />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="px-2 sm:px-3" aria-label={paused ? 'Resume' : 'Pause'} onClick={() => setPaused((value) => !value)}>
              {paused ? <Play /> : <Pause />}
              <span className="hidden sm:inline">{paused ? 'Resume' : 'Pause'}</span>
            </Button>
            <Button variant="outline" size="sm" className="px-2 sm:px-3" aria-label="Clear" onClick={clear}>
              <Trash2 />
              <span className="hidden sm:inline">Clear</span>
            </Button>
            <CopyButton content={copyContent} title="Copy log entries" variant="ghost" />
          </div>
        </div>
        {serverIssue && (
          <Alert variant={serverIssue.state === 'failed' ? 'destructive' : 'default'} className="shrink-0">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{ISSUE_TITLES[serverIssue.state]}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs">{serverIssue.message}</p>
              {serverIssue.attemptedRecoveryActions.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Recovery attempted: {serverIssue.attemptedRecoveryActions.map((action) => action.replaceAll('_', ' ')).join(', ')}
                </p>
              )}
              {(level !== 'error' || source !== 'all') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLevel('error')
                    setSource('all')
                  }}
                >
                  Show errors only
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-2 font-mono text-xs"
        >
          {entries.length === 0 ? (
            <p className="p-4 text-center font-sans text-muted-foreground">No log entries captured yet.</p>
          ) : (
            displayedEntries.map((entry) => (
              <div key={entry.seq} className="flex min-w-0 gap-2">
                <div className="flex w-20 shrink-0 flex-col items-start gap-1 border-r border-border pr-2 text-xs sm:w-auto sm:flex-row sm:items-center sm:gap-2 sm:border-r-0 sm:pr-0">
                  <span className="whitespace-nowrap text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 uppercase',
                      LEVEL_CHIP_CLASSES[entry.level]
                    )}
                  >
                    {entry.level}
                  </span>
                  <span className="max-w-full truncate text-muted-foreground">{SOURCE_LABELS[entry.source]}</span>
                </div>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{entry.message}</span>
              </div>
            ))
          )}
        </div>
        {dropped > 0 && (
          <p className="shrink-0 text-xs text-muted-foreground">
            {dropped} earlier entries dropped (buffer holds {DEFAULTS.LOGS.BUFFER_CAPACITY})
          </p>
        )}
      </CardContent>
    </Card>
  )
}
