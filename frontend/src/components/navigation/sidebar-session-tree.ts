import type { Repo, Session } from '@/api/types'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { getRepoBranchLabel, getRepoDisplayName } from '@/lib/utils'
import { getSessionKey } from '@/lib/sessionKey'
import { getSessionPath, isAssistantPath, parseRepoRoute } from '@/lib/navigation'
import { partitionSessions, selectRootSessions } from '@/components/session/session-partition'

export const SIDEBAR_SESSIONS_PER_REPO = 10

export interface SidebarSessionItem {
  key: string
  session: Session
  repoId: number
  repoLabel: string
  branchLabel: string | null
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

export function buildSidebarRepoGroups(input: {
  repos: Repo[]
  sessions: Session[]
  pinnedKeys: ReadonlySet<string>
  now: number
}): SidebarRepoGroup[] {
  const { repos, sessions, pinnedKeys, now } = input
  const keyFn = getSessionKey
  const repoByDirectory = buildRepoByDirectory(repos)

  const roots = selectRootSessions(sessions, {
    directories: new Set(repos.map((repo) => repo.fullPath)),
    keyFn,
  }).flatMap((session) => {
    if (session.time.archived) return []
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
    return {
      key,
      session,
      repoId: repo.id,
      repoLabel: getRepoDisplayName(repo),
      branchLabel: getRepoBranchLabel(repo),
      isWorktree: Boolean(repo.isWorktree),
      isPinned: pinnedKeys.has(key),
      path: getSessionPath(repo.id, session.id),
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
