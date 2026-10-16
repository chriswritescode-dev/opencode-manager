import { describe, it, expect } from 'vitest'
import type { Repo, Session } from '@/api/types'
import type { ChildOutcome } from '@/lib/backgroundWork'
import type { SessionStatusType } from '@/stores/sessionStatusStore'
import type { RepoSibling, RepoWorktreeSource } from '@opencode-manager/shared/utils'
import {
  buildActiveWork,
  buildRepoActivityIndex,
  buildWorktreeActivity,
  collectActiveRoots,
  formatActivityEmptyMessage,
  formatActivityWindow,
  hasUnmatchedActiveDirectory,
  needsWorktreeLookup,
  repoActivityFromIndex,
  rootSessionID,
  type ActiveWorktree,
} from './activeWork'

const NOW = 1_000_000_000_000
const WINDOW_MS = 60_000

function createSession(id: string, updated: number, directory: string, parentID?: string): Session {
  return {
    id,
    projectID: 'proj-1',
    title: `Session ${id}`,
    time: { created: updated - 10000, updated },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(parentID ? { parentID } : {}),
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

function createWorktreeSibling(id: number, fullPath: string, branch: string, source: RepoWorktreeSource): RepoSibling {
  return {
    ...createRepo({ id, fullPath }),
    currentBranch: branch,
    worktreeSource: source,
  }
}

function statuses(entries: Record<string, SessionStatusType>): Map<string, SessionStatusType> {
  return new Map(Object.entries(entries))
}

const repoA = createRepo({ id: 1, fullPath: '/repos/a' })
const emptyRoots = { needsInput: new Set<string>(), running: new Set<string>() }

describe('formatActivityWindow', () => {
  it('labels the known minute options', () => {
    expect(formatActivityWindow(15)).toBe('15 minutes')
    expect(formatActivityWindow(30)).toBe('30 minutes')
    expect(formatActivityWindow(60)).toBe('1 hour')
    expect(formatActivityWindow(120)).toBe('2 hours')
    expect(formatActivityWindow(240)).toBe('4 hours')
    expect(formatActivityWindow(480)).toBe('8 hours')
    expect(formatActivityWindow(1440)).toBe('24 hours')
  })

  it('falls back to minutes for unknown values', () => {
    expect(formatActivityWindow(45)).toBe('45 minutes')
    expect(formatActivityWindow(90)).toBe('90 minutes')
  })

  it('falls back to hours for unknown values divisible by sixty', () => {
    expect(formatActivityWindow(180)).toBe('3 hours')
  })
})

describe('formatActivityEmptyMessage', () => {
  it('names the window in the empty-state copy', () => {
    expect(formatActivityEmptyMessage(30)).toBe('No active or recent sessions in the last 30 minutes')
    expect(formatActivityEmptyMessage(1440)).toBe(
      'No active or recent sessions in the last 24 hours',
    )
  })
})

describe('rootSessionID', () => {
  it('climbs parents to the top-most root', () => {
    const parents = new Map<string, string | null>([['child', 'parent'], ['parent', 'root'], ['root', null]])

    expect(rootSessionID('child', parents)).toBe('root')
    expect(rootSessionID('parent', parents)).toBe('root')
    expect(rootSessionID('root', parents)).toBe('root')
  })

  it('terminates on a parent cycle', () => {
    const parents = new Map<string, string | null>([['a', 'b'], ['b', 'a']])

    expect(typeof rootSessionID('a', parents)).toBe('string')
  })
})

describe('collectActiveRoots', () => {
  it('rolls a busy child up to its root as running', () => {
    const parents = new Map<string, string | null>([['child', 'root'], ['root', null]])

    const roots = collectActiveRoots({
      statuses: statuses({ child: { type: 'busy' } }),
      parents,
      runningShells: new Map(),
      pendingInputSessionIDs: [],
    })

    expect(roots.running.has('root')).toBe(true)
    expect(roots.running.has('child')).toBe(false)
    expect(roots.needsInput.size).toBe(0)
  })

  it('rolls a running shell under a child up to the root', () => {
    const parents = new Map<string, string | null>([['child', 'root'], ['root', null]])

    const roots = collectActiveRoots({
      statuses: statuses({}),
      parents,
      runningShells: new Map([['shell-1', { sessionID: 'child' }]]),
      pendingInputSessionIDs: [],
    })

    expect(roots.running.has('root')).toBe(true)
  })

  it('rolls a pending permission up to the root as needs-input', () => {
    const parents = new Map<string, string | null>([['child', 'root'], ['root', null]])

    const roots = collectActiveRoots({
      statuses: statuses({}),
      parents,
      runningShells: new Map(),
      pendingInputSessionIDs: ['child'],
    })

    expect(roots.needsInput.has('root')).toBe(true)
  })

  it('terminates on a parent cycle', () => {
    const parents = new Map<string, string | null>([['a', 'b'], ['b', 'a']])

    const roots = collectActiveRoots({
      statuses: statuses({ a: { type: 'busy' } }),
      parents,
      runningShells: new Map(),
      pendingInputSessionIDs: [],
    })

    expect(roots.running.size).toBe(1)
  })
})

describe('buildRepoActivityIndex and repoActivityFromIndex', () => {
  const noShells = new Map<string, { sessionID: string; directory: string }>()

  const stateFor = (
    repo: Repo,
    input: Parameters<typeof buildRepoActivityIndex>[0],
  ): 'needs-input' | 'running' | null =>
    repoActivityFromIndex(repo, buildRepoActivityIndex(input))

  it('matches a busy session by its own directory', () => {
    const state = stateFor(repoA, {
      statuses: statuses({ child: { type: 'busy' } }),
      parents: new Map([['child', 'root'], ['root', null]]),
      runningShells: noShells,
      directories: new Map([['child', '/repos/a']]),
      pendingInputSessionIDs: [],
    })

    expect(state).toBe('running')
  })

  it('matches a busy session by its root directory', () => {
    const state = stateFor(repoA, {
      statuses: statuses({ child: { type: 'busy' } }),
      parents: new Map([['child', 'root'], ['root', null]]),
      runningShells: noShells,
      directories: new Map([['root', '/repos/a']]),
      pendingInputSessionIDs: [],
    })

    expect(state).toBe('running')
  })

  it('matches a running shell by its own directory', () => {
    const state = stateFor(repoA, {
      statuses: statuses({}),
      parents: new Map(),
      runningShells: new Map([['shell-1', { sessionID: 'orphan', directory: '/repos/a' }]]),
      directories: new Map(),
      pendingInputSessionIDs: [],
    })

    expect(state).toBe('running')
  })

  it('matches a session directory against the repo local path', () => {
    const localRepo = createRepo({ id: 7, fullPath: '/repos/full', localPath: '/local/path' })
    const state = stateFor(localRepo, {
      statuses: statuses({ session: { type: 'busy' } }),
      parents: new Map(),
      runningShells: noShells,
      directories: new Map([['session', '/local/path']]),
      pendingInputSessionIDs: [],
    })

    expect(state).toBe('running')
  })

  it('prefers needs-input over running', () => {
    const state = stateFor(repoA, {
      statuses: statuses({ session: { type: 'busy' } }),
      parents: new Map(),
      runningShells: noShells,
      directories: new Map([['session', '/repos/a']]),
      pendingInputSessionIDs: ['session'],
    })

    expect(state).toBe('needs-input')
  })

  it('returns null when every matching session is idle', () => {
    const state = stateFor(repoA, {
      statuses: statuses({ session: { type: 'idle' } }),
      parents: new Map(),
      runningShells: noShells,
      directories: new Map([['session', '/repos/a']]),
      pendingInputSessionIDs: [],
    })

    expect(state).toBeNull()
  })

  it('returns null when the repo matches no indexed directory', () => {
    const state = stateFor(repoA, {
      statuses: statuses({ session: { type: 'busy' } }),
      parents: new Map(),
      runningShells: noShells,
      directories: new Map([['session', '/repos/other']]),
      pendingInputSessionIDs: [],
    })

    expect(state).toBeNull()
  })

  it('reuses the index for the same snapshot references', () => {
    const input: Parameters<typeof buildRepoActivityIndex>[0] = {
      statuses: statuses({ session: { type: 'busy' } }),
      parents: new Map(),
      runningShells: noShells,
      directories: new Map([['session', '/repos/a']]),
      pendingInputSessionIDs: [],
    }

    expect(buildRepoActivityIndex(input)).toBe(buildRepoActivityIndex(input))
  })
})

describe('repoActivityFromIndex with worktrees', () => {
  const noShells = new Map<string, { sessionID: string; directory: string }>()
  const main = createRepo({ id: 1, fullPath: '/repos/a' })
  const other = createRepo({ id: 2, fullPath: '/repos/b' })

  const indexFor = (entries: Record<string, string>, pending: string[] = []) =>
    buildRepoActivityIndex({
      statuses: statuses(Object.fromEntries(Object.keys(entries).map((id) => [id, { type: 'busy' as const }]))),
      parents: new Map(),
      runningShells: noShells,
      directories: new Map(Object.entries(entries)),
      pendingInputSessionIDs: pending,
    })

  it('returns running for a repo whose owned worktree directory is running', () => {
    const index = indexFor({ session: '/repos/a/.worktrees/feature' })
    const worktrees: ActiveWorktree[] = [
      { directory: '/repos/a/.worktrees/feature', ownerRepo: main, branch: 'feature', isSchedule: false },
    ]

    expect(repoActivityFromIndex(main, index, worktrees)).toBe('running')
  })

  it('ignores worktrees owned by another repo', () => {
    const index = indexFor({ session: '/repos/b/.worktrees/feature' })
    const worktrees: ActiveWorktree[] = [
      { directory: '/repos/b/.worktrees/feature', ownerRepo: other, branch: 'feature', isSchedule: false },
    ]

    expect(repoActivityFromIndex(main, index, worktrees)).toBeNull()
  })

  it('prefers needs-input from a worktree over running on the repo path', () => {
    const index = buildRepoActivityIndex({
      statuses: statuses({ own: { type: 'busy' }, wt: { type: 'busy' } }),
      parents: new Map(),
      runningShells: noShells,
      directories: new Map([
        ['own', '/repos/a'],
        ['wt', '/repos/a/.worktrees/feature'],
      ]),
      pendingInputSessionIDs: ['wt'],
    })
    const worktrees: ActiveWorktree[] = [
      { directory: '/repos/a/.worktrees/feature', ownerRepo: main, branch: 'feature', isSchedule: false },
    ]

    expect(repoActivityFromIndex(main, index, worktrees)).toBe('needs-input')
  })
})

describe('hasUnmatchedActiveDirectory', () => {
  const noShells = new Map<string, { sessionID: string; directory: string }>()

  const indexFor = (directory: string) =>
    buildRepoActivityIndex({
      statuses: statuses({ session: { type: 'busy' } }),
      parents: new Map(),
      runningShells: noShells,
      directories: new Map([['session', directory]]),
      pendingInputSessionIDs: [],
    })

  it('is true when an index key matches no repo', () => {
    expect(hasUnmatchedActiveDirectory(indexFor('/repos/other'), [repoA])).toBe(true)
  })

  it('is false when every indexed directory belongs to a repo', () => {
    expect(hasUnmatchedActiveDirectory(indexFor('/repos/a'), [repoA])).toBe(false)
  })

  it('is false for an empty index', () => {
    expect(hasUnmatchedActiveDirectory(new Map(), [repoA])).toBe(false)
  })
})

describe('buildActiveWork', () => {
  it('puts a root with both a pending permission and a busy status in needs-input only, once', () => {
    const parents = new Map<string, string | null>()
    const roots = collectActiveRoots({
      statuses: statuses({ root: { type: 'busy' } }),
      parents,
      runningShells: new Map(),
      pendingInputSessionIDs: ['root'],
    })
    const sessions = [createSession('root', NOW - 1000, '/repos/a')]

    const groups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [repoA], sessions, parents: new Map(), roots, outcomes: new Map() })

    expect(groups.needsInput.map((item) => item.session.id)).toEqual(['root'])
    expect(groups.running).toEqual([])
    const all = [...groups.needsInput, ...groups.running, ...groups.recent]
    expect(all.filter((item) => item.session.id === 'root')).toHaveLength(1)
  })

  it('includes a session updated exactly at the window boundary and excludes the one before it', () => {
    const sessions = [
      createSession('inside', NOW - WINDOW_MS, '/repos/a'),
      createSession('outside', NOW - WINDOW_MS - 1, '/repos/a'),
    ]

    const groups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [repoA], sessions, parents: new Map(), roots: emptyRoots, outcomes: new Map() })

    expect(groups.recent.map((item) => item.session.id)).toEqual(['inside'])
  })

  it('excludes archived sessions', () => {
    const archived = createSession('archived', NOW - 1000, '/repos/a')
    archived.time.archived = NOW - 500
    const sessions = [createSession('active', NOW - 1000, '/repos/a'), archived]

    const groups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [repoA], sessions, parents: new Map(), roots: emptyRoots, outcomes: new Map() })

    expect(groups.recent.map((item) => item.session.id)).toEqual(['active'])
  })

  it('excludes sessions whose directory matches no repo', () => {
    const sessions = [createSession('orphan', NOW - 1000, '/repos/other')]

    const groups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [repoA], sessions, parents: new Map(), roots: emptyRoots, outcomes: new Map() })

    expect(groups.recent).toEqual([])
  })

  it('resolves a repo by local path and trims trailing slashes', () => {
    const repo = createRepo({ id: 5, fullPath: '/repos/full', localPath: '/local/path' })
    const sessions = [createSession('local', NOW - 1000, '/local/path/')]

    const groups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [repo], sessions, parents: new Map(), roots: emptyRoots, outcomes: new Map() })

    expect(groups.recent).toHaveLength(1)
    expect(groups.recent[0].repo.id).toBe(5)
    expect(groups.recent[0].key).toBe('/local/path/:local')
    expect(groups.recent[0].path).toBe('/repos/5/sessions/local')
  })

  it('sorts each group by updated descending', () => {
    const sessions = [
      createSession('oldest', NOW - 3000, '/repos/a'),
      createSession('newest', NOW - 1000, '/repos/a'),
      createSession('middle', NOW - 2000, '/repos/a'),
    ]

    const groups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [repoA], sessions, parents: new Map(), roots: emptyRoots, outcomes: new Map() })

    expect(groups.recent.map((item) => item.session.id)).toEqual(['newest', 'middle', 'oldest'])
  })

  it('carries the child outcome onto the item', () => {
    const sessions = [createSession('root', NOW - 1000, '/repos/a')]
    const outcomes = new Map<string, ChildOutcome>([['root', 'failed']])

    const groups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [repoA], sessions, parents: new Map(), roots: emptyRoots, outcomes })

    expect(groups.recent[0].outcome).toBe('failed')
  })

  it('rolls a child updated inside the window up to its root for the recent test and updatedAt', () => {
    const parents = new Map<string, string | null>([['child', 'root'], ['root', null]])
    const sessions = [
      createSession('root', NOW - WINDOW_MS - 1, '/repos/a'),
      createSession('child', NOW - 1000, '/repos/a', 'root'),
    ]

    const groups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [repoA], sessions, parents, roots: emptyRoots, outcomes: new Map() })

    expect(groups.recent.map((item) => item.session.id)).toEqual(['root'])
    expect(groups.recent[0].updatedAt).toBe(NOW - 1000)
  })

  it('sorts by the rolled-up time and never emits children or grandchildren', () => {
    const parents = new Map<string, string | null>([
      ['child-of-a', 'root-a'],
      ['grandchild-of-a', 'child-of-a'],
      ['root-a', null],
      ['root-b', null],
    ])
    const sessions = [
      createSession('root-a', NOW - 5000, '/repos/a'),
      createSession('child-of-a', NOW - 4000, '/repos/a', 'root-a'),
      createSession('grandchild-of-a', NOW - 1000, '/repos/a', 'child-of-a'),
      createSession('root-b', NOW - 2000, '/repos/a'),
    ]

    const groups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [repoA], sessions, parents, roots: emptyRoots, outcomes: new Map() })

    expect(groups.recent.map((item) => item.session.id)).toEqual(['root-a', 'root-b'])
    expect(groups.recent[0].updatedAt).toBe(NOW - 1000)
  })

  it('does not emit a child whose root is absent from the input', () => {
    const parents = new Map<string, string | null>([['child', 'root']])
    const sessions = [createSession('child', NOW - 1000, '/repos/a', 'root')]

    const groups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [repoA], sessions, parents, roots: emptyRoots, outcomes: new Map() })

    expect(groups.recent).toEqual([])
  })

  it('emits the root once it is supplied alongside its child', () => {
    const parents = new Map<string, string | null>([['child', 'root'], ['root', null]])
    const sessions = [
      createSession('child', NOW - 1000, '/repos/a', 'root'),
      createSession('root', NOW - WINDOW_MS - 1, '/repos/a'),
    ]

    const groups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [repoA], sessions, parents, roots: emptyRoots, outcomes: new Map() })

    expect(groups.recent.map((item) => item.session.id)).toEqual(['root'])
  })

  it('resolves a session in a worktree to its owning repo and opens the workspaces tab', () => {
    const main = createRepo({ id: 1, fullPath: '/repos/a' })
    const sessions = [createSession('wt', NOW - 1000, '/repos/a/.worktrees/feature')]
    const worktrees = [{ directory: '/repos/a/.worktrees/feature', ownerRepo: main, branch: 'feature', isSchedule: false }]

    const groups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [main], sessions, parents: new Map(), roots: emptyRoots, outcomes: new Map(), worktrees })

    expect(groups.recent).toHaveLength(1)
    expect(groups.recent[0].repo.id).toBe(1)
    expect(groups.recent[0].worktreeBranch).toBe('feature')
    expect(groups.recent[0].path).toBe('/repos/1/sessions/wt?repoTab=workspaces')
  })

  it('drops a recent schedule worktree session but keeps it while its root is running', () => {
    const main = createRepo({ id: 1, fullPath: '/repos/a' })
    const worktrees = [
      { directory: '/repos/a/.worktrees/nightly', ownerRepo: main, branch: 'nightly', isSchedule: true },
    ]
    const sessions = [createSession('sched', NOW - 1000, '/repos/a/.worktrees/nightly')]

    const recentGroups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [main], sessions, parents: new Map(), roots: emptyRoots, outcomes: new Map(), worktrees })

    expect(recentGroups.recent).toEqual([])

    const runningGroups = buildActiveWork({ now: NOW, windowMs: WINDOW_MS, repos: [main], sessions, parents: new Map(), roots: { needsInput: new Set(), running: new Set(['sched']) }, outcomes: new Map(), worktrees })

    expect(runningGroups.running.map((item) => item.session.id)).toEqual(['sched'])
  })
})

