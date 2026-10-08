import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SESSION_GOAL_POLL_INTERVAL_MS, type SessionGoal } from '@opencode-manager/shared/schemas'
import { createGoalStore } from '../src/goal-store.js'
import { goal } from './helpers/goal-fixture.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createGoalStore', () => {
  it('defaults the poll interval to the shared session goal interval', async () => {
    expect(SESSION_GOAL_POLL_INTERVAL_MS).toBe(3000)
    const load = vi.fn().mockResolvedValue(goal({ status: 'active' }))
    const store = createGoalStore({ load, onOutcome: vi.fn() })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(SESSION_GOAL_POLL_INTERVAL_MS)
    expect(load).toHaveBeenCalledTimes(2)
    unwatch()
  })

  it('loads once on watch and notifies the listener with the goal', async () => {
    const active = goal()
    const load = vi.fn().mockResolvedValue(active)
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })
    const listener = vi.fn()

    const unwatch = store.watch('ses_a', listener)
    await vi.advanceTimersByTimeAsync(0)

    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('ses_a', expect.any(AbortSignal))
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

  it('keeps polling while the goal is paused', async () => {
    const load = vi.fn().mockResolvedValue(goal({ status: 'paused' }))
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)

    expect(load).toHaveBeenCalledTimes(2)
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

  it('does not start a second load while one is in flight', async () => {
    let resolveLoad: (goal: SessionGoal | null) => void = () => {}
    const load = vi.fn(
      () =>
        new Promise<SessionGoal | null>((resolve) => {
          resolveLoad = resolve
        }),
    )
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    expect(load).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(1)

    resolveLoad(goal({ status: 'active' }))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(load).toHaveBeenCalledTimes(2)
    unwatch()
  })

  it('drops a stale load that resolves after set installs newer state', async () => {
    let resolveLoad: (goal: SessionGoal | null) => void = () => {}
    const load = vi.fn(
      () =>
        new Promise<SessionGoal | null>((resolve) => {
          resolveLoad = resolve
        }),
    )
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })
    const listener = vi.fn()

    const unwatch = store.watch('ses_a', listener)
    const installed = goal({ status: 'paused' })
    store.set(installed)
    expect(listener).toHaveBeenLastCalledWith(installed)

    resolveLoad(goal({ status: 'active' }))
    await vi.advanceTimersByTimeAsync(0)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith(installed)
    unwatch()
  })

  it('backs off exponentially on load errors and resets on success', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(goal({ status: 'active' }))
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(load).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(300)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(100)
    expect(load).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(100)
    expect(load).toHaveBeenCalledTimes(4)
    unwatch()
  })

  it('aborts the in-flight load when the last listener leaves without an open goal', async () => {
    let captured: AbortSignal | undefined
    const load = vi.fn((_sessionID: string, signal: AbortSignal) => {
      captured = signal
      return new Promise<SessionGoal | null>(() => {})
    })
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    expect(captured?.aborted).toBe(false)

    unwatch()

    expect(captured?.aborted).toBe(true)
    expect(load).toHaveBeenCalledTimes(1)
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

    await vi.advanceTimersByTimeAsync(1000)
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

  it('fires onOutcome for each new goal id followed in the same entry', async () => {
    const load = vi.fn().mockResolvedValue(goal({ status: 'completed' }))
    const onOutcome = vi.fn()
    const store = createGoalStore({ load, onOutcome, pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)

    const first = goal({ id: 7, status: 'active' })
    const firstDone = goal({ id: 7, status: 'completed' })
    store.set(first)
    store.set(firstDone)
    expect(onOutcome).toHaveBeenCalledTimes(1)

    const second = goal({ id: 8, status: 'active' })
    const secondDone = goal({ id: 8, status: 'completed' })
    store.set(second)
    store.set(secondDone)
    expect(onOutcome).toHaveBeenCalledTimes(2)
    expect(onOutcome).toHaveBeenLastCalledWith(secondDone)
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

  it('keeps following an open goal in the background and fires onOutcome once after the last listener leaves', async () => {
    const active = goal({ status: 'active' })
    const completed = goal({ status: 'completed' })
    const load = vi.fn().mockResolvedValueOnce(active).mockResolvedValue(completed)
    const onOutcome = vi.fn()
    const store = createGoalStore({ load, onOutcome, pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)

    unwatch()
    await vi.advanceTimersByTimeAsync(14999)
    expect(load).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    expect(onOutcome).toHaveBeenCalledTimes(1)
    expect(onOutcome).toHaveBeenCalledWith(completed)

    await vi.advanceTimersByTimeAsync(60000)
    expect(load).toHaveBeenCalledTimes(2)
    expect(onOutcome).toHaveBeenCalledTimes(1)
  })

  it('returns to foreground polling when a listener re-subscribes', async () => {
    const load = vi.fn().mockResolvedValue(goal({ status: 'active' }))
    const store = createGoalStore({ load, onOutcome: vi.fn(), pollIntervalMs: 100 })

    const unwatch = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)

    unwatch()
    await vi.advanceTimersByTimeAsync(5000)
    expect(load).toHaveBeenCalledTimes(1)

    const unwatchAgain = store.watch('ses_a', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(100)
    expect(load).toHaveBeenCalledTimes(3)
    unwatchAgain()
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

    await vi.advanceTimersByTimeAsync(200)
    expect(load).toHaveBeenCalledTimes(3)
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
