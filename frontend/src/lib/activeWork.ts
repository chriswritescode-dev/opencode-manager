import type { Repo, Session } from '@/api/types'
import { LOCAL_OPENCODE_SERVER_ID, parseServerDirectoryKey } from '@opencode-manager/shared/schemas'
import type { ChildOutcome } from '@/lib/backgroundWork'
import type { SessionStatusType } from '@/stores/sessionStatusStore'
import { getSessionKey } from '@/lib/sessionKey'
import { getServerSessionPath, getSessionPath } from '@/lib/navigation'
import { getRepoBranchLabel } from '@/lib/utils'
import { findRepoForDirectory, normalizeDirectory } from '@/components/navigation/sidebar-session-tree'
import { isWorktreeSibling, type RepoSibling } from '@opencode-manager/shared/utils'

function localDirectoryOf(directory?: string | null): string | null {
  if (!directory) return null
  const { serverId, directory: parsed } = parseServerDirectoryKey(directory)
  return serverId === LOCAL_OPENCODE_SERVER_ID ? parsed : null
}

export const MS_PER_MINUTE = 60_000

export function formatActivityWindow(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }

  return `${minutes} minutes`
}

export function formatActivityEmptyMessage(minutes: number): string {
  return `No active or recent sessions in the last ${formatActivityWindow(minutes)}`
}

export type ActiveWorkState = 'needs-input' | 'running' | 'recent'

