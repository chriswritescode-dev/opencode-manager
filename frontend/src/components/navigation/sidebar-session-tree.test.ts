import { describe, it, expect } from 'vitest'
import type { Repo, Session } from '@/api/types'
import {
  buildSidebarRepoGroups,
  getActiveRepoId,
  isCurrentSessionItem,
  isRepoReady,
  selectNavigableRepos,
} from './sidebar-session-tree'

const NOW = 1_000_000_000_000

function atStartOfDay(offsetMs: number): number {
  const start = new Date(NOW)
  start.setHours(0, 0, 0, 0)
  return start.getTime() + offsetMs
}

function createSession(id: string, updated: number, directory: string): Session {
  return {
    id,
    projectID: 'proj-1',
    title: `Session ${id}`,
    time: { created: updated - 10000, updated },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function createRepo(overrides: Partial<Repo> & { id: number; fullPath: string }): Repo {
  return {
    localPath: `repos/${overrides.id}`,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 0,
    ...overrides,
  }
}

describe('getActiveRepoId', () => {
  it('returns the repo id for repo and session routes', () => {
    expect(getActiveRepoId('/repos/3')).toBe(3)
    expect(getActiveRepoId('/repos/3/sessions/abc')).toBe(3)
  })

  it('returns null outside a repo and on assistant routes', () => {
    expect(getActiveRepoId('/')).toBeNull()
    expect(getActiveRepoId('/assistant')).toBeNull()
    expect(getActiveRepoId('/repos/1/assistant')).toBeNull()
  })
})

describe('isCurrentSessionItem', () => {
  const repo = createRepo({ id: 1, fullPath: '/repos/a' })
  const [item] = buildSidebarRepoGroups({
    repos: [repo],
    sessions: [createSession('a1', NOW, '/repos/a')],
    pinnedKeys: new Set(),
    now: NOW,
  })[0].items

  it('matches only the exact repo and session route', () => {
    expect(isCurrentSessionItem(item, '/repos/1/sessions/a1')).toBe(true)
    expect(isCurrentSessionItem(item, '/repos/1')).toBe(false)
    expect(isCurrentSessionItem(item, '/repos/2/sessions/a1')).toBe(false)
  })
})

describe('isRepoReady', () => {
  it('is true only for ready repos', () => {
    expect(isRepoReady(createRepo({ id: 1, fullPath: '/repos/a' }))).toBe(true)
    expect(isRepoReady(createRepo({ id: 2, fullPath: '/repos/b', cloneStatus: 'cloning' }))).toBe(false)
    expect(isRepoReady(createRepo({ id: 3, fullPath: '/repos/c', cloneStatus: 'error' }))).toBe(false)
  })
})

describe('selectNavigableRepos', () => {
  it('excludes the assistant repo but keeps repos that are not ready', () => {
    const repos = [
      createRepo({ id: 0, fullPath: '/assistant' }),
      createRepo({ id: 1, fullPath: '/repos/a' }),
      createRepo({ id: 2, fullPath: '/repos/b', cloneStatus: 'cloning' }),
    ]

    expect(selectNavigableRepos(repos).map((repo) => repo.id)).toEqual([1, 2])
  })

  it('sorts by last access, newest first, with never-accessed repos last', () => {
    const repos = [
      createRepo({ id: 1, fullPath: '/repos/a', lastAccessedAt: 10 }),
      createRepo({ id: 2, fullPath: '/repos/b' }),
      createRepo({ id: 3, fullPath: '/repos/c', lastAccessedAt: 30 }),
    ]

    expect(selectNavigableRepos(repos).map((repo) => repo.id)).toEqual([3, 1, 2])
  })

  it('does not mutate the input', () => {
    const repos = [
      createRepo({ id: 1, fullPath: '/repos/a', lastAccessedAt: 1 }),
      createRepo({ id: 2, fullPath: '/repos/b', lastAccessedAt: 2 }),
    ]

    selectNavigableRepos(repos)

    expect(repos.map((repo) => repo.id)).toEqual([1, 2])
  })
})

describe('buildSidebarRepoGroups', () => {
  const repoA = createRepo({ id: 1, fullPath: '/repos/a', name: 'Alpha' })
  const repoB = createRepo({ id: 2, fullPath: '/repos/b', name: 'Beta' })

  it('returns one group per repo in input order with pinned first then recency', () => {
    const sessions = [
      createSession('a1', atStartOfDay(3000), '/repos/a'),
      createSession('a2', atStartOfDay(5000), '/repos/a'),
      createSession('a3', atStartOfDay(1000), '/repos/a'),
      createSession('b1', atStartOfDay(4000), '/repos/b'),
    ]
    const pinnedKeys = new Set(['/repos/a:a2'])

    const groups = buildSidebarRepoGroups({ repos: [repoB, repoA], sessions, pinnedKeys, now: NOW })

    expect(groups.map((group) => group.repo.id)).toEqual([2, 1])
    expect(groups[0].items.map((item) => item.session.id)).toEqual(['b1'])
    expect(groups[1].items.map((item) => item.session.id)).toEqual(['a2', 'a1', 'a3'])
    expect(groups[1].items[0].isPinned).toBe(true)
    expect(groups[1].items[1].isPinned).toBe(false)
  })

  it('excludes subtasks, archived sessions and sessions from unknown directories', () => {
    const archived = createSession('archived', atStartOfDay(6000), '/repos/a')
    archived.time.archived = atStartOfDay(6000)
    const sessions = [
      createSession('root', atStartOfDay(3000), '/repos/a'),
      { ...createSession('child', atStartOfDay(4000), '/repos/a'), parentID: 'root' },
      archived,
      createSession('unknown', atStartOfDay(7000), '/repos/c'),
    ]

    const groups = buildSidebarRepoGroups({ repos: [repoA], sessions, pinnedKeys: new Set(), now: NOW })

    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((item) => item.session.id)).toEqual(['root'])
  })

  it('builds item fields from the owning repo', () => {
    const worktree = createRepo({
      id: 3,
      fullPath: '/repos/wt',
      name: 'Worktree',
      currentBranch: 'feature/x',
      isWorktree: true,
    })
    const sessions = [createSession('w1', atStartOfDay(1000), '/repos/wt')]

    const groups = buildSidebarRepoGroups({
      repos: [worktree],
      sessions,
      pinnedKeys: new Set(['/repos/wt:w1']),
      now: NOW,
    })

    const item = groups[0].items[0]
    expect(item.key).toBe('/repos/wt:w1')
    expect(item.repoId).toBe(3)
    expect(item.repoLabel).toBe('Worktree')
    expect(item.branchLabel).toBe('feature/x')
    expect(item.isWorktree).toBe(true)
    expect(item.isPinned).toBe(true)
    expect(item.path).toBe('/repos/3/sessions/w1')
  })

  it('falls back to repo.branch when currentBranch is absent', () => {
    const repo = createRepo({ id: 4, fullPath: '/repos/d', branch: 'main' })
    const sessions = [createSession('d1', atStartOfDay(1000), '/repos/d')]

    const groups = buildSidebarRepoGroups({ repos: [repo], sessions, pinnedKeys: new Set(), now: NOW })

    expect(groups[0].branchLabel).toBe('main')
    expect(groups[0].items[0].branchLabel).toBe('main')
  })
})
