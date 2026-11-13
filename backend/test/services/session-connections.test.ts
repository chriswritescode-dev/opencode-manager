import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSessionConnections, registerSessionConnection } from '../../src/services/session-connections'
import { testLogEntries } from '../helpers/log-assertions'

describe('session connections registry', () => {
  beforeEach(() => {
    closeSessionConnections('session-a')
    closeSessionConnections('session-b')
  })

  it('closes every connection registered for a session', () => {
    const first = vi.fn()
    const second = vi.fn()
    registerSessionConnection('session-a', first)
    registerSessionConnection('session-a', second)

    closeSessionConnections('session-a')

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('clears the session so later closes do not re-invoke connections', () => {
    const close = vi.fn()
    registerSessionConnection('session-a', close)

    closeSessionConnections('session-a')
    closeSessionConnections('session-a')

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('leaves other sessions connected', () => {
    const closed = vi.fn()
    const kept = vi.fn()
    registerSessionConnection('session-a', closed)
    registerSessionConnection('session-b', kept)

    closeSessionConnections('session-a')

    expect(closed).toHaveBeenCalledTimes(1)
    expect(kept).not.toHaveBeenCalled()

    closeSessionConnections('session-b')
    expect(kept).toHaveBeenCalledTimes(1)
  })

  it('unregisters a single connection without closing it', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unregisterFirst = registerSessionConnection('session-a', first)
    registerSessionConnection('session-a', second)

    unregisterFirst()
    closeSessionConnections('session-a')

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('treats a repeated unregister as a no-op', () => {
    const close = vi.fn()
    const unregister = registerSessionConnection('session-a', close)

    unregister()
    unregister()
    registerSessionConnection('session-a', close)
    closeSessionConnections('session-a')

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('keeps closing the remaining connections when one throws', () => {
    const failing = vi.fn(() => {
      throw new Error('socket already closed')
    })
    const healthy = vi.fn()
    registerSessionConnection('session-a', failing)
    registerSessionConnection('session-a', healthy)

    expect(() => closeSessionConnections('session-a')).not.toThrow()

    expect(failing).toHaveBeenCalledTimes(1)
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(testLogEntries('error')).toHaveLength(1)
  })

  it('ignores sessions without registered connections', () => {
    expect(() => closeSessionConnections('unknown-session')).not.toThrow()
    expect(testLogEntries('error')).toEqual([])
  })
})