describe('needsWorktreeLookup', () => {
  const base = { now: NOW, windowMs: WINDOW_MS, repos: [repoA] }

  it('returns true for an unmatched session updated inside the window', () => {
    expect(
      needsWorktreeLookup({
        ...base,
        sessions: [createSession('orphan', NOW - 1000, '/repos/other')],
        parents: new Map(),
        roots: emptyRoots,
      }),
    ).toBe(true)
  })

  it('returns false for an unmatched old idle session', () => {
    expect(
      needsWorktreeLookup({
        ...base,
        sessions: [createSession('orphan', NOW - WINDOW_MS - 1, '/repos/other')],
        parents: new Map(),
        roots: emptyRoots,
      }),
    ).toBe(false)
  })

  it('returns true for an unmatched old session whose root is running', () => {
    const parents = new Map<string, string | null>([['orphan', 'root'], ['root', null]])

    expect(
      needsWorktreeLookup({
        ...base,
        sessions: [createSession('orphan', NOW - WINDOW_MS - 1, '/repos/other', 'root')],
        parents,
        roots: { needsInput: new Set(), running: new Set(['root']) },
      }),
    ).toBe(true)
  })

  it('returns false when every session matches a repo', () => {
    expect(
      needsWorktreeLookup({
        ...base,
        sessions: [createSession('matched', NOW - 1000, '/repos/a')],
        parents: new Map(),
        roots: emptyRoots,
      }),
    ).toBe(false)
  })

  it('returns false for an archived unmatched session', () => {
    const archived = createSession('archived', NOW - 1000, '/repos/other')
    archived.time.archived = NOW - 500

    expect(
      needsWorktreeLookup({
        ...base,
        sessions: [archived],
        parents: new Map(),
        roots: emptyRoots,
      }),
    ).toBe(false)
  })
})

