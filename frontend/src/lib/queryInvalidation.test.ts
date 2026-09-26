import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  invalidateConfigCaches,
  invalidateProviderCaches,
  invalidateProviderCachesDebounced,
  invalidateQueryKeysDebounced,
  refreshOpenCodeServerCaches,
} from './queryInvalidation'

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

describe('invalidateConfigCaches', () => {
  it('invalidates the OpenCode config file cache by default', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateConfigCaches(queryClient)

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode-config'] })
  })

  it('skips the OpenCode config file cache while still invalidating dependents', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateConfigCaches(queryClient, { skipOpenCodeConfig: true })

    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['opencode-config'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'config'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['health'] })
  })
})

describe('invalidateProviderCaches', () => {
  it('invalidates only the provider query keys that have active queries', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateProviderCaches(queryClient)

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['provider-credentials'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['provider-auth-methods'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['providers-with-models'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'providers'] })
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['providers'] })
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['providers-for-execution-model'] })
  })
})

describe('invalidateProviderCachesDebounced', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('collapses a burst of provider events into one flush', () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    for (let i = 0; i < 6; i += 1) {
      invalidateProviderCachesDebounced(queryClient)
    }

    expect(invalidateQueries).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)

    expect(invalidateQueries).toHaveBeenCalledTimes(4)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'providers'] })
  })
})

describe('invalidateQueryKeysDebounced', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('invalidates each key group once after the debounce window', () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateQueryKeysDebounced(queryClient, [['opencode', 'config'], ['opencode-config']])
    invalidateQueryKeysDebounced(queryClient, [['opencode', 'config'], ['opencode-config']])

    expect(invalidateQueries).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)

    expect(invalidateQueries).toHaveBeenCalledTimes(2)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'config'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode-config'] })
  })
})
