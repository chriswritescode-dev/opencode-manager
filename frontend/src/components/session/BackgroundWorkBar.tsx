import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, MoveDownRight, Square, Terminal } from 'lucide-react'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { readShellOutput, type ShellInfo } from '@/api/opencode'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useBackgroundSession } from '@/hooks/useOpenCode'
import { useKillShell, useSessionShells } from '@/hooks/useSessionShells'

const SHELL_OUTPUT_LIMIT = 50_000
const SHELL_OUTPUT_POLL_INTERVAL_MS = 1000
const BACKGROUNDABLE_TOOLS = new Set(['shell', 'subagent'])

function hasBackgroundableWork(messages: SessionMessageInfo[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.type !== 'assistant' || message.time.completed !== undefined) continue
    return message.content.some(
      (part) => part.type === 'tool' && part.state.status === 'running' && BACKGROUNDABLE_TOOLS.has(part.name),
    )
  }
  return false
}

interface ShellOutputState {
  output: string
  truncated: boolean
}

function appendShellOutput(previous: ShellOutputState, output: string, truncated: boolean): ShellOutputState {
  const next = previous.output + output
  if (next.length <= SHELL_OUTPUT_LIMIT) return { output: next, truncated: previous.truncated || truncated }
  return { output: next.slice(-SHELL_OUTPUT_LIMIT), truncated: true }
}

function useShellOutput(shellID: string, directory: string, running: boolean): ShellOutputState {
  const [state, setState] = useState<ShellOutputState>({ output: '', truncated: false })
  const cursorRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let loading = false

    const load = async () => {
      if (loading) return
      loading = true
      let cursor = cursorRef.current
      let output = ''
      let truncated = false
      try {
        for (;;) {
          const chunk = await readShellOutput(shellID, directory, cursor, SHELL_OUTPUT_LIMIT)
          output += chunk.output
          if (chunk.truncated) truncated = true
          if (chunk.cursor <= cursor) break
          cursor = chunk.cursor
          if (cursor >= chunk.size) break
          const tail = chunk.size - SHELL_OUTPUT_LIMIT
          if (tail > cursor) {
            cursor = tail
            output = ''
            truncated = true
          }
        }
      } catch {
        return
      } finally {
        loading = false
        if (!cancelled) {
          cursorRef.current = cursor
          if (output || truncated) setState((previous) => appendShellOutput(previous, output, truncated))
        }
      }
    }

    void load()
    if (!running) {
      return () => {
        cancelled = true
      }
    }
    const interval = setInterval(() => void load(), SHELL_OUTPUT_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [shellID, directory, running])

  return state
}

function ShellOutputView({ shell, directory, running }: { shell: ShellInfo; directory: string; running: boolean }) {
  const { output, truncated } = useShellOutput(shell.id, directory, running)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [output])

  return (
    <div className="max-h-[60vh] overflow-auto rounded bg-accent p-2">
      <pre className="whitespace-pre-wrap break-all text-xs">
        {truncated && <span className="text-muted-foreground">[earlier output omitted]{'\n'}</span>}
        {output || <span className="text-muted-foreground">{running ? 'Waiting for output…' : 'No output'}</span>}
      </pre>
      <div ref={bottomRef} />
    </div>
  )
}

interface BackgroundWorkBarProps {
  sessionID: string
  directory: string
  messages: SessionMessageInfo[]
  isSessionActive: boolean
}

export function BackgroundWorkBar({ sessionID, directory, messages, isSessionActive }: BackgroundWorkBarProps) {
  const shells = useSessionShells(sessionID, directory)
  const killShell = useKillShell(directory)
  const backgroundSession = useBackgroundSession()
  const [expanded, setExpanded] = useState(false)
  const [viewing, setViewing] = useState<ShellInfo | null>(null)

  const canBackground = isSessionActive && hasBackgroundableWork(messages)
  const viewingRunning = viewing !== null && shells.some((shell) => shell.id === viewing.id)

  if (!canBackground && shells.length === 0 && viewing === null) return null

  return (
    <div className="mb-1 flex flex-col gap-1 px-1 text-xs">
      <div className="flex items-center gap-2">
        {canBackground && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={backgroundSession.isPending}
            onClick={() => backgroundSession.mutate(sessionID)}
            title="Let running shell commands and subagents continue in the background"
          >
            {backgroundSession.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <MoveDownRight className="h-3 w-3" />}
            Move to background
          </Button>
        )}
        {shells.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="ml-auto flex items-center gap-1 rounded-md border border-border bg-card/60 px-2 py-1 text-muted-foreground hover:text-foreground"
            aria-expanded={expanded}
          >
            <Loader2 className="h-3 w-3 animate-spin text-warning" />
            {shells.length} background shell{shells.length === 1 ? '' : 's'}
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>

      {expanded && shells.length > 0 && (
        <ul className="rounded-md border border-border bg-card/60">
          {shells.map((shell) => (
            <li key={shell.id} className="flex items-center gap-2 border-b border-border px-2 py-1 last:border-b-0">
              <Terminal className="h-3 w-3 shrink-0 text-success" />
              <span className="min-w-0 flex-1 truncate font-mono" title={shell.command}>{shell.command}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setViewing(shell)}>
                Output
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                disabled={killShell.isPending && killShell.variables === shell.id}
                onClick={() => killShell.mutate(shell.id)}
                aria-label={`Kill ${shell.command}`}
              >
                <Square className="h-3 w-3" />
                Kill
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={viewing !== null} onOpenChange={(open) => { if (!open) setViewing(null) }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate font-mono text-sm">{viewing?.command}</DialogTitle>
            <DialogDescription>{viewingRunning ? 'Running in the background' : 'Finished'}</DialogDescription>
          </DialogHeader>
          {viewing && <ShellOutputView key={viewing.id} shell={viewing} directory={directory} running={viewingRunning} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
