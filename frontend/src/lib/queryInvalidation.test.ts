import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { refreshOpenCodeServerCaches } from './queryInvalidation'

describe('refreshOpenCodeServerCaches', () => {
  it('invalidates every cache that displays the installed OpenCode version', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    refreshOpenCodeServerCaches(queryClient)

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['health'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode-versions'] })
  })

  it('updates both OpenCode version caches when the new version is known', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['health'], { opencodeVersion: '1.0.0', status: 'healthy' })
    queryClient.setQueryData(['opencode-versions'], { currentVersion: '1.0.0', versions: [] })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    refreshOpenCodeServerCaches(queryClient, '1.0.1')

    expect(queryClient.getQueryData(['health'])).toEqual({ opencodeVersion: '1.0.1', status: 'healthy' })
    expect(queryClient.getQueryData(['opencode-versions'])).toEqual({ currentVersion: '1.0.1', versions: [] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['health'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode-versions'] })
  })
})
