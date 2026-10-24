import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, dehydrate, hydrate, type Query } from '@tanstack/react-query'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import { SESSION_PINS_QUERY_KEY } from '@/hooks/useSessionPins'
import {
  PERSISTED_CACHE_MAX_AGE_MS,
  PERSISTED_QUERY_RULES,
  QUERY_CACHE_STORAGE_KEY,
  applyPersistedQueryDefaults,
  capInfiniteQueryPages,
  clearPersistedQueryCache,
  createDropOldestHalfRetryer,
  createQueryCachePersister,
  isPersistedQueryKey,
  queryCacheBuster,
  serializePersistedClient,
  shouldPersistQuery,
} from './queryPersistence'

type DehydratedQuery = PersistedClient['clientState']['queries'][number]

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

function buildPersistedClient(clientState: PersistedClient['clientState']): PersistedClient {
  return { buster: 'http://localhost|user-1', timestamp: Date.now(), clientState }
}

function buildDehydratedQuery(
  queryKey: readonly unknown[],
  dataUpdatedAt: number,
): DehydratedQuery {
  return {
    queryHash: JSON.stringify(queryKey),
    queryKey,
    state: { status: 'success', data: { id: queryKey[0] }, dataUpdatedAt } as DehydratedQuery['state'],
  }
}

const clients: QueryClient[] = []

function createClient(): QueryClient {
  const client = new QueryClient()
  clients.push(client)
  return client
}

async function persistAndRestore(client: QueryClient, storage: ReturnType<typeof createStorage>['storage']) {
  vi.useFakeTimers()
  const persister = createQueryCachePersister(storage)
  void persister.persistClient(buildPersistedClient(dehydrate(client)))
  await vi.advanceTimersByTimeAsync(1000)
  vi.useRealTimers()

  const restoredClient = createClient()
  const persisted = await persister.restoreClient()
  if (persisted) hydrate(restoredClient, persisted.clientState)
  return restoredClient
}

afterEach(() => {
  vi.useRealTimers()
  for (const client of clients.splice(0)) client.clear()
})

