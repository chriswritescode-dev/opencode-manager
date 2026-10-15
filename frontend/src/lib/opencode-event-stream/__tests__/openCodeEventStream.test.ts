import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenCodeEventStream, TestEventStreamTransport } from '..'
import type { EventStreamHealthState } from '..'

class RejectingSubscribeTransport extends TestEventStreamTransport {
  override async post(path: string, body: unknown): Promise<boolean> {
    this.posts.push({ path, body })
    return false
  }
}

class DeferredSubscribeTransport extends TestEventStreamTransport {
  private resolvers: Array<(value: boolean) => void> = []

  override post(path: string, body: unknown): Promise<boolean> {
    this.posts.push({ path, body })
    return new Promise<boolean>((resolve) => {
      this.resolvers.push(resolve)
    })
  }

  resolvePosts(success = true): void {
    const resolvers = this.resolvers
    this.resolvers = []
    resolvers.forEach((resolve) => resolve(success))
  }
}

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
    transport.message({ directory: '/repo', payload: { type: 'permission.asked', properties: { sessionID: 'session-1' } } })

    expect(onEvent).toHaveBeenCalledWith({
      type: 'permission.asked',
      properties: { sessionID: 'session-1' },
      directory: '/repo',
    })
  })

  it('delivers location-less events without a directory', () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })
    const onEvent = vi.fn()

    stream.subscribeGlobalMonitor({ directories: ['/repo'], onEvent })
    transport.openConnection()
    transport.connected()
    transport.message({ directory: null, payload: { type: 'provider.updated', data: {} } })
    transport.message({ payload: { type: 'credential.updated', data: {} } })

    expect(onEvent).toHaveBeenNthCalledWith(1, { type: 'provider.updated', data: {} })
    expect(onEvent).toHaveBeenNthCalledWith(2, { type: 'credential.updated', data: {} })
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

  it('recovers when a connection never opens', async () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })

    stream.subscribeGlobalMonitor({ directories: [], onEvent: vi.fn() })
    expect(transport.openedUrls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(transport.closeCount).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(transport.openedUrls.length).toBeGreaterThan(1)
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

  it('opens the initial EventSource URL with first subscriber directories', () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })

    stream.subscribeGlobalMonitor({ directories: ['/repo'], onEvent: vi.fn() })

    expect(transport.openedUrls).toHaveLength(1)
    const url = transport.openedUrls[0]
    expect(url).toContain('/api/sse/stream')
    expect(url).toContain(encodeURIComponent('/repo'))
  })

  it('opens the initial EventSource URL with all first subscriber directories', () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })

    stream.subscribeGlobalMonitor({ directories: ['/repo-a', '/repo-b'], onEvent: vi.fn() })

    expect(transport.openedUrls).toHaveLength(1)
    const url = transport.openedUrls[0]
    expect(url).toContain('/api/sse/stream')
    expect(url).toContain(encodeURIComponent('/repo-a'))
    expect(url).toContain(encodeURIComponent('/repo-b'))
  })

  it('marks health unhealthy when backend connected event reports no upstream connection', () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })
    const healthStates: EventStreamHealthState[] = []

    stream.subscribeGlobalMonitor({
      directories: [],
      onEvent: vi.fn(),
      onHealthChange: (health) => healthStates.push(health),
    })

    transport.openConnection()
    transport.connectedPayload({ clientId: 'client-1', connected: 0, total: 1 })

    const unhealthyState = healthStates.at(-1)
    expect(unhealthyState?.isConnected).toBe(true)
    expect(unhealthyState?.isHealthy).toBe(false)

    transport.connectedPayload({ clientId: 'client-1', connected: 1, total: 1 })

    const healthyState = healthStates.at(-1)
    expect(healthyState?.isConnected).toBe(true)
    expect(healthyState?.isHealthy).toBe(true)
  })

  it('notifies the global monitor when the upstream stream resynchronizes', () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })
    const onResync = vi.fn()

    stream.subscribeGlobalMonitor({ directories: ['/repo'], onEvent: vi.fn(), onResync })
    transport.openConnection()
    transport.connected()
    transport.resync()

    expect(onResync).toHaveBeenCalledTimes(1)
    expect(onResync).toHaveBeenCalledWith(['/repo'])
  })

  it('reports visibility through the transport adapter', async () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })

    const subscription = stream.subscribeGlobalMonitor({ directories: ['/repo'], onEvent: vi.fn() })
    transport.openConnection()
    transport.connected('client-1')
    subscription.reportVisibility(true, 'session-1')
    await Promise.resolve()

    expect(transport.posts).toContainEqual({
      path: '/api/sse/visibility',
      body: { clientId: 'client-1', visible: true, activeSessionId: 'session-1' },
    })
  })

  it('notifies the global monitor with directories subscribed mid-connection', async () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })
    const onDirectoriesSubscribed = vi.fn()

    const subscription = stream.subscribeGlobalMonitor({
      directories: ['/repo-a'],
      onEvent: vi.fn(),
      onDirectoriesSubscribed,
    })
    transport.openConnection()
    transport.connected('client-1')
    await vi.advanceTimersByTimeAsync(0)
    onDirectoriesSubscribed.mockClear()

    subscription.updateDirectories(['/repo-a', '/repo-b'])
    await vi.advanceTimersByTimeAsync(0)

    expect(onDirectoriesSubscribed).toHaveBeenCalledWith(['/repo-b'])
  })

  it('notifies the global monitor for pending directories flushed after connect', async () => {
    const transport = new TestEventStreamTransport()
    const stream = new OpenCodeEventStream({ transport })
    const onDirectoriesSubscribed = vi.fn()

    stream.subscribeGlobalMonitor({ directories: ['/repo'], onEvent: vi.fn(), onDirectoriesSubscribed })
    expect(onDirectoriesSubscribed).not.toHaveBeenCalled()

    transport.openConnection()
    transport.connected('client-1')
    await vi.advanceTimersByTimeAsync(0)

    expect(onDirectoriesSubscribed).toHaveBeenCalledWith(['/repo'])
  })

  it('does not notify the global monitor when the subscribe request fails', async () => {
    const transport = new RejectingSubscribeTransport()
    const stream = new OpenCodeEventStream({ transport })
    const onDirectoriesSubscribed = vi.fn()

    stream.subscribeGlobalMonitor({ directories: ['/repo'], onEvent: vi.fn(), onDirectoriesSubscribed })
    transport.openConnection()
    transport.connected('client-1')
    await vi.advanceTimersByTimeAsync(0)

    expect(onDirectoriesSubscribed).not.toHaveBeenCalled()
  })

  it('ignores a subscribe response that resolves after the stream reconnected', async () => {
    const transport = new DeferredSubscribeTransport()
    const stream = new OpenCodeEventStream({ transport })
    const onDirectoriesSubscribed = vi.fn()

    stream.subscribeGlobalMonitor({ directories: ['/repo'], onEvent: vi.fn(), onDirectoriesSubscribed })
    transport.openConnection()
    transport.connected('client-1')
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.posts).toContainEqual({
      path: '/api/sse/subscribe',
      body: { clientId: 'client-1', directories: ['/repo'] },
    })

    transport.fail()
    transport.openConnection()
    transport.connected('client-2')

    transport.resolvePosts()
    await vi.advanceTimersByTimeAsync(0)

    expect(onDirectoriesSubscribed).not.toHaveBeenCalled()
  })

  it('does not notify a directory removed while its subscribe request is in flight', async () => {
    const transport = new DeferredSubscribeTransport()
    const stream = new OpenCodeEventStream({ transport })
    const onDirectoriesSubscribed = vi.fn()

    const subscription = stream.subscribeGlobalMonitor({
      directories: ['/repo'],
      onEvent: vi.fn(),
      onDirectoriesSubscribed,
    })
    transport.openConnection()
    transport.connected('client-1')
    await vi.advanceTimersByTimeAsync(0)

    subscription.updateDirectories([])

    transport.resolvePosts()
    await vi.advanceTimersByTimeAsync(0)

    expect(onDirectoriesSubscribed).not.toHaveBeenCalled()
  })
})
