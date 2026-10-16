import type { Repo, Session } from '@/api/types'
import type { ChildOutcome } from '@/lib/backgroundWork'
import type { SessionStatusType } from '@/stores/sessionStatusStore'
import { getSessionKey } from '@/lib/sessionKey'
import { getSessionPath } from '@/lib/navigation'
import { findRepoForDirectory, normalizeDirectory } from '@/components/navigation/sidebar-session-tree'

export const MS_PER_MINUTE = 60_000

/**
 * Human-readable label for an activity window in minutes: whole hours when the value divides
 * evenly into hours, otherwise minutes.
 */
export function formatActivityWindow(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }

  return `${minutes} minutes`
}

/** Empty-state copy for the activity list naming the window it searched. */
export function formatActivityEmptyMessage(minutes: number): string {
  return `No active or recent sessions in the last ${formatActivityWindow(minutes)}`
}

export type ActiveWorkState = 'needs-input' | 'running' | 'recent'

export interface ActiveWorkItem {
  key: string
  session: Session
  repo: Repo
  state: ActiveWorkState
  updatedAt: number
  outcome?: ChildOutcome
  path: string
}

export interface ActiveWorkGroups {
  needsInput: ActiveWorkItem[]
  running: ActiveWorkItem[]
  recent: ActiveWorkItem[]
}

export const ACTIVE_WORK_GROUPS = [
  { key: 'needsInput', heading: 'Needs input' },
  { key: 'running', heading: 'Running' },
  { key: 'recent', heading: 'Recent' },
] as const satisfies ReadonlyArray<{ key: keyof ActiveWorkGroups; heading: string }>

export function rootSessionID(
  sessionID: string,
  parents: ReadonlyMap<string, string | null>,
): string {
  const visited = new Set<string>()
  let currentID = sessionID

  while (!visited.has(currentID)) {
    visited.add(currentID)
    const parentID = parents.get(currentID)
    if (parentID === undefined || parentID === null) break
    currentID = parentID
  }

  return currentID
}

/**
 * Rolls every active or pending session id up to its root. `needsInput` and `running` may both
 * contain a root; callers apply the needs-input over running priority when grouping.
 */
export function collectActiveRoots(input: {
  statuses: ReadonlyMap<string, SessionStatusType>
  parents: ReadonlyMap<string, string | null>
  runningShells: ReadonlyMap<string, { sessionID: string }>
  pendingInputSessionIDs: Iterable<string>
}): { needsInput: Set<string>; running: Set<string> } {
  const { statuses, parents, runningShells, pendingInputSessionIDs } = input

  const needsInput = new Set<string>()
  for (const sessionID of pendingInputSessionIDs) {
    needsInput.add(rootSessionID(sessionID, parents))
  }

  const running = new Set<string>()
  for (const [sessionID, status] of statuses) {
    if (status.type === 'idle') continue
    running.add(rootSessionID(sessionID, parents))
  }
  for (const shell of runningShells.values()) {
    running.add(rootSessionID(shell.sessionID, parents))
  }

  return { needsInput, running }
}

interface RepoActivityIndexInput {
  statuses: ReadonlyMap<string, SessionStatusType>
  parents: ReadonlyMap<string, string | null>
  runningShells: ReadonlyMap<string, { sessionID: string; directory: string }>
  directories: ReadonlyMap<string, string>
  pendingInputSessionIDs: Iterable<string>
}

let cachedRepoActivityIndex: (RepoActivityIndexInput & {
  index: Map<string, 'needs-input' | 'running'>
}) | null = null

function computeRepoActivityIndex(input: RepoActivityIndexInput): Map<string, 'needs-input' | 'running'> {
  const { statuses, parents, runningShells, directories, pendingInputSessionIDs } = input
  const index = new Map<string, 'needs-input' | 'running'>()

  const markNeedsInput = (directory?: string | null): void => {
    const normalized = normalizeDirectory(directory)
    if (normalized) index.set(normalized, 'needs-input')
  }

  const markRunning = (directory?: string | null): void => {
    const normalized = normalizeDirectory(directory)
    if (!normalized || index.get(normalized) === 'needs-input') return
    index.set(normalized, 'running')
  }

  for (const sessionID of pendingInputSessionIDs) {
    markNeedsInput(directories.get(sessionID))
    markNeedsInput(directories.get(rootSessionID(sessionID, parents)))
  }

  for (const [sessionID, status] of statuses) {
    if (status.type === 'idle') continue
    markRunning(directories.get(sessionID))
    markRunning(directories.get(rootSessionID(sessionID, parents)))
  }

  for (const shell of runningShells.values()) {
    markRunning(shell.directory)
    markRunning(directories.get(shell.sessionID))
    markRunning(directories.get(rootSessionID(shell.sessionID, parents)))
  }

  return index
}

