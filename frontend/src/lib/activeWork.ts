import type { Repo, Session } from '@/api/types'
import type { ChildOutcome } from '@/lib/backgroundWork'
import type { SessionStatusType } from '@/stores/sessionStatusStore'
import { getSessionKey } from '@/lib/sessionKey'
import { getSessionPath } from '@/lib/navigation'
import { findRepoForDirectory, repoMatchesDirectory } from '@/components/navigation/sidebar-session-tree'

const ACTIVITY_WINDOW_LABELS: Record<number, string> = {
  15: '15 minutes',
  30: '30 minutes',
  60: '1 hour',
  120: '2 hours',
  240: '4 hours',
  480: '8 hours',
  1440: '24 hours',
}

/**
 * Human-readable label for an activity window in minutes. Known options map to their labels;
 * other values fall back to minutes, or to hours when the value divides evenly into hours.
 */
export function formatActivityWindow(minutes: number): string {
  const known = ACTIVITY_WINDOW_LABELS[minutes]
  if (known) return known

  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }

  return `${minutes} minutes`
}

export type ActiveWorkState = 'needs-input' | 'running' | 'recent'

export interface ActiveWorkItem {
  key: string
  session: Session
  repo: Repo
  state: ActiveWorkState
  outcome?: ChildOutcome
  path: string
}

export interface ActiveWorkGroups {
  needsInput: ActiveWorkItem[]
  running: ActiveWorkItem[]
  recent: ActiveWorkItem[]
}

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

/**
 * Whether a repo has any active session. A session counts when its own directory or its root's
 * directory matches the repo; running shells carry their own directory. Needs-input outranks running.
 */
export function activeRepoState(input: {
  repo: Repo
  statuses: ReadonlyMap<string, SessionStatusType>
  parents: ReadonlyMap<string, string | null>
  runningShells: ReadonlyMap<string, { sessionID: string; directory: string }>
  directories: ReadonlyMap<string, string>
  pendingInputSessionIDs: Iterable<string>
}): 'needs-input' | 'running' | null {
  const { repo, statuses, parents, runningShells, directories, pendingInputSessionIDs } = input

  const sessionMatches = (sessionID: string): boolean => {
    if (repoMatchesDirectory(repo, directories.get(sessionID))) return true
    const rootID = rootSessionID(sessionID, parents)
    return rootID !== sessionID && repoMatchesDirectory(repo, directories.get(rootID))
  }

  for (const sessionID of pendingInputSessionIDs) {
    if (sessionMatches(sessionID)) return 'needs-input'
  }

  for (const [sessionID, status] of statuses) {
    if (status.type === 'idle') continue
    if (sessionMatches(sessionID)) return 'running'
  }

  for (const shell of runningShells.values()) {
    if (repoMatchesDirectory(repo, shell.directory) || sessionMatches(shell.sessionID)) return 'running'
  }

  return null
}

/**
 * Groups the given sessions into needs-input, running, and recent roots. A session appears in
 * exactly one group (needs-input over running over recent) and only when it resolves to a repo.
 */
export function buildActiveWork(input: {
  now: number
  windowMs: number
  repos: Repo[]
  sessions: Session[]
  roots: { needsInput: Set<string>; running: Set<string> }
  outcomes: ReadonlyMap<string, ChildOutcome>
}): ActiveWorkGroups {
  const { now, windowMs, repos, sessions, roots, outcomes } = input
  const windowStart = now - windowMs

  const needsInput: ActiveWorkItem[] = []
  const running: ActiveWorkItem[] = []
  const recent: ActiveWorkItem[] = []
  const seen = new Set<string>()

  for (const session of sessions) {
    if (seen.has(session.id)) continue
    if (session.time.archived) continue

    const state: ActiveWorkState | null = roots.needsInput.has(session.id)
      ? 'needs-input'
      : roots.running.has(session.id)
        ? 'running'
        : session.time.updated >= windowStart
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
      outcome: outcomes.get(session.id),
      path: getSessionPath(repo.id, session.id),
    }

    if (state === 'needs-input') needsInput.push(item)
    else if (state === 'running') running.push(item)
    else recent.push(item)
  }

  const byUpdatedDesc = (a: ActiveWorkItem, b: ActiveWorkItem) =>
    b.session.time.updated - a.session.time.updated
  needsInput.sort(byUpdatedDesc)
  running.sort(byUpdatedDesc)
  recent.sort(byUpdatedDesc)

  return { needsInput, running, recent }
}
