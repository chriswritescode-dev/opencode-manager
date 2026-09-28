import { unwrapSandboxExecCommand } from '@opencode-manager/shared/utils'
import type { SessionMessageAssistantTool, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import type { ShellInfo } from '@/api/opencode'
import type { SessionStatusType } from '@/stores/sessionStatusStore'

export const BACKGROUNDABLE_TOOLS = new Set(['shell', 'subagent'])

export type ChildOutcome = 'succeeded' | 'failed' | 'interrupted'
export type ShellLifecycleStatus = ShellInfo['status'] | 'unavailable'
export type ShellRecord = Omit<ShellInfo, 'status'> & { status: ShellLifecycleStatus }
export type BackgroundTaskKind = 'shell' | 'subagent'
export type BackgroundTaskStatus =
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
  return metadataString(part, 'sessionID')
}

export function isTerminalShell(shell: { status: ShellLifecycleStatus }): boolean {
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
): BackgroundTaskLifecycle {
  if (!shellID) return 'completed'
  if (shell) return shellLifecycle(shell)
  return listLoaded ? 'unavailable' : 'unknown'
}

export function isRunningLifecycle(status: BackgroundTaskLifecycle): boolean {
  return status === 'running' || status === 'unknown'
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
    return record ? applyShellExitRecord(shell, record) : shell
  })

  for (const shell of existing) {
    if (fetchedByID.has(shell.id)) continue
    if (shell.time.started > fetchStartedAt) {
      merged.push(shell)
      continue
    }
    if (isTerminalShell(shell)) {
      merged.push(shell)
      continue
    }
    const record = shellExitRecord(directory, shell.id)
    merged.push(record ? applyShellExitRecord(shell, record) : markShellUnavailable(shell))
  }

  return merged.sort((left, right) => left.time.started - right.time.started)
}

export function upsertShell(current: ShellRecord[], info: ShellInfo, directory: string): ShellRecord[] {
  const cached = current.find((shell) => shell.id === info.id)
  if (cached && isTerminalShell(cached) && !isTerminalShell(info)) return current
  const record = shellExitRecord(directory, info.id)
  const next = record && !isTerminalShell(info) ? applyShellExitRecord(info, record) : info
  return [...current.filter((shell) => shell.id !== info.id), next]
}

export function applyShellExit(
  current: ShellRecord[],
  exit: { id: string; status: ShellInfo['status']; exit?: number },
): ShellRecord[] {
  return current.map((shell) => {
    if (shell.id !== exit.id || shell.status === 'unavailable') return shell
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

function shellLabel(part: SessionMessageAssistantTool): string {
  if (part.state.status === 'streaming') return 'Shell command'
  const command = part.state.input.command
  if (typeof command !== 'string' || !command) return 'Shell command'
  return unwrapSandboxExecCommand(command)
}

export function shellBackgroundTasks(
  shells: ShellRecord[],
  messages: SessionMessageInfo[],
  listLoaded: boolean,
): BackgroundTask[] {
  const tasks = new Map<string, BackgroundTask>()
  for (const shell of shells) {
    tasks.set(shell.id, {
      id: shell.id,
      kind: 'shell',
      label: shell.command,
      status: shellLifecycle(shell),
      shell,
    })
  }

  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const part of message.content) {
      if (part.type !== 'tool' || part.name !== 'shell') continue
      const shellID = backgroundShellID(part)
      if (!shellID || tasks.has(shellID)) continue
      tasks.set(shellID, {
        id: shellID,
        kind: 'shell',
        label: shellLabel(part),
        status: listLoaded ? 'unavailable' : 'unknown',
      })
    }
  }

  return [...tasks.values()]
}

function subagentLabel(part: SessionMessageAssistantTool): string {
  if (part.state.status !== 'streaming') {
    const description = part.state.input.description
    if (typeof description === 'string' && description) return description
  }
  return 'Sub-agent task'
}

export function subagentBackgroundTasks(
  messages: SessionMessageInfo[],
  statuses: Map<string, SessionStatusType>,
  knownSessions: Set<string>,
  outcomes: Map<string, ChildOutcome>,
): BackgroundTask[] {
  const tasks = new Map<string, BackgroundTask>()
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const part of message.content) {
      if (part.type !== 'tool' || part.name !== 'subagent') continue
      const childSessionID = backgroundChildSessionID(part)
      if (!childSessionID) continue
      tasks.set(childSessionID, {
        id: childSessionID,
        kind: 'subagent',
        label: subagentLabel(part),
        status: subagentLifecycle(
          part.state.status,
          true,
          childLifecycle(
            statuses.get(childSessionID) ?? { type: 'idle' },
            knownSessions.has(childSessionID),
            outcomes.get(childSessionID),
          ),
        ),
        childSessionID,
      })
    }
  }
  return [...tasks.values()]
}
