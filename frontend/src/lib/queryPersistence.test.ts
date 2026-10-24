import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, type Query } from '@tanstack/react-query'
import {
  PERSISTED_CACHE_MAX_AGE_MS,
  PERSISTED_QUERY_RULES,
  QUERY_CACHE_STORAGE_KEY,
  applyPersistedQueryDefaults,
  clearPersistedQueryCache,
  createQueryCachePersister,
  isPersistedQueryKey,
  queryCacheBuster,
  shouldPersistQuery,
} from './queryPersistence'

function buildQuery(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  status: 'pending' | 'success' | 'error' = 'success',
): Query {
  const query = queryClient
    .getQueryCache()
    .build<unknown, Error, unknown, readonly unknown[]>(queryClient, {
      queryKey,
      queryFn: async () => null,
    })

  if (status === 'success') {
    query.setState({ status: 'success', data: { ok: true }, fetchStatus: 'idle' })
  } else if (status === 'error') {
    query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' })
  }

  return query
}

function createStorage() {
  const store = new Map<string, string>()
  return {
    store,
    storage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    },
  }
}

const clients: QueryClient[] = []

function createClient(): QueryClient {
  const client = new QueryClient()
  clients.push(client)
  return client
}

afterEach(() => {
  vi.useRealTimers()
  for (const client of clients.splice(0)) client.clear()
})

describe('isPersistedQueryKey', () => {
  it.each([
    ['repo list', ['repos']],
    ['repo git status', ['reposGitStatus', [1, 2]]],
    ['session pins', ['session-pins']],
    ['linked servers', ['opencode-servers']],
    ['session list', ['opencode', 'sessions', '/work/repo', { search: '' }]],
    ['single session', ['opencode', 'session', 'ses_1', '/work/repo']],
    ['active work', ['opencode', 'active-work-sessions', 'srv_remote']],
    ['remote projects', ['opencode', 'projects', 'srv_remote']],
    ['vcs info', ['opencode', 'vcs', '/work/repo', 'srv_remote', 'info']],
  ])('allows the %s key', (_label, queryKey) => {
    expect(isPersistedQueryKey(queryKey)).toBe(true)
  })

  it.each([
    ['settings', ['settings', 'user-1']],
    ['provider credentials', ['provider-credentials']],
    ['provider auth methods', ['provider-auth-methods']],
    ['passkeys', ['passkeys']],
    ['schedules', ['schedules', '/work/repo']],
    ['all schedules', ['all-schedules']],
    ['repo schedules', ['repo-schedules', 1]],
    ['transcript', ['opencode', 'transcript', 'ses_1']],
    ['providers', ['opencode', 'providers', '/work/repo']],
    ['commands', ['opencode', 'commands', '/work/repo']],
    ['agents', ['opencode', 'agents', '/work/repo']],
    ['config', ['opencode', 'config', 'model', '/work/repo']],
    ['pending actions', ['opencode', 'pending-actions', 'ses_1', '/work/repo']],
    ['shells', ['opencode', 'shells', '/work/repo']],
    ['session reconciliation', ['opencode', 'session-reconcile', 'ses_1']],
    ['vcs status', ['opencode', 'vcs', '/work/repo', 'status']],
    ['vcs diff', ['opencode', 'vcs', '/work/repo', 'diff', 'branch']],
    ['repo detail', ['repo', 1]],
    ['server health', ['health']],
  ])('rejects the %s key', (_label, queryKey) => {
    expect(isPersistedQueryKey(queryKey)).toBe(false)
  })

  it('rejects an empty or non-string key', () => {
    expect(isPersistedQueryKey([])).toBe(false)
    expect(isPersistedQueryKey([42])).toBe(false)
  })
})

describe('shouldPersistQuery', () => {
  it('persists a successful query under an allowlisted rule', () => {
    const queryClient = createClient()

    expect(shouldPersistQuery(buildQuery(queryClient, ['repos']))).toBe(true)
    expect(shouldPersistQuery(buildQuery(queryClient, ['opencode', 'sessions', '/work/repo']))).toBe(true)
  })

  it('rejects a non-success query even under an allowlisted rule', () => {
    const queryClient = createClient()

    expect(shouldPersistQuery(buildQuery(queryClient, ['repos'], 'pending'))).toBe(false)
    expect(shouldPersistQuery(buildQuery(queryClient, ['repos'], 'error'))).toBe(false)
  })

  it('rejects a successful query whose data root carries secrets', () => {
    const queryClient = createClient()

    expect(shouldPersistQuery(buildQuery(queryClient, ['settings', 'user-1']))).toBe(false)
    expect(shouldPersistQuery(buildQuery(queryClient, ['provider-credentials']))).toBe(false)
    expect(shouldPersistQuery(buildQuery(queryClient, ['passkeys']))).toBe(false)
  })
})

