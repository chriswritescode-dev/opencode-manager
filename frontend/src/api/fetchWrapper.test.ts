import { afterEach, describe, expect, it, vi } from 'vitest'
import { FetchError, fetchWrapper } from './fetchWrapper'

function respondWith(body: string, status: number) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })))
}

describe('fetchWrapper error bodies', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the JSON error message', async () => {
    respondWith(JSON.stringify({ error: 'Session not found', code: 'NOT_FOUND' }), 404)

    await expect(fetchWrapper('/api/x')).rejects.toMatchObject({ message: 'Session not found', statusCode: 404, code: 'NOT_FOUND' })
  })

  it('keeps a plain-text error body', async () => {
    respondWith('upstream unavailable', 502)

    await expect(fetchWrapper('/api/x')).rejects.toMatchObject({ message: 'upstream unavailable' })
  })

  it('replaces an HTML error page with a status message', async () => {
    respondWith('<!DOCTYPE html><html><body>A timeout occurred</body></html>', 524)

    const error = await fetchWrapper('/api/x').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(FetchError)
    expect((error as FetchError).message).toBe('Request failed with status 524')
  })
})
