import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  reportConnectivityFailure,
  resetConnectivitySignalForTests,
  subscribeConnectivityFailure,
} from './connectivitySignal'

describe('connectivitySignal', () => {
  beforeEach(() => {
    resetConnectivitySignalForTests()
  })

  it('notifies a listener once per report', () => {
    const listener = vi.fn()
    subscribeConnectivityFailure(listener)

    reportConnectivityFailure()
    reportConnectivityFailure()

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('notifies every subscriber', () => {
    const first = vi.fn()
    const second = vi.fn()
    subscribeConnectivityFailure(first)
    subscribeConnectivityFailure(second)

    reportConnectivityFailure()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('stops notifying an unsubscribed listener', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeConnectivityFailure(listener)

    unsubscribe()
    reportConnectivityFailure()

    expect(listener).not.toHaveBeenCalled()
  })

  it('clears listeners on reset', () => {
    const listener = vi.fn()
    subscribeConnectivityFailure(listener)

    resetConnectivitySignalForTests()
    reportConnectivityFailure()

    expect(listener).not.toHaveBeenCalled()
  })
})