describe('isPersistedQueryKey', () => {
  it.each([
    ['repo list', ['repos']],
    ['session pins', ['session-pins']],
    ['linked servers', ['opencode-servers']],
    ['session list', ['opencode', 'sessions', '/work/repo', { search: '' }]],
    ['session search', ['opencode', 'sessions', '/work/repo', { search: 'fix login' }]],
    ['single session', ['opencode', 'session', 'ses_1', '/work/repo']],
    ['active work', ['opencode', 'active-work-sessions', 'srv_remote']],
    ['remote projects', ['opencode', 'projects', 'srv_remote']],
    ['vcs info', ['opencode', 'vcs', '/work/repo', 'srv_remote', 'info']],
  ])('allows the %s key', (_label, queryKey) => {
    expect(isPersistedQueryKey(queryKey)).toBe(true)
  })

  it.each([
    ['repo git status', ['reposGitStatus', [1, 2]]],
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

  it('persists only the unfiltered session list', () => {
    const queryClient = createClient()
    const listKey = ['opencode', 'sessions', '/work/repo', { search: '', limit: 25 }]

    expect(shouldPersistQuery(buildQuery(queryClient, listKey))).toBe(true)
    expect(
      shouldPersistQuery(buildQuery(queryClient, ['opencode', 'sessions', '/work/repo', { search: 'login' }])),
    ).toBe(false)
    expect(
      shouldPersistQuery(buildQuery(queryClient, ['opencode', 'sessions', '/work/repo', { search: '  ' }])),
    ).toBe(true)
  })
})

describe('PERSISTED_QUERY_RULES', () => {
  it('covers exactly the list and roster roots', () => {
    expect(PERSISTED_QUERY_RULES.map((rule) => rule.prefix)).toEqual([
      ['repos'],
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
      'reposGitStatus',
      'opencode.transcript',
      'opencode.providers',
      'opencode.config',
    ]

    for (const root of excluded) expect(roots).not.toContain(root)
  })

  it('builds the session-pin and active-work rules from the shared keys', () => {
    expect(PERSISTED_QUERY_RULES.map((rule) => rule.prefix)).toContainEqual([...SESSION_PINS_QUERY_KEY])
    expect(PERSISTED_QUERY_RULES.map((rule) => rule.prefix)).toContainEqual([
      'opencode',
      'active-work-sessions',
    ])
  })

  it('marks the rules that cannot use a prefix gcTime default', () => {
    const rulesWithoutPrefixDefault = PERSISTED_QUERY_RULES.filter(
      (rule) => rule.lastSegment !== undefined || rule.gcTimeInQueryOptions,
    )

    expect(rulesWithoutPrefixDefault.map((rule) => rule.prefix)).toEqual([
      ['opencode', 'sessions'],
      ['opencode', 'vcs'],
    ])
  })
})

describe('queryCacheBuster', () => {
  it('scopes the buster to the origin and the user id', () => {
    expect(queryCacheBuster('user-1')).toBe('http://localhost|user-1')
    expect(queryCacheBuster('user-2')).not.toBe(queryCacheBuster('user-1'))
  })
})

const allowlistedFixtures = [
  {
    label: 'repo list',
    queryKey: ['repos'],
    data: [
      {
        id: 1,
        name: 'app',
        localPath: '/work/app',
        fullPath: '/work/app',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: 1_700_000_000_000,
        lastAccessedAt: 1_700_000_100_000,
        isLocal: true,
      },
    ],
  },
  {
    label: 'session pins',
    queryKey: [...SESSION_PINS_QUERY_KEY],
    data: [{ sessionId: 'ses_1', directory: '/work/repo', pinnedAt: 1_700_000_000_000 }],
  },
  {
    label: 'linked servers',
    queryKey: ['opencode-servers'],
    data: [
      {
        id: 'srv_kitchen',
        name: 'Kitchen',
        baseUrl: 'https://kitchen.example.com',
        username: 'opencode',
        enabled: true,
        hasPassword: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  },
  {
    label: 'session list',
    queryKey: ['opencode', 'sessions', '/work/repo', { search: '', limit: 25 }],
    data: {
      pages: [
        {
          items: [
            {
              id: 'ses_1',
              projectID: 'prj_1',
              title: 'Fix login',
              time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
              location: { directory: '/work/repo' },
              cost: 0.02,
              tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
            },
          ],
          nextParam: { mode: 'all', cursor: 'cursor-1' },
        },
      ],
      pageParams: [null],
    },
  },
  {
    label: 'single session',
    queryKey: ['opencode', 'session', 'ses_1', '/work/repo'],
    data: {
      id: 'ses_1',
      projectID: 'prj_1',
      title: 'Fix login',
      time: { created: 1_700_000_000_000, updated: 1_700_000_100_000, archived: 1_700_000_200_000 },
      location: { directory: '/work/repo' },
      cost: 0.02,
      tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
    },
  },
  {
    label: 'active work',
    queryKey: ['opencode', 'active-work-sessions', 'srv_kitchen'],
    data: [
      {
        id: 'ses_2',
        projectID: 'prj_1',
        title: 'Review diff',
        time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
        location: { directory: '/work/repo' },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ],
  },
  {
    label: 'remote projects',
    queryKey: ['opencode', 'projects', 'srv_kitchen'],
    data: [
      {
        id: 'prj_1',
        name: 'app',
        canonical: '/work/app',
        vcs: 'git',
        time: { created: 1_700_000_000_000, updated: 1_700_000_100_000, active: 1_700_000_200_000 },
        sandboxes: [{ id: 'sbx_1', directory: '/work/app', created: 1_700_000_000_000 }],
      },
    ],
  },
  {
    label: 'vcs info',
    queryKey: ['opencode', 'vcs', '/work/app', 'srv_kitchen', 'info'],
    data: { branch: 'main', default_branch: 'main', root: '/work/app' },
  },
] as const

describe('persisted query round trip', () => {
  it.each(allowlistedFixtures)('restores the $label data unchanged', async ({ queryKey, data }) => {
    const sourceClient = createClient()
    sourceClient.setQueryData(queryKey, data)
    const { storage } = createStorage()

    const restoredClient = await persistAndRestore(sourceClient, storage)

    expect(restoredClient.getQueryData(queryKey)).toEqual(data)
  })

  it('loses repository git status data, which is why it is not allowlisted', async () => {
    const sourceClient = createClient()
    sourceClient.setQueryData(['reposGitStatus', [1]], new Map([[1, { hasChanges: true }]]))
    const { storage } = createStorage()

    const restoredClient = await persistAndRestore(sourceClient, storage)

    expect(restoredClient.getQueryData(['reposGitStatus', [1]])).toEqual({})
  })
})

describe('capInfiniteQueryPages', () => {
  it('keeps only the first page and its page param of every infinite query', () => {
    const clientState = {
      mutations: [],
      queries: [
        buildDehydratedQuery(['repos'], 1),
        {
          ...buildDehydratedQuery(['opencode', 'sessions', '/work/repo'], 2),
          state: {
            status: 'success',
            dataUpdatedAt: 2,
            data: { pages: [{ items: ['a'] }, { items: ['b'] }, { items: ['c'] }], pageParams: [undefined, 'c2', 'c3'] },
          } as DehydratedQuery['state'],
        },
      ],
    }

    const capped = capInfiniteQueryPages(clientState)

    expect(capped.queries[0].state.data).toEqual({ id: 'repos' })
    expect(capped.queries[1].state.data).toEqual({
      pages: [{ items: ['a'] }],
      pageParams: [undefined],
    })
    expect(clientState.queries[1].state.data).toMatchObject({
      pages: [{ items: ['a'] }, { items: ['b'] }, { items: ['c'] }],
    })
  })

  it('caps the infinite query before the persister writes it', async () => {
    const sourceClient = createClient()
    sourceClient.setQueryData(['opencode', 'sessions', '/work/repo', { search: '' }], {
      pages: [{ items: ['a'] }, { items: ['b'] }],
      pageParams: [undefined, 'c2'],
    })
    const { storage, store } = createStorage()

    const restoredClient = await persistAndRestore(sourceClient, storage)

    const stored = JSON.parse(store.get(QUERY_CACHE_STORAGE_KEY) ?? '{}')
    expect(stored.clientState.queries[0].state.data).toEqual({
      pages: [{ items: ['a'] }],
      pageParams: [null],
    })
    expect(restoredClient.getQueryData(['opencode', 'sessions', '/work/repo', { search: '' }])).toEqual({
      pages: [{ items: ['a'] }],
      pageParams: [null],
    })
  })

  it('leaves plain list data alone', () => {
    const clientState = { mutations: [], queries: [buildDehydratedQuery(['repos'], 1)] }

    expect(serializePersistedClient(buildPersistedClient(clientState))).toBe(
      JSON.stringify(buildPersistedClient(clientState)),
    )
  })
})

describe('createDropOldestHalfRetryer', () => {
  it('drops the oldest half of the queries on the first pass', () => {
    const retryer = createDropOldestHalfRetryer()
    const queries = [4, 1, 3, 2].map((age) => buildDehydratedQuery([`query-${age}`], age))

    const retried = retryer({
      persistedClient: buildPersistedClient({ mutations: [], queries }),
      error: new Error('QuotaExceededError'),
      errorCount: 1,
    })

    expect(retried?.clientState.queries.map((query) => query.state.dataUpdatedAt)).toEqual([4, 3])
  })

  it('keeps halving the remaining queries on later passes of the same save', () => {
    const retryer = createDropOldestHalfRetryer()
    const queries = [1, 2, 3, 4].map((age) => buildDehydratedQuery([`query-${age}`], age))
    const props = {
      persistedClient: buildPersistedClient({ mutations: [], queries }),
      error: new Error('QuotaExceededError'),
      errorCount: 1,
    }

    const first = retryer(props)
    const second = retryer({ ...props, persistedClient: first!, errorCount: 2 })
    const third = retryer({ ...props, persistedClient: second!, errorCount: 3 })

    expect(first?.clientState.queries.map((query) => query.state.dataUpdatedAt)).toEqual([3, 4])
    expect(second?.clientState.queries.map((query) => query.state.dataUpdatedAt)).toEqual([4])
    expect(third?.clientState.queries).toEqual([])
  })

  it('sorts once per save and starts over for the next save', () => {
    const retryer = createDropOldestHalfRetryer()
    retryer({
      persistedClient: buildPersistedClient({ mutations: [], queries: [buildDehydratedQuery(['a'], 5)] }),
      error: new Error('QuotaExceededError'),
      errorCount: 1,
    })

    const nextSave = [buildDehydratedQuery(['b'], 9), buildDehydratedQuery(['c'], 1)]

    const retried = retryer({
      persistedClient: buildPersistedClient({ mutations: [], queries: nextSave }),
      error: new Error('QuotaExceededError'),
      errorCount: 1,
    })

    expect(retried?.clientState.queries.map((query) => query.queryKey)).toEqual([['b']])
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

  it('still writes after dropping the oldest half when the quota rejects a save', async () => {
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
  it('raises gcTime only for the allowlisted rules that use a prefix default', () => {
    const queryClient = createClient()
    applyPersistedQueryDefaults(queryClient)

    for (const rule of PERSISTED_QUERY_RULES) {
      const gcTime = queryClient.getQueryDefaults(rule.prefix).gcTime
      const usesPrefixDefault = rule.lastSegment === undefined && !rule.gcTimeInQueryOptions
      expect(gcTime).toBe(usesPrefixDefault ? PERSISTED_CACHE_MAX_AGE_MS : undefined)
    }

    expect(queryClient.getQueryDefaults(['settings', 'user-1']).gcTime).toBeUndefined()
    expect(queryClient.getQueryDefaults(['opencode', 'transcript', 'ses_1']).gcTime).toBeUndefined()
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBeUndefined()
    expect(PERSISTED_CACHE_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('leaves the paged session list and vcs info to their own query options', () => {
    const queryClient = createClient()
    applyPersistedQueryDefaults(queryClient)

    expect(queryClient.getQueryDefaults(['opencode', 'sessions']).gcTime).toBeUndefined()
    expect(queryClient.getQueryDefaults(['opencode', 'vcs']).gcTime).toBeUndefined()
    expect(queryClient.defaultQueryOptions({ queryKey: ['opencode', 'sessions', '/work/repo'] }).gcTime)
      .toBeUndefined()
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
