import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenCodeEventStream, TestEventStreamTransport } from '..'
import type { EventStreamHealthState } from '..'

describe('OpenCodeEventStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers raw events to the global monitor', () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })
    const onEvent = vi.fn()

    stream.subscribeGlobalMonitor({ directories: ['/repo'], onEvent })
    transport.openConnection()
    transport.connected()
    transport.message({ type: 'permission.asked', properties: { sessionID: 'session-1' }, directory: '/repo' })

    expect(onEvent).toHaveBeenCalledWith({
      type: 'permission.asked',
      properties: { sessionID: 'session-1' },
      directory: '/repo',
    })
  })

  it('publishes health through monitor output', () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })
    const healthStates: EventStreamHealthState[] = []

    stream.subscribeGlobalMonitor({
      directories: [],
      onEvent: vi.fn(),
      onHealthChange: (health) => healthStates.push(health),
    })

    transport.openConnection()

    expect(healthStates.at(-1)).toMatchObject({ isConnected: true, isHealthy: true, isStalled: false })
  })

  it('reconnects when the watchdog detects a stall', async () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })

    stream.subscribeGlobalMonitor({ directories: [], onEvent: vi.fn() })
    transport.openConnection()

    await vi.advanceTimersByTimeAsync(105_001)

    expect(transport.closeCount).toBeGreaterThan(0)
  })

  it('diffs global monitor directories through the transport adapter', async () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })

    const subscription = stream.subscribeGlobalMonitor({ directories: ['/repo-a'], onEvent: vi.fn() })
    transport.openConnection()
    transport.connected('client-1')

    subscription.updateDirectories(['/repo-a', '/repo-b'])
    await Promise.resolve()
    subscription.updateDirectories(['/repo-b'])
    await Promise.resolve()

    expect(transport.posts).toContainEqual({
      path: '/api/sse/subscribe',
      body: { clientId: 'client-1', directories: ['/repo-b'] },
    })
    expect(transport.posts).toContainEqual({
      path: '/api/sse/unsubscribe',
      body: { clientId: 'client-1', directories: ['/repo-a'] },
    })
  })

  it('reports visibility through the transport adapter', async () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })

    const subscription = stream.subscribeToDirectory({ directory: '/repo', onEvent: vi.fn() })
    transport.openConnection()
    transport.connected('client-1')
    subscription.reportVisibility(true, 'session-1')
    await Promise.resolve()

    expect(transport.posts).toContainEqual({
      path: '/api/sse/visibility',
      body: { clientId: 'client-1', visible: true, activeSessionId: 'session-1' },
    })
  })
})
