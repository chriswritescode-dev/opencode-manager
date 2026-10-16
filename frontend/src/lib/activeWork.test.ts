import { describe, it, expect } from 'vitest'
import type { Repo, Session } from '@/api/types'
import type { ChildOutcome } from '@/lib/backgroundWork'
import type { SessionStatusType } from '@/stores/sessionStatusStore'
import {
  buildActiveWork,
  buildRepoActivityIndex,
  collectActiveRoots,
  formatActivityEmptyMessage,
  formatActivityWindow,
  repoActivityFromIndex,
  rootSessionID,
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
})
