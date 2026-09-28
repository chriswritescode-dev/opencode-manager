import { useEffect, useMemo, useRef, useState } from 'react'
import { Ban, Bot, Check, ChevronDown, ChevronUp, ExternalLink, Loader2, MoveDownRight, Square, Terminal, XCircle } from 'lucide-react'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { readShellOutput } from '@/api/opencode'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useBackgroundSession, useChildSessionReconciliation } from '@/hooks/useOpenCode'
import { useKillShell, useSessionShells } from '@/hooks/useSessionShells'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import {
  BACKGROUNDABLE_TOOLS,
  isRunningLifecycle,
  lifecycleLabel,
  shellBackgroundTasks,
  shellLifecycle,
  subagentBackgroundTasks,
  type BackgroundTask,
  type BackgroundTaskLifecycle,
  type ShellRecord,
} from '@/lib/backgroundWork'

const SHELL_OUTPUT_LIMIT = 50_000
const SHELL_OUTPUT_POLL_INTERVAL_MS = 1000

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

function ShellOutputView({ shell, directory, running }: { shell: ShellRecord; directory: string; running: boolean }) {
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

function BackgroundTaskStatusIcon({ status }: { status: BackgroundTaskLifecycle }) {
  if (status === 'completed') return <Check className="h-3 w-3 text-success" />
  if (status === 'failed') return <XCircle className="h-3 w-3 text-destructive" />
  if (status === 'interrupted') return <Ban className="h-3 w-3 text-warning" />
  if (status === 'killed') return <Square className="h-3 w-3 text-warning" />
  if (status === 'unavailable') return <XCircle className="h-3 w-3 text-muted-foreground" />
  return <Loader2 className="h-3 w-3 animate-spin text-warning" />
}

function BackgroundTaskKindIcon({ task }: { task: BackgroundTask }) {
  return task.kind === 'shell'
    ? <Terminal className="h-3 w-3 shrink-0 text-success" />
    : <Bot className="h-3 w-3 shrink-0 text-info" />
}

function BackgroundTaskReconciler({ sessionID }: { sessionID: string }) {
  useChildSessionReconciliation(sessionID)
  return null
}

function BackgroundTaskRow({
  task,
  killShell,
  onChildSessionClick,
  onView,
}: {
  task: BackgroundTask
  killShell: ReturnType<typeof useKillShell>
  onChildSessionClick?: (sessionId: string) => void
  onView: (shell: ShellRecord) => void
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1 last:border-b-0">
      <BackgroundTaskKindIcon task={task} />
      <span className="min-w-0 flex-1 truncate font-mono" title={task.label}>{task.label}</span>
      <span className="flex items-center gap-1 text-muted-foreground">
        <BackgroundTaskStatusIcon status={task.status} />
        {lifecycleLabel(task.status)}
      </span>
      {task.kind === 'shell' && task.shell && (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onView(task.shell!)}>
          Output
        </Button>
      )}
      {task.kind === 'shell' && task.status === 'running' && task.shell && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive"
          disabled={killShell.isPending && killShell.variables === task.shell.id}
          onClick={() => killShell.mutate(task.shell!.id)}
          aria-label={`Kill ${task.label}`}
        >
          <Square className="h-3 w-3" />
          Kill
        </Button>
      )}
      {task.kind === 'subagent' && task.childSessionID && onChildSessionClick && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={() => onChildSessionClick(task.childSessionID!)}
          aria-label={`View ${task.label}`}
        >
          <ExternalLink className="h-3 w-3" />
          View
        </Button>
      )}
    </li>
  )
}

interface BackgroundWorkBarProps {
  sessionID: string
  directory: string
  messages: SessionMessageInfo[]
  isSessionActive: boolean
  onChildSessionClick?: (sessionId: string) => void
}

export function BackgroundWorkBar({ sessionID, directory, messages, isSessionActive, onChildSessionClick }: BackgroundWorkBarProps) {
  const { shells, listLoaded } = useSessionShells(sessionID, directory)
  const statuses = useSessionStatus((state) => state.statuses)
  const knownSessions = useSessionStatus((state) => state.knownSessions)
  const outcomes = useSessionStatus((state) => state.outcomes)
  const killShell = useKillShell(directory)
  const backgroundSession = useBackgroundSession()
  const [expanded, setExpanded] = useState(false)
  const [viewing, setViewing] = useState<ShellRecord | null>(null)

  const tasks = useMemo(
    () => [
      ...shellBackgroundTasks(shells, messages, listLoaded),
      ...subagentBackgroundTasks(messages, statuses, knownSessions, outcomes),
    ],
    [shells, messages, listLoaded, statuses, knownSessions, outcomes],
  )

  const hasRunningTask = tasks.some((task) => isRunningLifecycle(task.status))
  const canBackground = isSessionActive && hasBackgroundableWork(messages)
  const liveViewingShell = viewing ? shells.find((shell) => shell.id === viewing.id) : undefined
  const viewingShell = liveViewingShell ?? viewing
  const viewingRunning = liveViewingShell !== undefined && isRunningLifecycle(shellLifecycle(liveViewingShell))

  if (!canBackground && tasks.length === 0 && viewing === null) return null

  return (
    <div className="mb-1 flex flex-col gap-1 px-1 text-xs">
      {tasks.map((task) =>
        task.kind === 'subagent' && task.childSessionID ? (
          <BackgroundTaskReconciler key={`reconcile:${task.id}`} sessionID={task.childSessionID} />
        ) : null,
      )}
      <div className="flex flex-wrap items-center gap-2">
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
        {tasks.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="ml-auto flex items-center gap-1 rounded-md border border-border bg-card/60 px-2 py-1 text-muted-foreground hover:text-foreground"
            aria-expanded={expanded}
          >
            {hasRunningTask
              ? <Loader2 className="h-3 w-3 animate-spin text-warning" />
              : <Check className="h-3 w-3 text-success" />}
            {tasks.length} background task{tasks.length === 1 ? '' : 's'}
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>

      {expanded && tasks.length > 0 && (
        <ul className="rounded-md border border-border bg-card/60">
          {tasks.map((task) => (
            <BackgroundTaskRow
              key={`${task.kind}:${task.id}`}
              task={task}
              killShell={killShell}
              onChildSessionClick={onChildSessionClick}
              onView={setViewing}
            />
          ))}
        </ul>
      )}

      <Dialog open={viewing !== null} onOpenChange={(open) => { if (!open) setViewing(null) }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate font-mono text-sm">{viewingShell?.command ?? viewing?.command}</DialogTitle>
            <DialogDescription>
              {viewingRunning ? 'Running in the background' : liveViewingShell === undefined ? 'Status unavailable' : 'Finished'}
            </DialogDescription>
          </DialogHeader>
          {viewingShell && <ShellOutputView key={viewingShell.id} shell={viewingShell} directory={directory} running={viewingRunning} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
