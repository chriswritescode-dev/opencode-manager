import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { updateOpenCodeVersionCaches } from './queryInvalidation'

describe('updateOpenCodeVersionCaches', () => {
  it('updates and invalidates both OpenCode version caches', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['health'], { opencodeVersion: '1.0.0', status: 'healthy' })
    queryClient.setQueryData(['opencode-versions'], { currentVersion: '1.0.0', versions: [] })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    updateOpenCodeVersionCaches(queryClient, '1.0.1')

    expect(queryClient.getQueryData(['health'])).toEqual({ opencodeVersion: '1.0.1', status: 'healthy' })
    expect(queryClient.getQueryData(['opencode-versions'])).toEqual({ currentVersion: '1.0.1', versions: [] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['health'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode-versions'] })
  })
})
