import { describe, it, expect } from 'vitest'
import { partitionSessions } from './session-partition'
import type { Session } from '@/api/types'

function createSession(id: string, updated: number, directory = '/test'): Session {
  return {
    id,
    projectID: 'proj-1',
    directory,
    title: `Session ${id}`,
    version: '1',
    time: { created: updated - 10000, updated },
  }
}

const keyFn = (s: { id: string; directory?: string }) =>
  `${s.directory ?? ''}:${s.id}`

describe('partitionSessions', () => {
  it('places pinned sessions in pinned array sorted by updated desc', () => {
    const now = 1_000_000_000_000
    const sessions = [
      createSession('a', now - 2000),
      createSession('b', now - 1000),
      createSession('c', now - 3000),
    ]
    const pinnedKeys = new Set(['/test:a', '/test:c'])

    const result = partitionSessions(sessions, pinnedKeys, keyFn, now)

    expect(result.pinned).toHaveLength(2)
    expect(result.pinned[0].id).toBe('a')
    expect(result.pinned[1].id).toBe('c')
    expect(result.today).toHaveLength(1)
    expect(result.today[0].id).toBe('b')
    expect(result.older).toHaveLength(0)
  })

  it('places unpinned sessions with updated >= start of today in today', () => {
    const now = 1_000_000_000_000
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayTs = todayStart.getTime() + 5000
    const yesterdayTs = todayStart.getTime() - 1000

    const sessions = [
      createSession('today-session', todayTs),
      createSession('yesterday-session', yesterdayTs),
    ]

    const result = partitionSessions(sessions, new Set(), keyFn, now)

    expect(result.pinned).toHaveLength(0)
    expect(result.today).toHaveLength(1)
    expect(result.today[0].id).toBe('today-session')
    expect(result.older).toHaveLength(1)
    expect(result.older[0].id).toBe('yesterday-session')
  })

  it('sorts today and older arrays by updated desc', () => {
    const now = 1_000_000_000_000
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayTs = todayStart.getTime() + 5000

    const sessions = [
      createSession('older-1', todayStart.getTime() - 3000),
      createSession('older-2', todayStart.getTime() - 1000),
      createSession('today-1', todayTs),
      createSession('today-2', todayTs - 2000),
    ]

    const result = partitionSessions(sessions, new Set(), keyFn, now)

    expect(result.today[0].id).toBe('today-1')
    expect(result.today[1].id).toBe('today-2')
    expect(result.older[0].id).toBe('older-2')
    expect(result.older[1].id).toBe('older-1')
  })

  it('keeps old pinned sessions in pinned (not older)', () => {
    const now = 1_000_000_000_000
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const oldTs = todayStart.getTime() - 86400_000

    const sessions = [
      createSession('pinned-old', oldTs),
      createSession('normal-old', oldTs),
    ]
    const pinnedKeys = new Set(['/test:pinned-old'])

    const result = partitionSessions(sessions, pinnedKeys, keyFn, now)

    expect(result.pinned).toHaveLength(1)
    expect(result.pinned[0].id).toBe('pinned-old')
    expect(result.today).toHaveLength(0)
    expect(result.older).toHaveLength(1)
    expect(result.older[0].id).toBe('normal-old')
  })

  it('returns empty pinned when pinnedKeys is empty, matching today/older behavior', () => {
    const now = 1_000_000_000_000
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayTs = todayStart.getTime() + 5000
    const yesterdayTs = todayStart.getTime() - 1000

    const sessions = [
      createSession('today-session', todayTs),
      createSession('yesterday-session', yesterdayTs),
    ]

    const result = partitionSessions(sessions, new Set(), keyFn, now)

    expect(result.pinned).toHaveLength(0)
    expect(result.today).toHaveLength(1)
    expect(result.older).toHaveLength(1)
  })

  it('produces disjoint pinned/today/older arrays', () => {
    const now = 1_000_000_000_000
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayTs = todayStart.getTime() + 5000
    const yesterdayTs = todayStart.getTime() - 1000

    const sessions = [
      createSession('pinned', todayTs),
      createSession('normal-today', todayTs - 2000),
      createSession('normal-old', yesterdayTs),
    ]
    const pinnedKeys = new Set(['/test:pinned'])

    const result = partitionSessions(sessions, pinnedKeys, keyFn, now)

    const all = [...result.pinned, ...result.today, ...result.older]
    expect(all).toHaveLength(sessions.length)
    const allIds = all.map((s) => s.id).sort()
    expect(allIds).toEqual(['normal-old', 'normal-today', 'pinned'])
  })
})
