import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HEALTH_PROBE_TIMEOUT_MS,
  SLOW_WRITE_PROBE_MS,
  managerFetch,
  managerHealthUrl,
} from './managerFetch'
import {
  resetConnectivitySignalForTests,
  subscribeConnectivityFailure,
} from '@/lib/connectivitySignal'

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function isHealthProbe(input: RequestInfo | URL): boolean {
  return urlOf(input).endsWith('/api/health')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function abortableNever(init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    })
  })
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('managerFetch writes', () => {
  let reportCount = 0
  let unsubscribe: (() => void) | undefined

  beforeEach(() => {
    resetConnectivitySignalForTests()
    reportCount = 0
    unsubscribe = subscribeConnectivityFailure(() => {
      reportCount += 1
    })
  })

  afterEach(() => {
    unsubscribe?.()
    resetConnectivitySignalForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reports once and rethrows when a write rejects with a network TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    await expect(managerFetch('/api/repos/1', { method: 'POST' })).rejects.toThrow('Failed to fetch')
    expect(reportCount).toBe(1)
  })

  it('never reports a failed read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    await expect(managerFetch('/api/repos')).rejects.toThrow('Failed to fetch')
    expect(reportCount).toBe(0)
  })

  it('never reports an aborted write', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }))

    await expect(managerFetch('/api/repos/1', { method: 'DELETE' })).rejects.toHaveProperty('name', 'AbortError')
    expect(reportCount).toBe(0)
  })
})

describe('managerFetch 502 answers', () => {
  let reportCount = 0
  let unsubscribe: (() => void) | undefined

  beforeEach(() => {
    resetConnectivitySignalForTests()
    reportCount = 0
    unsubscribe = subscribeConnectivityFailure(() => {
      reportCount += 1
    })
  })

  afterEach(() => {
    unsubscribe?.()
    resetConnectivitySignalForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns the 502 response before the probe settles and reports when the probe answers 503', async () => {
    const probe = deferred<Response>()
    const fetchMock = vi.fn((input: RequestInfo | URL) => isHealthProbe(input)
      ? probe.promise
      : Promise.resolve(new Response(null, { status: 502 })))
    vi.stubGlobal('fetch', fetchMock)

    const response = await managerFetch('/api/repos/1', { method: 'POST' })

    expect(response.status).toBe(502)
    expect(reportCount).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    probe.resolve(new Response(null, { status: 503 }))
    await vi.waitFor(() => {
      expect(reportCount).toBe(1)
    })
  })

  it('reports when the health probe throws', async () => {
    const probe = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => isHealthProbe(input)
      ? probe.promise
      : Promise.resolve(new Response(null, { status: 502 }))))

    await managerFetch('/api/repos/1', { method: 'POST' })
    probe.reject(new TypeError('Failed to fetch'))

    await vi.waitFor(() => {
      expect(reportCount).toBe(1)
    })
  })

  it('reports when the health probe times out', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => isHealthProbe(input)
      ? abortableNever(init)
      : Promise.resolve(new Response(null, { status: 502 }))))

    const response = await managerFetch('/api/repos/1', { method: 'POST' })

    expect(response.status).toBe(502)
    expect(reportCount).toBe(0)

    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_TIMEOUT_MS)
    expect(reportCount).toBe(1)
  })

  it('does not report a healthy probe', async () => {
    const probe = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => isHealthProbe(input)
      ? probe.promise
      : Promise.resolve(new Response(null, { status: 502 }))))

    await managerFetch('/api/repos/1', { method: 'POST' })
    probe.resolve(new Response(null, { status: 200 }))

    await flushMicrotasks()
    expect(reportCount).toBe(0)
  })

  it('treats a 4xx probe answer as healthy', async () => {
    const probe = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => isHealthProbe(input)
      ? probe.promise
      : Promise.resolve(new Response(null, { status: 502 }))))

    await managerFetch('/api/repos/1', { method: 'POST' })
    probe.resolve(new Response(null, { status: 404 }))

    await flushMicrotasks()
    expect(reportCount).toBe(0)
  })
})

describe('managerFetch slow writes', () => {
  let reportCount = 0
  let unsubscribe: (() => void) | undefined

  beforeEach(() => {
    resetConnectivitySignalForTests()
    reportCount = 0
    unsubscribe = subscribeConnectivityFailure(() => {
      reportCount += 1
    })
  })

  afterEach(() => {
    unsubscribe?.()
    resetConnectivitySignalForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('probes a write still pending after the slow-write threshold', async () => {
    vi.useFakeTimers()
    const write = deferred<Response>()
    const probe = deferred<Response>()
    const fetchMock = vi.fn((input: RequestInfo | URL) => isHealthProbe(input)
      ? probe.promise
      : write.promise)
    vi.stubGlobal('fetch', fetchMock)

    const pending = managerFetch('/api/repos/1', { method: 'POST' })

    await vi.advanceTimersByTimeAsync(SLOW_WRITE_PROBE_MS - 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(isHealthProbe(fetchMock.mock.calls[1][0])).toBe(true)

    probe.resolve(new Response(null, { status: 200 }))
    await vi.advanceTimersByTimeAsync(0)
    write.resolve(new Response(null, { status: 200 }))

    await expect(pending).resolves.toHaveProperty('status', 200)
    expect(reportCount).toBe(0)
  })

  it('ignores a failing probe result when the slow write settles first', async () => {
    vi.useFakeTimers()
    const write = deferred<Response>()
    const probe = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => isHealthProbe(input)
      ? probe.promise
      : write.promise))

    const pending = managerFetch('/api/repos/1', { method: 'POST' })

    await vi.advanceTimersByTimeAsync(SLOW_WRITE_PROBE_MS)
    write.resolve(new Response(null, { status: 204 }))
    await expect(pending).resolves.toHaveProperty('status', 204)

    probe.resolve(new Response(null, { status: 503 }))
    await vi.advanceTimersByTimeAsync(0)

    expect(reportCount).toBe(0)
  })

  it('shares one in-flight probe across concurrent writes', async () => {
    vi.useFakeTimers()
    const writeA = deferred<Response>()
    const writeB = deferred<Response>()
    const probe = deferred<Response>()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.endsWith('/api/health')) return probe.promise
      if (url.endsWith('/api/a')) return writeA.promise
      return writeB.promise
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = managerFetch('/api/a', { method: 'POST' })
    const second = managerFetch('/api/b', { method: 'POST' })

    await vi.advanceTimersByTimeAsync(SLOW_WRITE_PROBE_MS)
    const healthCalls = fetchMock.mock.calls.filter(([input]) => isHealthProbe(input))
    expect(healthCalls).toHaveLength(1)

    probe.resolve(new Response(null, { status: 200 }))
    await vi.advanceTimersByTimeAsync(0)
    writeA.resolve(new Response(null, { status: 200 }))
    writeB.resolve(new Response(null, { status: 200 }))

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(reportCount).toBe(0)
  })
})

describe('managerHealthUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubOrigin(origin: string): void {
    vi.stubGlobal('window', { location: { origin } })
  }

  it('keeps the path prefix that precedes /api/', () => {
    stubOrigin('https://host')
    expect(managerHealthUrl('https://host/manager/api/repos/1')).toBe('https://host/manager/api/health')
  })

  it('uses the origin root when the path has no /api/ segment', () => {
    stubOrigin('https://host')
    expect(managerHealthUrl('https://host/other')).toBe('https://host/api/health')
  })

  it('resolves relative request URLs against the current origin', () => {
    expect(managerHealthUrl('/api/repos/1')).toBe('http://localhost/api/health')
  })
})
