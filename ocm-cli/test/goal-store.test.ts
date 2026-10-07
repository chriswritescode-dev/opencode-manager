import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SessionGoal } from '@opencode-manager/shared/schemas'
import { createGoalStore, isOpenGoal, GOAL_POLL_INTERVAL_MS } from '../src/goal-store.js'

function goal(overrides: Partial<SessionGoal> = {}): SessionGoal {
  return {
    id: 1,
    sessionId: 'ses_a',
    directory: '/repo',
    objective: 'fix it',
    status: 'active',
    stopReason: null,
    turnState: 'waiting',
    continuationCount: 0,
    maxContinuations: 5,
    tokenBudget: null,
    tokensUsed: 0,
    consecutiveBlocked: 0,
    lastVerdict: null,
    lastReason: null,
    createdAt: 1,
    updatedAt: 1,
    finishedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('isOpenGoal', () => {
  it('accepts active and paused goals', () => {
    expect(isOpenGoal(goal({ status: 'active' }))).toBe(true)
    expect(isOpenGoal(goal({ status: 'paused' }))).toBe(true)
  })

  it('rejects terminal and missing goals', () => {
    expect(isOpenGoal(goal({ status: 'completed' }))).toBe(false)
    expect(isOpenGoal(goal({ status: 'blocked' }))).toBe(false)
    expect(isOpenGoal(goal({ status: 'stopped' }))).toBe(false)
    expect(isOpenGoal(null)).toBe(false)
    expect(isOpenGoal(undefined)).toBe(false)
  })
})

describe('createGoalStore', () => {
  it('defaults the poll interval to the frontend refetch interval', () => {
    expect(GOAL_POLL_INTERVAL_MS).toBe(3000)
  })

  it('loads once on watch and notifies the listener with the goal', async () => {
    const active = goal()
    const load = vi.fn().mockResolvedValue(active)
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })
    const listener = vi.fn()

    const unwatch = store.watch('ses_a', listener)
    await vi.advanceTimersByTimeAsync(0)

    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('ses_a')
    expect(listener).toHaveBeenCalledWith(active)
    unwatch()
  })

  it('notifies the listener with null when no goal exists', async () => {
    const load = vi.fn().mockResolvedValue(null)
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })
    const listener = vi.fn()

    const unwatch = store.watch('ses_a', listener)
    await vi.advanceTimersByTimeAsync(0)

    expect(listener).toHaveBeenCalledWith(null)
    unwatch()
  })

  it('polls while the goal is active', async () => {
    const load = vi.fn().mockResolvedValue(goal({ status: 'active' }))
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(load).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(100)
    expect(load).toHaveBeenCalledTimes(3)
    unwatch()
  })

  it('stops polling when the goal is paused', async () => {
    const load = vi.fn().mockResolvedValue(goal({ status: 'paused' }))
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(load).toHaveBeenCalledTimes(1)
    unwatch()
  })

  it('stops polling when the goal is terminal', async () => {
    const load = vi.fn().mockResolvedValue(goal({ status: 'completed' }))
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(load).toHaveBeenCalledTimes(1)
    unwatch()
  })

  it('updates watchers immediately on set', async () => {
    const load = vi.fn().mockResolvedValue(null)
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })
    const listener = vi.fn()

    const unwatch = store.watch('ses_a', listener)
    await vi.advanceTimersByTimeAsync(0)
    listener.mockClear()

    const next = goal({ status: 'active' })
    store.set(next)

    expect(listener).toHaveBeenCalledWith(next)
    unwatch()
  })

  it('starts polling when set installs an active goal', async () => {
    const load = vi.fn().mockResolvedValue(null)
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)

    store.set(goal({ status: 'active' }))
    await vi.advanceTimersByTimeAsync(100)

    expect(load).toHaveBeenCalledTimes(2)
    unwatch()
  })

  it('reloads on demand through refresh', async () => {
    const load = vi.fn().mockResolvedValue(null)
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })
    const listener = vi.fn()

    const unwatch = store.watch('ses_a', listener)
    await vi.advanceTimersByTimeAsync(0)
    listener.mockClear()

    const next = goal()
    load.mockResolvedValue(next)
    await store.refresh('ses_a')

    expect(load).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledWith(next)
    unwatch()
  })

  it('fires onOutcome once when a watched goal reaches a terminal status', async () => {
    const active = goal({ status: 'active' })
    const completed = goal({ status: 'completed' })
    const load = vi.fn().mockResolvedValue(active)
    const onOutcome = vi.fn()
    const store = createGoalStore({ load, onOutcome, pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)

    load.mockResolvedValue(completed)
    await vi.advanceTimersByTimeAsync(100)

    expect(onOutcome).toHaveBeenCalledTimes(1)
    expect(onOutcome).toHaveBeenCalledWith(completed)

    await store.refresh('ses_a')
    expect(onOutcome).toHaveBeenCalledTimes(1)
    unwatch()
  })

  it('fires onOutcome when a paused goal is cancelled through set', async () => {
    const paused = goal({ status: 'paused' })
    const stopped = goal({ status: 'stopped', stopReason: 'cancelled' })
    const load = vi.fn().mockResolvedValue(paused)
    const onOutcome = vi.fn()
    const store = createGoalStore({ load, onOutcome, pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)

    store.set(stopped)

    expect(onOutcome).toHaveBeenCalledTimes(1)
    expect(onOutcome).toHaveBeenCalledWith(stopped)
    unwatch()
  })

  it('does not fire onOutcome for a goal that is already terminal', async () => {
    const load = vi.fn().mockResolvedValue(goal({ status: 'completed' }))
    const onOutcome = vi.fn()
    const store = createGoalStore({ load, onOutcome, pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)

    expect(onOutcome).not.toHaveBeenCalled()
    unwatch()
  })

  it('keeps the last goal and polling when a reload fails on an active goal', async () => {
    const active = goal({ status: 'active' })
    const load = vi.fn().mockResolvedValue(active)
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })
    const listener = vi.fn()

    const unwatch = store.watch('ses_a', listener)
    await vi.advanceTimersByTimeAsync(0)

    load.mockRejectedValue(new Error('offline'))
    await vi.advanceTimersByTimeAsync(100)

    expect(load).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenLastCalledWith(active)

    await vi.advanceTimersByTimeAsync(100)
    expect(load).toHaveBeenCalledTimes(3)
    unwatch()
  })

  it('does not poll after an initial load failure', async () => {
    const load = vi.fn().mockRejectedValue(new Error('offline'))
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })
    const listener = vi.fn()

    const unwatch = store.watch('ses_a', listener)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(load).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
    unwatch()
  })

  it('stops polling when the last listener unsubscribes', async () => {
    const load = vi.fn().mockResolvedValue(goal({ status: 'active' }))
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)

    unwatch()
    await vi.advanceTimersByTimeAsync(1000)

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not resume polling when an in-flight load resolves after the last listener unsubscribes', async () => {
    let resolveLoad: (goal: SessionGoal | null) => void = () => {}
    const load = vi.fn(
      () =>
        new Promise<SessionGoal | null>((resolve) => {
          resolveLoad = resolve
        }),
    )
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 20 })

    const unwatch = store.watch('ses_a', vi.fn())
    expect(load).toHaveBeenCalledTimes(1)

    unwatch()
    resolveLoad(goal({ status: 'active' }))
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(200)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not start polling when set targets an unwatched session', async () => {
    const load = vi.fn().mockResolvedValue(goal({ status: 'active' }))
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 20 })

    store.set(goal({ status: 'active' }))
    await vi.advanceTimersByTimeAsync(200)

    expect(load).not.toHaveBeenCalled()
  })

  it('keeps polling while another listener remains', async () => {
    const load = vi.fn().mockResolvedValue(goal({ status: 'active' }))
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })
    const second = vi.fn()

    const unwatchFirst = store.watch('ses_a', vi.fn())
    const unwatchSecond = store.watch('ses_a', second)
    await vi.advanceTimersByTimeAsync(0)

    unwatchFirst()
    load.mockClear()
    await vi.advanceTimersByTimeAsync(100)

    expect(load).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalled()
    unwatchSecond()
  })
})
