import { describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'
import { useVcsInfo } from './useVcsInfo'
import { renderHookWithProviders } from '@/test/render'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

const REMOTE_PREFIX = '/api/opencode/servers/srv_kitchen'

function vcsRoutes() {
  return [
    {
      method: 'GET' as const,
      path: `${REMOTE_PREFIX}/api/vcs`,
      respond: () => ({ json: { data: { branch: { current: 'feat/header', default: 'main' } } } }),
    },
  ]
}

describe('useVcsInfo', () => {
  it('reads the branch of the directory from the given server', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useVcsInfo('/abs/repo', 'srv_kitchen'), {
      ...hookProviders,
      serverId: 'srv_kitchen',
      fetchRoutes: vcsRoutes(),
    })

    await waitFor(() => expect(result.current.data?.branch.current).toBe('feat/header'))
    expect(fetchFake.lastRequest('GET', `${REMOTE_PREFIX}/api/vcs`)?.searchParams.get('location[directory]')).toBe('/abs/repo')
  })

  it('stays disabled without a directory', () => {
    const { result, fetchFake } = renderHookWithProviders(() => useVcsInfo(undefined, 'srv_kitchen'), {
      ...hookProviders,
      serverId: 'srv_kitchen',
      fetchRoutes: vcsRoutes(),
    })

    expect(result.current.fetchStatus).toBe('idle')
    expect(fetchFake.findRequests('GET', `${REMOTE_PREFIX}/api/vcs`)).toHaveLength(0)
  })

  it('stays disabled when the caller disables it', () => {
    const { fetchFake } = renderHookWithProviders(() => useVcsInfo('/abs/repo', 'srv_kitchen', { enabled: false }), {
      ...hookProviders,
      serverId: 'srv_kitchen',
      fetchRoutes: vcsRoutes(),
    })

    expect(fetchFake.findRequests('GET', `${REMOTE_PREFIX}/api/vcs`)).toHaveLength(0)
  })

  it('shares one cache entry between callers of the same directory and server', async () => {
    const { result, queryClient, fetchFake } = renderHookWithProviders(
      () => ({ first: useVcsInfo('/abs/repo', 'srv_kitchen'), second: useVcsInfo('/abs/repo', 'srv_kitchen') }),
      { ...hookProviders, serverId: 'srv_kitchen', fetchRoutes: vcsRoutes() },
    )

    await waitFor(() => expect(result.current.first.data?.branch.current).toBe('feat/header'))
    await waitFor(() => expect(result.current.second.data?.branch.current).toBe('feat/header'))

    expect(fetchFake.findRequests('GET', `${REMOTE_PREFIX}/api/vcs`)).toHaveLength(1)
    expect(queryClient.getQueryData(['opencode', 'vcs', '/abs/repo', 'srv_kitchen', 'info'])).toMatchObject({
      branch: { current: 'feat/header' },
    })
  })
})