/**
 * Indexes active sessions by normalized directory for repo badges. Pending input marks its own and
 * its root's directory as needs-input; non-idle sessions and running shells mark running unless
 * needs-input already claimed the directory. Shared across rows per store snapshot by reference.
 */
export function buildRepoActivityIndex(
  input: RepoActivityIndexInput,
): Map<string, 'needs-input' | 'running'> {
  if (
    cachedRepoActivityIndex &&
    cachedRepoActivityIndex.statuses === input.statuses &&
    cachedRepoActivityIndex.parents === input.parents &&
    cachedRepoActivityIndex.runningShells === input.runningShells &&
    cachedRepoActivityIndex.directories === input.directories &&
    cachedRepoActivityIndex.pendingInputSessionIDs === input.pendingInputSessionIDs
  ) {
    return cachedRepoActivityIndex.index
  }

  const index = computeRepoActivityIndex(input)
  cachedRepoActivityIndex = { ...input, index }
  return index
}

/** The repo's activity from a prebuilt index, checking each of its paths. Needs-input outranks running. */
export function repoActivityFromIndex(
  repo: Repo,
  index: ReadonlyMap<string, 'needs-input' | 'running'>,
): 'needs-input' | 'running' | null {
  let running = false

  for (const path of [repo.fullPath, repo.localPath, repo.sourcePath]) {
    const normalized = normalizeDirectory(path)
    if (!normalized) continue
    const state = index.get(normalized)
    if (state === 'needs-input') return 'needs-input'
    if (state === 'running') running = true
  }

  return running ? 'running' : null
}

/**
 * Groups the given sessions into needs-input, running, and recent roots. A session appears in
 * exactly one group (needs-input over running over recent) and only when it resolves to a repo.
 * The input may mix roots and children; children never become items, but their latest update time
 * rolls up into the root's `updatedAt` and decides the recent window and ordering.
 */
export function buildActiveWork(input: {
  now: number
  windowMs: number
  repos: Repo[]
  sessions: Session[]
  parents: ReadonlyMap<string, string | null>
  roots: { needsInput: Set<string>; running: Set<string> }
  outcomes: ReadonlyMap<string, ChildOutcome>
}): ActiveWorkGroups {
  const { now, windowMs, repos, sessions, parents, roots, outcomes } = input
  const windowStart = now - windowMs

  const activityByRoot = new Map<string, number>()
  for (const session of sessions) {
    if (session.time.archived) continue
    const rootID = rootSessionID(session.id, parents)
    const current = activityByRoot.get(rootID)
    if (current === undefined || session.time.updated > current) {
      activityByRoot.set(rootID, session.time.updated)
    }
  }

  const needsInput: ActiveWorkItem[] = []
  const running: ActiveWorkItem[] = []
  const recent: ActiveWorkItem[] = []
  const seen = new Set<string>()

  for (const session of sessions) {
    if (seen.has(session.id)) continue
    if (session.time.archived) continue
    if (rootSessionID(session.id, parents) !== session.id) continue

    const updatedAt = activityByRoot.get(session.id) ?? session.time.updated
    const state: ActiveWorkState | null = roots.needsInput.has(session.id)
      ? 'needs-input'
      : roots.running.has(session.id)
        ? 'running'
        : updatedAt >= windowStart
          ? 'recent'
          : null
    if (!state) continue

    const repo = findRepoForDirectory(repos, session.location.directory)
    if (!repo) continue

    seen.add(session.id)
    const item: ActiveWorkItem = {
      key: getSessionKey(session),
      session,
      repo,
      state,
      updatedAt,
      outcome: outcomes.get(session.id),
      path: getSessionPath(repo.id, session.id),
    }

    if (state === 'needs-input') needsInput.push(item)
    else if (state === 'running') running.push(item)
    else recent.push(item)
  }

  const byUpdatedDesc = (a: ActiveWorkItem, b: ActiveWorkItem) => b.updatedAt - a.updatedAt
  needsInput.sort(byUpdatedDesc)
  running.sort(byUpdatedDesc)
  recent.sort(byUpdatedDesc)

  return { needsInput, running, recent }
}
