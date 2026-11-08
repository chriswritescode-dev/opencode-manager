import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportConnectivityFailure, resetConnectivitySignalForTests, subscribeConnectivityFailure } from '@/lib/connectivitySignal'
import type { OpenCodeEventStream } from '@/lib/opencode-event-stream'
import { installConnectivityMonitor, useConnectivityStore } from './connectivityStore'

vi.mock('@/lib/connectivitySignal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/connectivitySignal')>()
  return {
    ...actual,
    subscribeConnectivityFailure: vi.fn(actual.subscribeConnectivityFailure),
  }
})

interface FakeStream {
  stream: OpenCodeEventStream
  reconnectNow: ReturnType<typeof vi.fn>
  unsubscribeStatus: ReturnType<typeof vi.fn>
  emitStatus: (connected: boolean) => void
}

function createFakeStream(): FakeStream {
  const reconnectNow = vi.fn()
  const unsubscribeStatus = vi.fn()
  let statusListener: ((connected: boolean) => void) | undefined
  const subscribeStatus = vi.fn((listener: (connected: boolean) => void) => {
    statusListener = listener
    return unsubscribeStatus
  })

  return {
    stream: { reconnectNow, subscribeStatus } as unknown as OpenCodeEventStream,
    reconnectNow,
    unsubscribeStatus,
    emitStatus: (connected) => statusListener?.(connected),
  }
}

describe('useConnectivityStore', () => {
  beforeEach(() => {
    resetConnectivitySignalForTests()
    useConnectivityStore.setState({ interrupted: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetConnectivitySignalForTests()
    useConnectivityStore.setState({ interrupted: false })
  })

  it('toggles interrupted state', () => {
    useConnectivityStore.getState().markInterrupted()
    expect(useConnectivityStore.getState().interrupted).toBe(true)

    useConnectivityStore.getState().clearInterrupted()
    expect(useConnectivityStore.getState().interrupted).toBe(false)
  })
})

describe('installConnectivityMonitor', () => {
  beforeEach(() => {
    resetConnectivitySignalForTests()
    useConnectivityStore.setState({ interrupted: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetConnectivitySignalForTests()
    useConnectivityStore.setState({ interrupted: false })
  })

  it('marks interrupted and reconnects when the Manager cannot be reached', () => {
    const fake = createFakeStream()
    const cleanup = installConnectivityMonitor(fake.stream)

    reportConnectivityFailure()

    expect(useConnectivityStore.getState().interrupted).toBe(true)
    expect(fake.reconnectNow).toHaveBeenCalledTimes(1)

    cleanup()
  })

  it('clears interrupted when the stream reports it is connected', () => {
    const fake = createFakeStream()
    const cleanup = installConnectivityMonitor(fake.stream)
    useConnectivityStore.getState().markInterrupted()

    fake.emitStatus(true)

    expect(useConnectivityStore.getState().interrupted).toBe(false)

    cleanup()
  })

  it('leaves interrupted unchanged when the stream reports a disconnect', () => {
    const fake = createFakeStream()
    const cleanup = installConnectivityMonitor(fake.stream)
    useConnectivityStore.getState().markInterrupted()

    fake.emitStatus(false)

    expect(useConnectivityStore.getState().interrupted).toBe(true)

    cleanup()
  })

  it('reconnects when the page becomes visible', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const fake = createFakeStream()
    const cleanup = installConnectivityMonitor(fake.stream)

    document.dispatchEvent(new Event('visibilitychange'))

    expect(fake.reconnectNow).toHaveBeenCalledTimes(1)

    cleanup()
  })

  it('does not reconnect when the page becomes hidden', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const fake = createFakeStream()
    const cleanup = installConnectivityMonitor(fake.stream)

    document.dispatchEvent(new Event('visibilitychange'))

    expect(fake.reconnectNow).not.toHaveBeenCalled()

    cleanup()
  })

  it('removes every listener on cleanup', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const unsubscribeFailure = vi.fn()
    vi.mocked(subscribeConnectivityFailure).mockReturnValueOnce(unsubscribeFailure)
    const fake = createFakeStream()
    const cleanup = installConnectivityMonitor(fake.stream)

    cleanup()

    expect(unsubscribeFailure).toHaveBeenCalledTimes(1)
    expect(fake.unsubscribeStatus).toHaveBeenCalledTimes(1)
    expect(fake.reconnectNow).not.toHaveBeenCalled()

    document.dispatchEvent(new Event('visibilitychange'))
    reportConnectivityFailure()

    expect(fake.reconnectNow).not.toHaveBeenCalled()
    expect(useConnectivityStore.getState().interrupted).toBe(false)
  })
})