describe('buildWorktreeActivity', () => {
  it('maps a worktree directory to its owning repo and branch', () => {
    const main = createRepo({ id: 1, fullPath: '/repos/a' })
    const worktree = createWorktreeSibling(-1, '/repos/a/.worktrees/feature', 'feature', 'opencode')

    expect(buildWorktreeActivity([main], [{ data: [main, worktree] }])).toEqual([
      { directory: '/repos/a/.worktrees/feature', ownerRepo: main, branch: 'feature', isSchedule: false },
    ])
  })

  it('marks a schedule worktree as a schedule', () => {
    const main = createRepo({ id: 1, fullPath: '/repos/a' })
    const worktree = createWorktreeSibling(-1, '/repos/a/.worktrees/nightly', 'nightly', 'schedule')

    expect(buildWorktreeActivity([main], [{ data: [worktree] }])).toEqual([
      { directory: '/repos/a/.worktrees/nightly', ownerRepo: main, branch: 'nightly', isSchedule: true },
    ])
  })

  it('prefers the non-worktree repo as owner and dedupes a worktree returned by several repos', () => {
    const main = createRepo({ id: 1, fullPath: '/repos/a' })
    const dbWorktree = createRepo({ id: 2, fullPath: '/repos/a-feature', isWorktree: true })
    const worktree = createWorktreeSibling(-1, '/repos/a/.worktrees/feature', 'feature', 'git')

    const entries = buildWorktreeActivity(
      [dbWorktree, main],
      [{ data: [worktree] }, { data: [worktree] }],
    )

    expect(entries).toHaveLength(1)
    expect(entries[0].ownerRepo.id).toBe(1)
  })

  it('ignores siblings without a worktree source', () => {
    const main = createRepo({ id: 1, fullPath: '/repos/a' })

    expect(buildWorktreeActivity([main], [{ data: [main] }])).toEqual([])
  })
})
