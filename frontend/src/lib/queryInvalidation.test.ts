import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeWorkSessionsQueryKey,
  invalidateConfigCaches,
  invalidateProviderCaches,
  invalidateProviderCachesDebounced,
  invalidateQueryKeysDebounced,
  invalidateRepoGitCaches,
  invalidateRepoGitCachesDebounced,
  invalidateSessionListCachesDebounced,
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

describe('invalidateRepoGitCaches', () => {
  it('invalidates the shared stash list prefix across every repo when requested', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['gitStashes', 1], { stashes: [] })
    queryClient.setQueryData(['gitStashes', 2], { stashes: [] })

    invalidateRepoGitCaches(queryClient, 1, { invalidateStashes: true })

    expect(queryClient.getQueryState(['gitStashes', 1])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['gitStashes', 2])?.isInvalidated).toBe(true)
  })

  it('invalidates the repo list status for the repo when requested', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateRepoGitCaches(queryClient, 1, { invalidateRepoListStatus: true })

    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['reposGitStatus'], predicate: expect.any(Function) }),
    )
  })

  it('invalidates every sibling cache so branches resolved from siblings refresh', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['repo', 'siblings', 1], [])
    queryClient.setQueryData(['repo', 'siblings', 2], [])

    invalidateRepoGitCaches(queryClient, 1)

    expect(queryClient.getQueryState(['repo', 'siblings', 1])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['repo', 'siblings', 2])?.isInvalidated).toBe(true)
  })

  it('keeps the sibling caches when repo metadata invalidation is skipped', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['repo', 'siblings', 1], [])

    invalidateRepoGitCaches(queryClient, 1, { invalidateRepoMeta: false })

    expect(queryClient.getQueryState(['repo', 'siblings', 1])?.isInvalidated).toBe(false)
  })
})

describe('invalidateRepoGitCachesDebounced', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes the batched repo list status that holds the branch after the debounce window', () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    queryClient.setQueryData(['reposGitStatus', [1, 2]], new Map())
    queryClient.setQueryData(['reposGitStatus', [3]], new Map())

    invalidateRepoGitCachesDebounced(queryClient, 1)
    vi.advanceTimersByTime(200)

    expect(queryClient.getQueryState(['reposGitStatus', [1, 2]])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['reposGitStatus', [3]])?.isInvalidated).toBe(false)
  })
})

describe('invalidateProviderCaches', () => {
  it('invalidates only the provider query keys that have active queries', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateProviderCaches(queryClient)

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['provider-credentials'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['provider-auth-methods'] })
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

    expect(invalidateQueries).toHaveBeenCalledTimes(3)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'providers'] })
  })
})

describe('invalidateSessionListCachesDebounced', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const sessionListKey = (directoryKey: string) => ['opencode', 'sessions', directoryKey]

  it('invalidates only the session lists that include the event directory', () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    queryClient.setQueryData(sessionListKey('/a'), { pages: [], pageParams: [] })
    queryClient.setQueryData(sessionListKey('/b'), { pages: [], pageParams: [] })

    invalidateSessionListCachesDebounced(queryClient, '/a')
    vi.advanceTimersByTime(200)

    expect(queryClient.getQueryState(sessionListKey('/a'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(sessionListKey('/b'))?.isInvalidated).toBe(false)
  })

  it('merges directories reported within the debounce window into one flush', () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    queryClient.setQueryData(sessionListKey('/a|/b'), { pages: [], pageParams: [] })
    queryClient.setQueryData(sessionListKey('/c'), { pages: [], pageParams: [] })

    invalidateSessionListCachesDebounced(queryClient, '/a')
    invalidateSessionListCachesDebounced(queryClient, '/b')
    vi.advanceTimersByTime(200)

    expect(queryClient.getQueryState(sessionListKey('/a|/b'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(sessionListKey('/c'))?.isInvalidated).toBe(false)
  })

  it('invalidates every session list when called without a directory', () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    queryClient.setQueryData(sessionListKey('/a'), { pages: [], pageParams: [] })
    queryClient.setQueryData(sessionListKey('/b'), { pages: [], pageParams: [] })

    invalidateSessionListCachesDebounced(queryClient)
    vi.advanceTimersByTime(200)

    expect(queryClient.getQueryState(sessionListKey('/a'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(sessionListKey('/b'))?.isInvalidated).toBe(true)
  })

  it('keeps a remote event directory from invalidating the local list with the same path', () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const remoteListKey = ['opencode', 'sessions', '/repo', { allDirectories: true }, 'srv_a']
    queryClient.setQueryData(sessionListKey('/repo'), { pages: [], pageParams: [] })
    queryClient.setQueryData(remoteListKey, { pages: [], pageParams: [] })

    invalidateSessionListCachesDebounced(queryClient, '/repo', 'srv_a')
    vi.advanceTimersByTime(200)

    expect(queryClient.getQueryState(remoteListKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(sessionListKey('/repo'))?.isInvalidated).toBe(false)
  })

  it('invalidates the active-work list of the event server only', () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const localActiveWorkKey = activeWorkSessionsQueryKey('local')
    const remoteActiveWorkKey = activeWorkSessionsQueryKey('srv_a')
    queryClient.setQueryData(localActiveWorkKey, [])
    queryClient.setQueryData(remoteActiveWorkKey, [])

    invalidateSessionListCachesDebounced(queryClient, '/repo', 'srv_a')
    vi.advanceTimersByTime(200)

    expect(queryClient.getQueryState(remoteActiveWorkKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(localActiveWorkKey)?.isInvalidated).toBe(false)
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
