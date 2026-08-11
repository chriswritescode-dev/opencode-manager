import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserEventStreamTransport } from './browserTransport'

describe('browserTransport.post', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts JSON with credentials and resolves true on success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    const result = await createBrowserEventStreamTransport().post('/api/sse/subscribe', {
      clientId: 'c1',
      directories: ['/a'],
    })

    expect(result).toBe(true)

    const callUrl = fetchMock.mock.calls[0][0]
    expect(callUrl).toEqual(expect.stringContaining('/api/sse/subscribe'))

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')

    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ clientId: 'c1', directories: ['/a'] })
  })

  it('resolves false instead of throwing when the server rejects', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 }),
    )

    const result = await createBrowserEventStreamTransport().post('/api/sse/subscribe', {
      clientId: 'c1',
      directories: ['/a'],
    })

    expect(result).toBe(false)
  })

  it('resolves false instead of throwing when the network rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await createBrowserEventStreamTransport().post('/api/sse/subscribe', {
      clientId: 'c1',
      directories: ['/a'],
    })

    expect(result).toBe(false)
  })
})
