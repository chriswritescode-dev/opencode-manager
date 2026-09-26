import type { Repo, Session } from '@/api/types'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { getRepoDisplayName } from '@/lib/utils'
import { buildSessionKey } from '@/lib/sessionKey'
import { isAssistantPath } from '@/lib/navigation'
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

export function parseSidebarRouteSelection(pathname: string): {
  repoId: number | null
  sessionId: string | null
} {
  const match = /^\/repos\/(\d+)(?:\/sessions\/([^/]+))?/.exec(pathname)
  if (!match) {
    return { repoId: null, sessionId: null }
  }

  return {
    repoId: Number(match[1]),
    sessionId: match[2] ?? null,
  }
}

export function isCurrentSessionItem(item: SidebarSessionItem, pathname: string): boolean {
  const selection = parseSidebarRouteSelection(pathname)
  return item.repoId === selection.repoId && item.session.id === selection.sessionId
}

export function getActiveRepoId(pathname: string): number | null {
  if (isAssistantPath(pathname)) return null
  return parseSidebarRouteSelection(pathname).repoId
}

export function selectNavigableRepos(repos: Repo[]): Repo[] {
  return repos
    .filter((repo) => repo.id !== ASSISTANT_REPO_ID)
    .sort((a, b) => (b.lastAccessedAt ?? 0) - (a.lastAccessedAt ?? 0))
}

export function buildSidebarRepoGroups(input: {
  repos: Repo[]
  sessions: Session[]
  pinnedKeys: ReadonlySet<string>
  now: number
}): SidebarRepoGroup[] {
  const { repos, sessions, pinnedKeys, now } = input
  const keyFn = (session: Session) => buildSessionKey(session.location.directory, session.id)
  const repoByDirectory = new Map(repos.map((repo) => [repo.fullPath, repo]))

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
      branchLabel: repo.currentBranch || repo.branch || null,
      isWorktree: Boolean(repo.isWorktree),
      isPinned: pinnedKeys.has(key),
      path: `/repos/${repo.id}/sessions/${session.id}`,
    }
  }

  return repos.map((repo) => {
    const repoRoots = sessionsByDirectory.get(repo.fullPath) ?? []
    const { pinned, today, older } = partitionSessions(repoRoots, pinnedKeys, keyFn, now)
    return {
      repo,
      label: getRepoDisplayName(repo),
      branchLabel: repo.currentBranch || repo.branch || null,
      items: [...pinned, ...today, ...older].map((session) => createItem(session, repo)),
    }
  })
}