export interface ActiveWorkItem {
  key: string
  session: Session
  repo: Repo | null
  serverId: string | null
  serverName: string | null
  state: ActiveWorkState
  updatedAt: number
  outcome?: ChildOutcome
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

export interface ActiveRoots {
  needsInput: Set<string>
  running: Set<string>
}

export function collectActiveRoots(input: {
  statuses: ReadonlyMap<string, SessionStatusType>
  parents: ReadonlyMap<string, string | null>
  runningShells: ReadonlyMap<string, { sessionID: string }>
  pendingInputSessionIDs: Iterable<string>
}): ActiveRoots {
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

interface ActivityIndexInput {
  statuses: ReadonlyMap<string, SessionStatusType>
  parents: ReadonlyMap<string, string | null>
  runningShells: ReadonlyMap<string, { sessionID: string; directory: string }>
  directories: ReadonlyMap<string, string>
  pendingInputSessionIDs: Iterable<string>
}

interface ServerActivityIndexInput extends ActivityIndexInput {
  sessionServers: ReadonlyMap<string, string>
}

type ActivityIndex = Map<string, 'needs-input' | 'running'>

function cacheByInput<I, V>(
  compute: (input: I) => V,
  sameInput: (left: I, right: I) => boolean,
): (input: I) => V {
  let cached: { input: I; value: V } | null = null

  return (input) => {
    if (cached && sameInput(cached.input, input)) return cached.value
    const value = compute(input)
    cached = { input, value }
    return value
  }
}

function sameActivityInput<I extends ActivityIndexInput>(left: I, right: I): boolean {
  return (
    left.statuses === right.statuses &&
    left.parents === right.parents &&
    left.runningShells === right.runningShells &&
    left.directories === right.directories &&
    left.pendingInputSessionIDs === right.pendingInputSessionIDs
  )
}

function sameServerActivityInput(
  left: ServerActivityIndexInput,
  right: ServerActivityIndexInput,
): boolean {
  return sameActivityInput(left, right) && left.sessionServers === right.sessionServers
}

function computeActivityIndex(
  input: ActivityIndexInput,
  keyOf: (sessionID: string, directory: string | null | undefined) => string | null,
): ActivityIndex {
  const { statuses, parents, runningShells, directories, pendingInputSessionIDs } = input
  const index: ActivityIndex = new Map()

  const mark = (
    state: 'needs-input' | 'running',
    sessionID: string,
    directory?: string | null,
  ): void => {
    const key = keyOf(sessionID, directory)
    if (!key) return
    if (state === 'running' && index.get(key) === 'needs-input') return
    index.set(key, state)
  }

  const markSession = (state: 'needs-input' | 'running', sessionID: string): void => {
    mark(state, sessionID, directories.get(sessionID))
    mark(state, sessionID, directories.get(rootSessionID(sessionID, parents)))
  }

  for (const sessionID of pendingInputSessionIDs) {
    markSession('needs-input', sessionID)
  }

  for (const [sessionID, status] of statuses) {
    if (status.type === 'idle') continue
    markSession('running', sessionID)
  }

  for (const shell of runningShells.values()) {
    mark('running', shell.sessionID, shell.directory)
    markSession('running', shell.sessionID)
  }

  return index
}

function localActivityKey(_sessionID: string, directory?: string | null): string | null {
  return normalizeDirectory(localDirectoryOf(directory))
}

const repoActivityIndex = cacheByInput<ActivityIndexInput, ActivityIndex>(
  (input) => computeActivityIndex(input, localActivityKey),
  sameActivityInput,
)

export function buildRepoActivityIndex(input: ActivityIndexInput): ActivityIndex {
  return repoActivityIndex(input)
}

export interface SessionDirectoryScope {
  serverId: string
  directory: string | null
}

export function sessionScopeOfDirectory(
  directory: string | null | undefined,
  sessionServerId?: string,
): SessionDirectoryScope {
  const parsed = directory ? parseServerDirectoryKey(directory) : null
  const serverId =
    parsed && parsed.serverId !== LOCAL_OPENCODE_SERVER_ID
      ? parsed.serverId
      : sessionServerId ?? LOCAL_OPENCODE_SERVER_ID
  return { serverId, directory: parsed?.directory ?? null }
}

function serverIndexKey(serverId: string, directory?: string | null): string {
  return `${serverId}|${normalizeDirectory(directory) ?? ''}`
}

const serverActivityIndex = cacheByInput<ServerActivityIndexInput, ActivityIndex>(
  (input) =>
    computeActivityIndex(input, (sessionID, directory) => {
      const scope = sessionScopeOfDirectory(directory, input.sessionServers.get(sessionID))
      if (scope.serverId === LOCAL_OPENCODE_SERVER_ID) return null
      return serverIndexKey(scope.serverId, scope.directory)
    }),
  sameServerActivityInput,
)

export function buildServerActivityIndex(input: ServerActivityIndexInput): ActivityIndex {
  return serverActivityIndex(input)
}

export function serverActivityFromIndex(
  serverId: string,
  index: ReadonlyMap<string, 'needs-input' | 'running'>,
): 'needs-input' | 'running' | null {
  const prefix = `${serverId}|`
  let running = false

  for (const [key, state] of index) {
    if (!key.startsWith(prefix)) continue
    if (state === 'needs-input') return 'needs-input'
    if (state === 'running') running = true
  }

  return running ? 'running' : null
}

export function projectActivityFromIndex(
  serverId: string,
  directory: string,
  index: ReadonlyMap<string, 'needs-input' | 'running'>,
): 'needs-input' | 'running' | null {
  return index.get(serverIndexKey(serverId, directory)) ?? null
}

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

export function hasUnmatchedActiveDirectory(
  index: ReadonlyMap<string, 'needs-input' | 'running'>,
  repos: Repo[],
): boolean {
  for (const directory of index.keys()) {
    if (!findRepoForDirectory(repos, directory)) return true
  }
  return false
}

export interface ActiveWorktree {
  directory: string
  ownerRepo: Repo
  branch: string | null
  isSchedule: boolean
}

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

export function resolveSessionBranch(
  repo: Pick<Repo, 'currentBranch' | 'branch'>,
  directory: string | null | undefined,
  siblings?: ReadonlyArray<RepoSibling>,
): string | null {
  const normalized = normalizeDirectory(directory)
  const sibling = normalized
    ? siblings?.find((entry) => normalizeDirectory(entry.fullPath) === normalized)
    : undefined
  if (!sibling) return getRepoBranchLabel(repo)
  return sibling.currentBranch ?? sibling.branch ?? null
}

export function needsWorktreeLookup(input: {
  now: number
  windowMs: number
  repos: Repo[]
  sessions: Session[]
  parents: ReadonlyMap<string, string | null>
  roots: { needsInput: Set<string>; running: Set<string> }
  sessionServers?: ReadonlyMap<string, string>
}): boolean {
  const { now, windowMs, repos, sessions, parents, roots, sessionServers } = input
  const windowStart = now - windowMs

  return sessions.some((session) => {
    if (session.time.archived) return false
    if (sessionServers?.has(session.id)) return false
    if (findRepoForDirectory(repos, session.location.directory)) return false
    if (session.time.updated >= windowStart) return true
    const rootID = rootSessionID(session.id, parents)
    return roots.needsInput.has(rootID) || roots.running.has(rootID)
  })
}

export function buildActiveWork(input: {
  now: number
  windowMs: number
  repos: Repo[]
  sessions: Session[]
  parents: ReadonlyMap<string, string | null>
  roots: { needsInput: Set<string>; running: Set<string> }
  outcomes: ReadonlyMap<string, ChildOutcome>
  worktrees?: ReadonlyArray<ActiveWorktree>
  sessionServers?: ReadonlyMap<string, string>
  serverNames?: ReadonlyMap<string, string>
}): ActiveWorkGroups {
  const { now, windowMs, repos, sessions, parents, roots, outcomes, worktrees, sessionServers, serverNames } = input
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

    const serverId = sessionServers?.get(session.id) ?? null
    if (serverId) {
      seen.add(session.id)
      const item: ActiveWorkItem = {
        key: getSessionKey(session),
        session,
        repo: null,
        serverId,
        serverName: serverNames?.get(serverId) ?? null,
        state,
        updatedAt,
        outcome: outcomes.get(session.id),
        worktreeBranch: null,
        path: getServerSessionPath(serverId, session.id),
      }
      if (state === 'needs-input') needsInput.push(item)
      else if (state === 'running') running.push(item)
      else recent.push(item)
      continue
    }

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
      serverId: null,
      serverName: null,
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
