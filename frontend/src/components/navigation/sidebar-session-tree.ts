import type { Repo, Session } from '@/api/types'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { getRepoBranchLabel, getRepoDisplayName } from '@/lib/utils'
import { getSessionKey } from '@/lib/sessionKey'
import { getSessionPath, isAssistantPath, parseRepoRoute, parseServerSessionRoute } from '@/lib/navigation'
import { partitionSessions, selectRootSessions } from '@/components/session/session-partition'
import type { ActiveWorktree } from '@/lib/activeWork'

export const SIDEBAR_SESSIONS_PER_REPO = 10

/** Collects the loaded session from each query result, dropping unresolved queries. */
export const combineQuerySessions = (results: Array<{ data?: Session }>): Session[] =>
  results.flatMap((result) => (result.data ? [result.data] : []))

/** Appends extra sessions after the base list, deduplicating by id within both lists. */
export function mergeExtraSessions(sessions: Session[], extraSessions: Session[]): Session[] {
  if (extraSessions.length === 0) return sessions
  const seen = new Set(sessions.map((session) => session.id))
  const extras: Session[] = []
  for (const session of extraSessions) {
    if (seen.has(session.id)) continue
    seen.add(session.id)
    extras.push(session)
  }
  return extras.length === 0 ? sessions : [...sessions, ...extras]
}

export interface SidebarSessionItem {
  key: string
  session: Session
  repoId: number
  /** The linked server owning the session; absent for local repo sessions. */
  serverId?: string
  repoLabel: string
  branchLabel: string | null
  /** Branch of the worktree the session runs in, when it runs in a worktree of the group's repo. */
  worktreeBranch?: string | null
  isWorktree: boolean
  isPinned: boolean
  path: string
}

export interface SidebarRepoGroup {
  repo: Repo
  label: string
  branchLabel: string | null
  items: SidebarSessionItem[]
}

export function isCurrentSessionItem(item: SidebarSessionItem, pathname: string): boolean {
  if (item.serverId) {
    const selection = parseServerSessionRoute(pathname)
    return selection?.serverId === item.serverId && item.session.id === selection.sessionId
  }
  const selection = parseRepoRoute(pathname)
  return item.repoId === selection.repoId && item.session.id === selection.sessionId
}

export function getActiveRepoId(pathname: string): number | null {
  if (isAssistantPath(pathname)) return ASSISTANT_REPO_ID
  return parseRepoRoute(pathname).repoId
}

export function isRepoReady(repo: Repo): boolean {
  return repo.cloneStatus === 'ready'
}

export function selectNavigableRepos(repos: Repo[]): Repo[] {
  const isAssistant = (repo: Repo) => Number(repo.id === ASSISTANT_REPO_ID)
  return [...repos].sort(
    (a, b) => isAssistant(b) - isAssistant(a) || (b.lastAccessedAt ?? 0) - (a.lastAccessedAt ?? 0),
  )
}

export function buildRepoByDirectory(repos: Repo[]): Map<string, Repo> {
  return new Map(repos.map((repo) => [repo.fullPath, repo]))
}

export function normalizeDirectory(directory?: string | null): string | null {
  return directory?.replace(/\/+$/, '') ?? null
}

export function repoMatchesDirectory(repo: Repo, directory?: string | null): boolean {
  const normalizedDirectory = normalizeDirectory(directory)
  if (!normalizedDirectory) return false

  return [repo.fullPath, repo.localPath, repo.sourcePath]
    .some((path) => normalizeDirectory(path) === normalizedDirectory)
}

export function findRepoForDirectory(repos: Repo[], directory?: string | null): Repo | undefined {
  return repos.find((repo) => repoMatchesDirectory(repo, directory))
}

export function buildSidebarRepoGroups(input: {
  repos: Repo[]
  sessions: Session[]
  pinnedKeys: ReadonlySet<string>
  now: number
  worktrees?: ReadonlyArray<ActiveWorktree>
}): SidebarRepoGroup[] {
  const { repos, sessions, pinnedKeys, now, worktrees } = input
  const keyFn = getSessionKey
  const repoByDirectory = buildRepoByDirectory(repos)

  const worktreeByDirectory = new Map<string, ActiveWorktree>()
  for (const worktree of worktrees ?? []) {
    worktreeByDirectory.set(worktree.directory, worktree)
  }

  const directories = new Set(repos.map((repo) => repo.fullPath))
  for (const worktree of worktrees ?? []) {
    directories.add(worktree.directory)
  }
  for (const session of sessions) {
    const directory = normalizeDirectory(session.location.directory)
    if (directory && worktreeByDirectory.has(directory)) {
      directories.add(session.location.directory)
    }
  }

  const roots = selectRootSessions(sessions, { directories, keyFn }).flatMap((session) => {
    if (session.time.archived) return []
    const directory = normalizeDirectory(session.location.directory)
    const worktree = directory ? worktreeByDirectory.get(directory) : undefined
    if (worktree) return [{ session, repo: worktree.ownerRepo }]
    const repo = repoByDirectory.get(session.location.directory)
    if (!repo) return []
    return [{ session, repo }]
  })

  const sessionsByDirectory = new Map<string, Session[]>()
  for (const { session, repo } of roots) {
    const list = sessionsByDirectory.get(repo.fullPath)
    if (list) {
      list.push(session)
    } else {
      sessionsByDirectory.set(repo.fullPath, [session])
    }
  }

  const createItem = (session: Session, repo: Repo): SidebarSessionItem => {
    const key = keyFn(session)
    const directory = normalizeDirectory(session.location.directory)
    const worktree = directory ? worktreeByDirectory.get(directory) : undefined
    return {
      key,
      session,
      repoId: repo.id,
      repoLabel: getRepoDisplayName(repo),
      branchLabel: getRepoBranchLabel(repo),
      worktreeBranch: worktree ? worktree.branch : null,
      isWorktree: Boolean(repo.isWorktree),
      isPinned: pinnedKeys.has(key),
      path: worktree
        ? getSessionPath(repo.id, session.id, { repoTab: 'workspaces' })
        : getSessionPath(repo.id, session.id),
    }
  }

  return repos.map((repo) => {
    const repoRoots = sessionsByDirectory.get(repo.fullPath) ?? []
    const { pinned, today, older } = partitionSessions(repoRoots, pinnedKeys, keyFn, now)
    return {
      repo,
      label: getRepoDisplayName(repo),
      branchLabel: getRepoBranchLabel(repo),
      items: [...pinned, ...today, ...older].map((session) => createItem(session, repo)),
    }
  })
}
