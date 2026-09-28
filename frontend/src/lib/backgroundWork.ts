import { unwrapSandboxExecCommand } from '@opencode-manager/shared/utils'
import type { SessionMessageAssistantTool, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import type { ShellInfo } from '@/api/opencode'
import type { SessionStatusType } from '@/stores/sessionStatusStore'

export const BACKGROUNDABLE_TOOLS = new Set(['shell', 'subagent'])

export type ChildOutcome = 'succeeded' | 'failed' | 'interrupted'
export type ShellNoticeOutcome = 'completed' | 'failed'
type ShellLifecycleStatus = ShellInfo['status'] | 'unavailable'
export type ShellRecord = Omit<ShellInfo, 'status'> & { status: ShellLifecycleStatus }
type BackgroundTaskKind = 'shell' | 'subagent'
type BackgroundTaskStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'interrupted'
  | 'unavailable'
export type BackgroundTaskLifecycle = BackgroundTaskStatus | 'unknown'

export interface BackgroundTask {
  id: string
  kind: BackgroundTaskKind
  label: string
  status: BackgroundTaskLifecycle
  shell?: ShellRecord
  childSessionID?: string
}

interface ShellExitRecord {
  status: ShellLifecycleStatus
  exit?: number
  completedAt: number
}

const shellExitRecords = new Map<string, ShellExitRecord>()

const shellExitKey = (directory: string, id: string): string => `${directory}\u0000${id}`

export function recordShellExit(
  directory: string,
  exit: { id: string; status: ShellInfo['status']; exit?: number },
): void {
  if (exit.status === 'running') return
  shellExitRecords.set(shellExitKey(directory, exit.id), {
    status: exit.status,
    exit: exit.exit,
    completedAt: Date.now(),
  })
}

export function recordShellDeleted(directory: string, id: string): void {
  shellExitRecords.set(shellExitKey(directory, id), {
    status: 'unavailable',
    completedAt: Date.now(),
  })
}

export function clearShellExitRecord(directory: string, id: string): void {
  shellExitRecords.delete(shellExitKey(directory, id))
}

function shellExitRecord(directory: string, id: string): ShellExitRecord | undefined {
  return shellExitRecords.get(shellExitKey(directory, id))
}

export function toolMetadata(part: SessionMessageAssistantTool): Record<string, unknown> {
  if (part.state.status === 'streaming') return {}
  return part.state.metadata ?? {}
}

function metadataString(part: SessionMessageAssistantTool, key: string): string | undefined {
  const value = toolMetadata(part)[key]
  return typeof value === 'string' ? value : undefined
}

export function subagentSessionID(part: SessionMessageAssistantTool): string | undefined {
  return metadataString(part, 'sessionID')
}

function isBackgroundPart(part: SessionMessageAssistantTool): boolean {
  if (part.state.status !== 'completed') return false
  const metadata = toolMetadata(part)
  return metadata.background === true || metadata.status === 'running'
}

export function backgroundShellID(part: SessionMessageAssistantTool): string | undefined {
  if (part.name !== 'shell' || !isBackgroundPart(part)) return undefined
  return metadataString(part, 'shellID')
}

export function backgroundChildSessionID(part: SessionMessageAssistantTool): string | undefined {
  if (part.name !== 'subagent' || !isBackgroundPart(part)) return undefined
  return subagentSessionID(part)
}

function isTerminalShell(shell: { status: ShellLifecycleStatus }): boolean {
  return shell.status !== 'running'
}

export function shellLifecycle(shell: ShellRecord | undefined): BackgroundTaskLifecycle {
  if (!shell) return 'unknown'
  if (shell.status === 'running') return 'running'
  if (shell.status === 'killed') return 'killed'
  if (shell.status === 'timeout') return 'failed'
  if (shell.status === 'unavailable') return 'unavailable'
  return shell.exit !== undefined && shell.exit !== 0 ? 'failed' : 'completed'
}

export function childLifecycle(
  status: SessionStatusType,
  known: boolean,
  outcome: ChildOutcome | undefined,
): BackgroundTaskLifecycle {
  if (!known) return 'unknown'
  if (status.type !== 'idle') return 'running'
  if (outcome === 'failed') return 'failed'
  if (outcome === 'interrupted') return 'interrupted'
  return 'completed'
}

export function subagentLifecycle(
  toolStatus: SessionMessageAssistantTool['state']['status'],
  background: boolean,
  childLifecycle: BackgroundTaskLifecycle,
): BackgroundTaskLifecycle {
  if (toolStatus === 'error') return 'failed'
  if (background) return childLifecycle
  if (toolStatus === 'completed') return 'completed'
  if (childLifecycle !== 'unknown' && childLifecycle !== 'running') return childLifecycle
  return 'running'
}

export function shellToolLifecycle(
  shellID: string | undefined,
  shell: ShellRecord | undefined,
  listLoaded: boolean,
  notice?: ShellNoticeOutcome,
): BackgroundTaskLifecycle {
  if (!shellID) return 'completed'
  if (shell) return shellLifecycle(shell)
  if (notice) return notice
  return listLoaded ? 'unavailable' : 'unknown'
}

export function isRunningLifecycle(status: BackgroundTaskLifecycle): boolean {
  return status === 'running' || status === 'unknown'
}

export function backgroundTaskStatusColor(status: BackgroundTaskLifecycle): string {
  if (status === 'completed') return 'text-success'
  if (status === 'failed') return 'text-destructive'
  if (status === 'unavailable') return 'text-muted-foreground'
  return 'text-warning'
}

export function lifecycleLabel(status: BackgroundTaskLifecycle): string {
  return status === 'unknown' ? 'running' : status
}

function applyShellExitRecord(shell: ShellRecord, record: ShellExitRecord): ShellRecord {
  return {
    ...shell,
    status: record.status,
    exit: record.exit ?? shell.exit,
    time: { ...shell.time, completed: shell.time.completed ?? record.completedAt },
  }
}

function markShellUnavailable(shell: ShellRecord): ShellRecord {
  return {
    ...shell,
    status: 'unavailable',
    time: { ...shell.time, completed: shell.time.completed ?? Date.now() },
  }
}

function clearConfirmedShellExitRecord(
  directory: string,
  id: string,
  record: ShellExitRecord | undefined,
  fetchStartedAt: number,
): void {
  if (!record || record.completedAt > fetchStartedAt) return
  clearShellExitRecord(directory, id)
}

export function reconcileShellList(
  existing: ShellRecord[],
  fetched: ShellInfo[],
  fetchStartedAt: number,
  directory: string,
): ShellRecord[] {
  const existingByID = new Map(existing.map((shell) => [shell.id, shell]))
  const fetchedByID = new Set(fetched.map((shell) => shell.id))
  const merged: ShellRecord[] = fetched.map((shell) => {
    const cached = existingByID.get(shell.id)
    if (cached && isTerminalShell(cached) && !isTerminalShell(shell)) return cached
    const record = shellExitRecord(directory, shell.id)
    if (isTerminalShell(shell)) {
      clearConfirmedShellExitRecord(directory, shell.id, record, fetchStartedAt)
      return shell
    }
    return record ? applyShellExitRecord(shell, record) : shell
  })

  for (const shell of existing) {
    if (fetchedByID.has(shell.id)) continue
    if (shell.time.started > fetchStartedAt) {
      merged.push(shell)
      continue
    }
    const record = shellExitRecord(directory, shell.id)
    if (isTerminalShell(shell)) {
      clearConfirmedShellExitRecord(directory, shell.id, record, fetchStartedAt)
      merged.push(shell)
      continue
    }
    if (record) {
      merged.push(applyShellExitRecord(shell, record))
      clearConfirmedShellExitRecord(directory, shell.id, record, fetchStartedAt)
      continue
    }
    merged.push(markShellUnavailable(shell))
  }

  return merged.sort((left, right) => left.time.started - right.time.started)
}

export function upsertShell(current: ShellRecord[], info: ShellInfo, directory: string): ShellRecord[] {
  const cached = current.find((shell) => shell.id === info.id)
  if (cached && isTerminalShell(cached) && cached.status !== info.status) return current
  const record = shellExitRecord(directory, info.id)
  const next = record && !isTerminalShell(info) ? applyShellExitRecord(info, record) : info
  return [...current.filter((shell) => shell.id !== info.id), next]
}

export function applyShellExit(
  current: ShellRecord[],
  exit: { id: string; status: ShellInfo['status']; exit?: number },
): ShellRecord[] {
  return current.map((shell) => {
    if (shell.id !== exit.id) return shell
    if (isTerminalShell(shell) && shell.status !== exit.status) return shell
    const terminal = exit.status !== 'running'
    return {
      ...shell,
      status: exit.status,
      exit: exit.exit ?? shell.exit,
      time: terminal ? { ...shell.time, completed: shell.time.completed ?? Date.now() } : shell.time,
    }
  })
}

export function markShellDeleted(current: ShellRecord[], id: string): ShellRecord[] {
  return current.map((shell) => {
    if (shell.id !== id || isTerminalShell(shell)) return shell
    return markShellUnavailable(shell)
  })
}

interface BackgroundShellPart {
  id: string
  label: string
}

interface BackgroundSubagentPart {
  childSessionID: string
  label: string
  toolStatus: SessionMessageAssistantTool['state']['status']
}

interface CollectedBackgroundParts {
  shells: BackgroundShellPart[]
  subagents: BackgroundSubagentPart[]
  shellNotices: Map<string, ShellNoticeOutcome>
}

function shellNoticeFromMessage(message: SessionMessageInfo): { shellID: string; outcome: ShellNoticeOutcome } | undefined {
  if (message.type !== 'synthetic' && message.type !== 'system') return undefined
  const metadata = message.metadata
  if (!metadata || metadata.source !== 'shell') return undefined
  const shellID = metadata.shellID
  if (typeof shellID !== 'string' || !shellID) return undefined
  const exit = metadata.exit
  const completed = metadata.state === 'completed' && (exit === undefined || exit === 0)
  return { shellID, outcome: completed ? 'completed' : 'failed' }
}

function shellLabel(part: SessionMessageAssistantTool): string {
  if (part.state.status === 'streaming') return 'Shell command'
  const command = part.state.input.command
  if (typeof command !== 'string' || !command) return 'Shell command'
  return unwrapSandboxExecCommand(command)
}

function subagentLabel(part: SessionMessageAssistantTool): string {
  if (part.state.status !== 'streaming') {
    const description = part.state.input.description
    if (typeof description === 'string' && description) return description
  }
  return 'Sub-agent task'
}

export function collectBackgroundParts(messages: SessionMessageInfo[]): CollectedBackgroundParts {
  const shells = new Map<string, BackgroundShellPart>()
  const subagents = new Map<string, BackgroundSubagentPart>()
  const shellNotices = new Map<string, ShellNoticeOutcome>()
  for (const message of messages) {
    const notice = shellNoticeFromMessage(message)
    if (notice) {
      if (!shellNotices.has(notice.shellID)) shellNotices.set(notice.shellID, notice.outcome)
      continue
    }
    if (message.type !== 'assistant') continue
    for (const part of message.content) {
      if (part.type !== 'tool') continue
      if (part.name === 'shell') {
        const shellID = backgroundShellID(part)
        if (!shellID || shells.has(shellID)) continue
        shells.set(shellID, { id: shellID, label: shellLabel(part) })
        continue
      }
      if (part.name === 'subagent') {
        const childSessionID = backgroundChildSessionID(part)
        if (!childSessionID) continue
        subagents.set(childSessionID, {
          childSessionID,
          label: subagentLabel(part),
          toolStatus: part.state.status,
        })
      }
    }
  }
  return { shells: [...shells.values()], subagents: [...subagents.values()], shellNotices }
}

export function shellBackgroundTasks(
  shells: ShellRecord[],
  shellParts: BackgroundShellPart[],
  notices: ReadonlyMap<string, ShellNoticeOutcome>,
  listLoaded: boolean,
): BackgroundTask[] {
  const tasks = new Map<string, BackgroundTask>()
  for (const shell of shells) {
    tasks.set(shell.id, {
      id: shell.id,
      kind: 'shell',
      label: shell.command,
      status: shellToolLifecycle(shell.id, shell, listLoaded, notices.get(shell.id)),
      shell,
    })
  }

  for (const part of shellParts) {
    if (tasks.has(part.id)) continue
    tasks.set(part.id, {
      id: part.id,
      kind: 'shell',
      label: part.label,
      status: shellToolLifecycle(part.id, undefined, listLoaded, notices.get(part.id)),
    })
  }

  return [...tasks.values()]
}

export function subagentBackgroundTasks(
  parts: BackgroundSubagentPart[],
  lifecycles: Record<string, BackgroundTaskLifecycle>,
): BackgroundTask[] {
  return parts.map((part) => ({
    id: part.childSessionID,
    kind: 'subagent',
    label: part.label,
    status: subagentLifecycle(part.toolStatus, true, lifecycles[part.childSessionID] ?? 'unknown'),
    childSessionID: part.childSessionID,
  }))
}
