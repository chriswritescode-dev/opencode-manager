import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FetchError } from '@opencode-manager/shared'
import { fetchWrapper } from './fetchWrapper'

describe('fetchWrapper', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends credentials: include on every request', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    await fetchWrapper('/api/x')

    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
  })

  it('keeps credentials: include when the caller passes its own options', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    await fetchWrapper('/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    const init = fetchMock.mock.calls[0][1]
    expect(init.credentials).toBe('include')
    expect(init.method).toBe('POST')
  })

  it('aborts the request when the caller signal aborts', async () => {
    fetchMock.mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      }),
    )

    const controller = new AbortController()
    const promise = fetchWrapper('/api/x', { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow()
  })

  it('rejects with a 408 TIMEOUT FetchError when the timeout elapses', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_url, init) => {
      const signal = init.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        if (signal.aborted) {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
          return
        }
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        }, { once: true })
      })
    })

    const promise = fetchWrapper('/api/x', { timeout: 100 })
    vi.advanceTimersByTime(101)

    await expect(promise).rejects.toBeInstanceOf(FetchError)
    await expect(promise).rejects.toMatchObject({
      statusCode: 408,
      code: 'TIMEOUT',
    })

    vi.useRealTimers()
  })

  it('rejects with 499 CANCELED when the caller aborts, not 408 TIMEOUT', async () => {
    fetchMock.mockImplementation((_url, init) => {
      const signal = init.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        if (signal.aborted) {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
          return
        }
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        }, { once: true })
      })
    })

    const controller = new AbortController()
    const promise = fetchWrapper('/api/x', { signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toBeInstanceOf(FetchError)
    await expect(promise).rejects.toMatchObject({
      statusCode: 499,
      code: 'CANCELED',
    })
  })
})
