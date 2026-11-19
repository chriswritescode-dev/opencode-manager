import { waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { openCodeLocationQueryOptions } from '@/lib/openCodeLocation'
import { useSessionPickerLocationPrefetch } from './useSessionPickerLocationPrefetch'
import { renderHookWithProviders } from '@/test/render'
import { makeRepo } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'

const REPO_PATH = '/repo'
const LOCATION_PATH = '/api/opencode/api/location'

const repo = makeRepo({ id: 1, fullPath: REPO_PATH })

const locationInfo = {
  directory: REPO_PATH,
  project: { id: 'proj_1', directory: REPO_PATH, canonical: REPO_PATH },
}

const locationRoute: FetchRoute = {
  method: 'GET',
  path: LOCATION_PATH,
  respond: () => ({ json: locationInfo }),
}

const locationQueryKey = openCodeLocationQueryOptions(REPO_PATH, LOCAL_OPENCODE_SERVER_ID).queryKey

function renderPrefetch(route: string, reposRoute: FetchRoute['respond']) {
  return renderHookWithProviders(() => useSessionPickerLocationPrefetch(), {
    auth: false,
    theme: false,
    tts: false,
    toaster: false,
    route,
    fetchRoutes: [
      { method: 'GET', path: '/api/repos', respond: reposRoute },
      locationRoute,
    ],
  })
}

describe('useSessionPickerLocationPrefetch', () => {
  it('prefetches the location once repos data arrives after mount', async () => {
    let resolveRepos: (result: { json: object }) => void = () => undefined
    const { queryClient, fetchFake } = renderPrefetch(
      '/repos/1/sessions/session-1',
      () =>
        new Promise((resolve) => {
          resolveRepos = resolve
        }),
    )

    expect(fetchFake.findRequests('GET', LOCATION_PATH)).toHaveLength(0)

    resolveRepos({ json: [repo] })

    await waitFor(() => expect(fetchFake.findRequests('GET', LOCATION_PATH)).toHaveLength(1))
    await waitFor(() => expect(queryClient.getQueryData(locationQueryKey)).toEqual(locationInfo))

    const locationQuery = queryClient.getQueryCache().find({ queryKey: locationQueryKey })
    expect(locationQuery?.observers.length).toBe(0)
  })

  it('prefetches the location when repos data is already cached', async () => {
    const { queryClient, fetchFake } = renderPrefetch('/repos/1/sessions/session-1', () => ({ json: [repo] }))
    queryClient.setQueryData(['repos'], [repo])

    await waitFor(() => expect(fetchFake.findRequests('GET', LOCATION_PATH)).toHaveLength(1))
    await waitFor(() => expect(queryClient.getQueryData(locationQueryKey)).toEqual(locationInfo))
  })

  it('does not prefetch when the route has no repo', async () => {
    const { queryClient, fetchFake } = renderPrefetch('/sessions/session-1', () => ({ json: [repo] }))
    queryClient.setQueryData(['repos'], [repo])

    await waitFor(() => expect(fetchFake.findRequests('GET', '/api/repos').length).toBeGreaterThan(0))
    expect(fetchFake.findRequests('GET', LOCATION_PATH)).toHaveLength(0)
  })
})
