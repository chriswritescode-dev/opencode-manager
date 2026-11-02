import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { ClientError, type OpenCodeApi, type V2Event } from '@opencode-manager/shared/opencode'
import { subscribeOpenCodeEvents } from '../../src/services/opencode-event-subscription'

const serverConnected = {
  id: 'evt_connected',
  type: 'server.connected',
  data: {},
} satisfies V2Event

const sessionBusy = {
  id: 'evt_busy',
  created: 1,
  type: 'session.status',
  data: { sessionID: 'ses_1', status: { type: 'busy' } },
} satisfies V2Event

interface ControlledEventStream {
  iterable: AsyncIterable<V2Event>
  signal: AbortSignal
  push: (event: V2Event) => void
  end: () => void
  fail: (error: unknown) => void
}

interface FakeSubscription {
  stream: ControlledEventStream
  onActivity: (() => void) | undefined
}

function createControlledEventStream(): ControlledEventStream {
  const queue: V2Event[] = []
  let finished = false
  let failure: { value: unknown } | null = null
  let signal: AbortSignal
  let notify: (() => void) | null = null

  const wake = (): void => {
    const current = notify
    notify = null
    current?.()
  }

  const iterable: AsyncIterable<V2Event> = {
    [Symbol.asyncIterator]: () => ({
      async next() {
        for (;;) {
          if (queue.length > 0) return { value: queue.shift()!, done: false }
          if (failure) {
            const current = failure.value
            failure = null
            throw current
          }
          if (finished) return { value: undefined, done: true }
          await new Promise<void>((resolve) => {
            notify = resolve
          })
        }
      },
    }),
  }

  return {
    iterable,
    get signal() {
      return signal
    },
    set signal(next: AbortSignal) {
      signal = next
      next.addEventListener('abort', () => {
        failure = { value: next.reason ?? new Error('aborted') }
        wake()
      }, { once: true })
    },
    push: (event) => {
      queue.push(event)
      wake()
    },
    end: () => {
      finished = true
      wake()
    },
    fail: (error) => {
      failure = { value: error }
      wake()
    },
  } as ControlledEventStream
}