describe('PERSISTED_QUERY_RULES', () => {
  it('covers exactly the list and roster roots', () => {
    expect(PERSISTED_QUERY_RULES.map((rule) => rule.prefix)).toEqual([
      ['repos'],
      ['reposGitStatus'],
      ['session-pins'],
      ['opencode-servers'],
      ['opencode', 'sessions'],
      ['opencode', 'session'],
      ['opencode', 'active-work-sessions'],
      ['opencode', 'projects'],
      ['opencode', 'vcs'],
    ])
  })

  it('never names a secret-bearing or transcript root', () => {
    const roots = PERSISTED_QUERY_RULES.map((rule) => rule.prefix.join('.'))
    const excluded = [
      'settings',
      'provider-credentials',
      'provider-auth-methods',
      'passkeys',
      'schedules',
      'all-schedules',
      'opencode.transcript',
      'opencode.providers',
      'opencode.config',
    ]

    for (const root of excluded) expect(roots).not.toContain(root)
  })
})

describe('queryCacheBuster', () => {
  it('scopes the buster to the origin and the user id', () => {
    expect(queryCacheBuster('user-1')).toBe('http://localhost|user-1')
    expect(queryCacheBuster('user-2')).not.toBe(queryCacheBuster('user-1'))
  })
})

describe('createQueryCachePersister', () => {
  it('writes the dehydrated cache under the fixed storage key after the throttle', async () => {
    vi.useFakeTimers()
    const { store, storage } = createStorage()
    const persister = createQueryCachePersister(storage)

    void persister.persistClient({
      buster: 'http://localhost|user-1',
      timestamp: Date.now(),
      clientState: { mutations: [], queries: [] },
    })
    await vi.advanceTimersByTimeAsync(1000)

    expect([...store.keys()]).toEqual([QUERY_CACHE_STORAGE_KEY])
    expect(JSON.parse(store.get(QUERY_CACHE_STORAGE_KEY) ?? '')).toMatchObject({
      buster: 'http://localhost|user-1',
      clientState: { queries: [] },
    })
  })

  it('still writes after dropping the oldest query when the quota rejects a save', async () => {
    vi.useFakeTimers()
    const { store, storage } = createStorage()
    let rejections = 1
    const persister = createQueryCachePersister({
      ...storage,
      setItem: (key: string, value: string) => {
        if (rejections > 0) {
          rejections -= 1
          throw new Error('QuotaExceededError')
        }
        store.set(key, value)
      },
    })

    void persister.persistClient({
      buster: 'http://localhost|user-1',
      timestamp: Date.now(),
      clientState: {
        mutations: [],
        queries: [{ queryKey: ['repos'], state: { data: [], dataUpdatedAt: 1 } } as never],
      },
    })
    await vi.advanceTimersByTimeAsync(1000)

    expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(true)
  })
})

describe('applyPersistedQueryDefaults', () => {
  it('raises gcTime for every allowlisted rule only', () => {
    const queryClient = createClient()
    applyPersistedQueryDefaults(queryClient)

    for (const rule of PERSISTED_QUERY_RULES) {
      expect(queryClient.getQueryDefaults(rule.prefix).gcTime).toBe(PERSISTED_CACHE_MAX_AGE_MS)
    }

    expect(queryClient.getQueryDefaults(['settings', 'user-1']).gcTime).toBeUndefined()
    expect(queryClient.getQueryDefaults(['opencode', 'transcript', 'ses_1']).gcTime).toBeUndefined()
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBeUndefined()
    expect(PERSISTED_CACHE_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('clearPersistedQueryCache', () => {
  it('removes only the persisted cache key', () => {
    const { store, storage } = createStorage()
    store.set(QUERY_CACHE_STORAGE_KEY, '{}')
    store.set('ocm.auth.user', '{}')

    clearPersistedQueryCache(storage)

    expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(false)
    expect(store.has('ocm.auth.user')).toBe(true)
  })
})
