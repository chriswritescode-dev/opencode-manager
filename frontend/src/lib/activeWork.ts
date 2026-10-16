import type { Repo, Session } from '@/api/types'
import type { ChildOutcome } from '@/lib/backgroundWork'
import type { SessionStatusType } from '@/stores/sessionStatusStore'
import { getSessionKey } from '@/lib/sessionKey'
import { getSessionPath } from '@/lib/navigation'
import { findRepoForDirectory, normalizeDirectory } from '@/components/navigation/sidebar-session-tree'
import { isWorktreeSibling, type RepoSibling } from '@opencode-manager/shared/utils'

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
  /** The worktree's branch when the session runs in a worktree of `repo`; null otherwise. */
  worktreeBranch?: string | null
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

/**
 * The repo's activity from a prebuilt index, checking each of its own paths and the directories of
 * the worktrees it owns. Needs-input outranks running.
 */
export function repoActivityFromIndex(
  repo: Repo,
  index: ReadonlyMap<string, 'needs-input' | 'running'>,
  worktrees?: ReadonlyArray<ActiveWorktree>,
): 'needs-input' | 'running' | null {
  let running = false

  const check = (directory?: string | null): boolean => {
    const normalized = normalizeDirectory(directory)
    if (!normalized) return false
    const state = index.get(normalized)
    if (state === 'needs-input') return true
    if (state === 'running') running = true
    return false
  }

  for (const path of [repo.fullPath, repo.localPath, repo.sourcePath]) {
    if (check(path)) return 'needs-input'
  }

  for (const worktree of worktrees ?? []) {
    if (worktree.ownerRepo.id !== repo.id) continue
    if (check(worktree.directory)) return 'needs-input'
  }

  return running ? 'running' : null
}

/**
 * True when some indexed active directory matches no repo, so a session is active in a directory
 * outside the repo list (such as a worktree) and the worktree lookup is worth running.
 */
export function hasUnmatchedActiveDirectory(
  index: ReadonlyMap<string, 'needs-input' | 'running'>,
  repos: Repo[],
): boolean {
  for (const directory of index.keys()) {
    if (!findRepoForDirectory(repos, directory)) return true
  }
  return false
}

/** A worktree directory and the repo that owns it, discovered from that repo's siblings. */
export interface ActiveWorktree {
  directory: string
  ownerRepo: Repo
  branch: string | null
  /** True when the worktree belongs to a schedule rather than an interactive session. */
  isSchedule: boolean
}

/**
 * Collects the worktrees discovered through each repo's siblings, keyed by directory so a session
 * running in a worktree resolves to its owning repo. A repo's siblings include the worktrees of its
 * whole OpenCode project, so the same worktree can come back from several repos: the non-worktree
 * repo wins so a worktree session opens on the main repo, and duplicates are dropped.
 */
export function buildWorktreeActivity(
  repos: Repo[],
  siblingResults: ReadonlyArray<{ data?: RepoSibling[] }>,
): ActiveWorktree[] {
  const ordered = repos
    .map((repo, index) => ({ repo, siblings: siblingResults[index]?.data }))
    .sort((a, b) => Number(Boolean(a.repo.isWorktree)) - Number(Boolean(b.repo.isWorktree)))

  const worktrees: ActiveWorktree[] = []
  const seen = new Set<string>()

  for (const { repo, siblings } of ordered) {
    for (const sibling of siblings ?? []) {
      if (!isWorktreeSibling(sibling)) continue
      const directory = normalizeDirectory(sibling.fullPath)
      if (!directory || seen.has(directory)) continue
      seen.add(directory)
      worktrees.push({
        directory,
        ownerRepo: repo,
        branch: sibling.currentBranch ?? sibling.branch ?? null,
        isSchedule: sibling.worktreeSource === 'schedule',
      })
    }
  }

  return worktrees
}

/**
 * Whether the worktree lookup is worth running: true when some non-archived session that matches no
 * repo is either updated inside the window or has its root active (needs-input or running).
 */
export function needsWorktreeLookup(input: {
  now: number
  windowMs: number
  repos: Repo[]
  sessions: Session[]
  parents: ReadonlyMap<string, string | null>
  roots: { needsInput: Set<string>; running: Set<string> }
}): boolean {
  const { now, windowMs, repos, sessions, parents, roots } = input
  const windowStart = now - windowMs

  return sessions.some((session) => {
    if (session.time.archived) return false
    if (findRepoForDirectory(repos, session.location.directory)) return false
    if (session.time.updated >= windowStart) return true
    const rootID = rootSessionID(session.id, parents)
    return roots.needsInput.has(rootID) || roots.running.has(rootID)
  })
}

/**
 * Groups the given sessions into needs-input, running, and recent roots. A session appears in
 * exactly one group (needs-input over running over recent) and only when it resolves to a repo.
 * A recent session in a schedule worktree is omitted so schedules only surface while they need
 * attention. The input may mix roots and children; children never become items, but their latest
 * update time rolls up into the root's `updatedAt` and decides the recent window and ordering.
 */
export function buildActiveWork(input: {
  now: number
  windowMs: number
  repos: Repo[]
  sessions: Session[]
  parents: ReadonlyMap<string, string | null>
  roots: { needsInput: Set<string>; running: Set<string> }
  outcomes: ReadonlyMap<string, ChildOutcome>
  worktrees?: ReadonlyArray<ActiveWorktree>
}): ActiveWorkGroups {
  const { now, windowMs, repos, sessions, parents, roots, outcomes, worktrees } = input
  const windowStart = now - windowMs

  const worktreeByDirectory = new Map<string, ActiveWorktree>()
  for (const worktree of worktrees ?? []) {
    worktreeByDirectory.set(worktree.directory, worktree)
  }

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

    const directory = normalizeDirectory(session.location.directory)
    const worktree = directory ? worktreeByDirectory.get(directory) : undefined
    const repo = worktree?.ownerRepo ?? findRepoForDirectory(repos, session.location.directory)
    if (!repo) continue
    if (worktree?.isSchedule && state === 'recent') continue

    seen.add(session.id)
    const item: ActiveWorkItem = {
      key: getSessionKey(session),
      session,
      repo,
      state,
      updatedAt,
      outcome: outcomes.get(session.id),
      worktreeBranch: worktree ? worktree.branch : null,
      path: getSessionPath(repo.id, session.id, worktree ? { repoTab: 'workspaces' } : undefined),
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