function createFakeApi(): { api: OpenCodeApi; subscriptions: FakeSubscription[] } {
  const subscriptions: FakeSubscription[] = []
  const api = {
    event: {
      subscribe: (options: { signal?: AbortSignal; onActivity?: () => void }) => {
        const stream = createControlledEventStream()
        stream.signal = options.signal!
        subscriptions.push({ stream, onActivity: options.onActivity })
        return stream.iterable
      },
    },
  } as unknown as OpenCodeApi
  return { api, subscriptions }
}

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('subscribeOpenCodeEvents', () => {
  it('opens once on server.connected and forwards events in order', async () => {
    const { api, subscriptions } = createFakeApi()
    const onOpen = vi.fn()
    const received: string[] = []
    const onDisconnect = vi.fn()

    const subscription = subscribeOpenCodeEvents({
      api: () => api,
      label: 'test',
      onOpen,
      onEvent: (event) => {
        received.push(event.type)
      },
      onDisconnect,
    })

    expect(subscriptions).toHaveLength(1)

    subscriptions[0]!.stream.push(serverConnected)
    subscriptions[0]!.stream.push(sessionBusy)
    await flush()

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(received).toEqual(['server.connected', 'session.status'])
    expect(onDisconnect).not.toHaveBeenCalled()

    subscription.close()
  })

  it('keeps streaming when an event handler throws', async () => {
    const { api, subscriptions } = createFakeApi()
    const received: string[] = []
    const onDisconnect = vi.fn()

    const subscription = subscribeOpenCodeEvents({
      api: () => api,
      label: 'test',
      onOpen: () => undefined,
      onEvent: (event) => {
        received.push(event.type)
        if (event.type === 'server.connected') throw new Error('handler failure')
      },
      onDisconnect,
    })

    subscriptions[0]!.stream.push(serverConnected)
    subscriptions[0]!.stream.push(sessionBusy)
    await flush()

    expect(received).toEqual(['server.connected', 'session.status'])
    expect(onDisconnect).not.toHaveBeenCalled()

    subscription.close()
  })

  it('reconnects after the stream ends once the reconnect delay elapses', async () => {
    const { api, subscriptions } = createFakeApi()
    const onOpen = vi.fn()
    const onDisconnect = vi.fn()

    const subscription = subscribeOpenCodeEvents({
      api: () => api,
      label: 'test',
      onOpen,
      onEvent: () => undefined,
      onDisconnect,
      reconnectDelayMs: 100,
      maxReconnectDelayMs: 1000,
    })

    subscriptions[0]!.stream.push(serverConnected)
    await flush()
    expect(onOpen).toHaveBeenCalledTimes(1)

    subscriptions[0]!.stream.end()
    await flush()
    expect(onDisconnect).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(99)
    expect(subscriptions).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(subscriptions).toHaveLength(2)

    subscriptions[1]!.stream.push(serverConnected)
    await flush()
    expect(onOpen).toHaveBeenCalledTimes(2)

    subscription.close()
  })

  it('doubles the reconnect delay after a thrown transport error and caps it', async () => {
    const { api, subscriptions } = createFakeApi()
    const onDisconnect = vi.fn()

    const subscription = subscribeOpenCodeEvents({
      api: () => api,
      label: 'test',
      onOpen: () => undefined,
      onEvent: () => undefined,
      onDisconnect,
      reconnectDelayMs: 100,
      maxReconnectDelayMs: 150,
    })

    subscriptions[0]!.stream.fail(new ClientError('Transport'))
    await flush()
    expect(onDisconnect).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(99)
    expect(subscriptions).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(subscriptions).toHaveLength(2)

    subscriptions[1]!.stream.fail(new ClientError('UnexpectedStatus'))
    await flush()
    expect(onDisconnect).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(149)
    expect(subscriptions).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(subscriptions).toHaveLength(3)

    subscription.close()
  })

  it('aborts a stalled attempt and starts a new one', async () => {
    const { api, subscriptions } = createFakeApi()
    const onDisconnect = vi.fn()

    const subscription = subscribeOpenCodeEvents({
      api: () => api,
      label: 'test',
      onOpen: () => undefined,
      onEvent: () => undefined,
      onDisconnect,
      reconnectDelayMs: 10,
      stallThresholdMs: 100,
      watchdogTickMs: 50,
    })

    subscriptions[0]!.stream.push(serverConnected)
    await flush()

    await vi.advanceTimersByTimeAsync(100)
    expect(subscriptions[0]!.stream.signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(50)
    expect(subscriptions[0]!.stream.signal.aborted).toBe(true)
    expect(onDisconnect).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10)
    expect(subscriptions).toHaveLength(2)

    subscription.close()
  })

  it('stops reconnecting after close', async () => {
    const { api, subscriptions } = createFakeApi()
    const onDisconnect = vi.fn()

    const subscription = subscribeOpenCodeEvents({
      api: () => api,
      label: 'test',
      onOpen: () => undefined,
      onEvent: () => undefined,
      onDisconnect,
      reconnectDelayMs: 100,
    })

    subscriptions[0]!.stream.push(serverConnected)
    await flush()
    subscriptions[0]!.stream.end()
    await flush()
    expect(onDisconnect).toHaveBeenCalledTimes(1)

    subscription.close()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(subscriptions).toHaveLength(1)
  })

  it('reconnect aborts the current attempt and restarts with the base delay', async () => {
    const { api, subscriptions } = createFakeApi()

    const subscription = subscribeOpenCodeEvents({
      api: () => api,
      label: 'test',
      onOpen: () => undefined,
      onEvent: () => undefined,
      onDisconnect: () => undefined,
      reconnectDelayMs: 100,
      maxReconnectDelayMs: 1000,
    })

    subscriptions[0]!.stream
      .fail(new ClientError('Transport'))
    await flush()
    await vi.advanceTimersByTimeAsync(100)
    expect(subscriptions).toHaveLength(2)

    subscription.reconnect()
    expect(subscriptions).toHaveLength(3)
    expect(subscriptions[1]!.stream.signal.aborted).toBe(true)

    subscriptions[2]!.stream.end()
    await flush()
    await vi.advanceTimersByTimeAsync(99)
    expect(subscriptions).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(subscriptions).toHaveLength(4)

    subscription.close()
  })
})
