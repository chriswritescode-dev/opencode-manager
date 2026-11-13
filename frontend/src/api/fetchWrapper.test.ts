import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createFetchFake, type FetchRouteResult } from '@/test/fetchFake'
import { FetchError, fetchWrapper } from './fetchWrapper'

function installFailingRoute(reply: FetchRouteResult): void {
  const fetchFake = createFetchFake([{ method: 'GET', path: '/api/x', respond: () => reply }])
  fetchFake.install()
}

describe('fetchWrapper error bodies', () => {
  it('uses the JSON error message', async () => {
    installFailingRoute({ status: 404, json: { error: 'Session not found', code: 'NOT_FOUND' } })

    const request = fetchWrapper('/api/x', z.object({}))

    await expect(request).rejects.toBeInstanceOf(FetchError)
    await expect(request).rejects.toMatchObject({
      message: 'Session not found',
      statusCode: 404,
      code: 'NOT_FOUND',
    })
  })

  it('keeps a plain-text error body', async () => {
    installFailingRoute({ status: 502, text: 'upstream unavailable' })

    await expect(fetchWrapper('/api/x', z.object({}))).rejects.toMatchObject({
      message: 'upstream unavailable',
    })
  })

  it('replaces an HTML error page with a status message', async () => {
    installFailingRoute({ status: 524, text: '<!DOCTYPE html><html><body>A timeout occurred</body></html>' })

    await expect(fetchWrapper('/api/x', z.object({}))).rejects.toMatchObject({
      message: 'Request failed with status 524',
    })
  })

  it('renders validation detail paths that contain array indexes', async () => {
    installFailingRoute({
      status: 400,
      json: {
        error: 'Invalid request body',
        details: [{ path: ['items', 0, 'name'], message: 'Required' }],
      },
    })

    await expect(fetchWrapper('/api/x', z.object({}))).rejects.toMatchObject({
      message: 'Invalid request body',
      detail: 'items.0.name: Required',
    })
  })
})
