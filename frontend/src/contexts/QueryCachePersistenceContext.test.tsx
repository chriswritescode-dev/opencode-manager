import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider, dehydrate, useIsRestoring } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { QueryCachePersistenceProvider } from './QueryCachePersistenceContext'
import {
  QUERY_CACHE_STORAGE_KEY,
  queryCacheBuster,
  type QueryCachePersister,
} from '@/lib/queryPersistence'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: mocks.useAuth }))

interface AuthStub {
  user: { id: string; email: string; name: string } | null
  isAuthenticated: boolean
  isLoading: boolean
}

function signedIn(userId = 'user-1'): AuthStub {
  return {
    user: { id: userId, email: `${userId}@example.com`, name: userId },
    isAuthenticated: true,
    isLoading: false,
  }
}

function signedOut(): AuthStub {
  return { user: null, isAuthenticated: false, isLoading: false }
}

function loading(): AuthStub {
  return { user: null, isAuthenticated: false, isLoading: true }
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

type TestStorage = ReturnType<typeof createStorage>['storage']

function createTestPersister(storage: TestStorage, throttleTime = 0): QueryCachePersister {
  const persister = createSyncStoragePersister({
    storage,
    key: QUERY_CACHE_STORAGE_KEY,
    throttleTime,
  })
  return {
    ...persister,
    hasPersistedClient: () => storage.getItem(QUERY_CACHE_STORAGE_KEY) !== null,
  }
}

function seed(
  storage: TestStorage,
  buster: string,
  queryKey: readonly unknown[] = ['repos'],
  data: unknown = [{ id: 1 }],
): void {
  const seedClient = new QueryClient()
  seedClient.setQueryData(queryKey, data)
  storage.setItem(
    QUERY_CACHE_STORAGE_KEY,
    JSON.stringify({ buster, timestamp: Date.now(), clientState: dehydrate(seedClient) }),
  )
  seedClient.clear()
}

let restoringValue: boolean | undefined
let restoringHistory: boolean[] = []

function RestoringProbe() {
  const isRestoring = useIsRestoring()
  restoringValue = isRestoring
  restoringHistory.push(isRestoring)
  return null
}

const clients: QueryClient[] = []

function createClient(): QueryClient {
  const client = new QueryClient()
  clients.push(client)
  return client
}

function tree(
  auth: AuthStub,
  persister: QueryCachePersister,
  client: QueryClient,
  persistThrottleMs = 0,
) {
  mocks.useAuth.mockReturnValue(auth)
  return (
    <QueryClientProvider client={client}>
      <QueryCachePersistenceProvider persister={persister} persistThrottleMs={persistThrottleMs}>
        <RestoringProbe />
      </QueryCachePersistenceProvider>
    </QueryClientProvider>
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

beforeEach(() => {
  restoringValue = undefined
  restoringHistory = []
  mocks.useAuth.mockReset()
  localStorage.clear()
})

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
})

describe('QueryCachePersistenceProvider', () => {
  it('restores the cache written for the current user', async () => {
    const { store, storage } = createStorage()
    seed(storage, queryCacheBuster('user-1'))
    const client = createClient()

    render(tree(signedIn(), createTestPersister(storage), client))

    await waitFor(() => expect(client.getQueryData(['repos'])).toEqual([{ id: 1 }]))
    await waitFor(() => expect(restoringValue).toBe(false))
    expect(store.size).toBe(1)
  })

  it('discards a cache written for another user', async () => {
    const { store, storage } = createStorage()
    seed(storage, queryCacheBuster('user-2'))
    const client = createClient()

    render(tree(signedIn('user-1'), createTestPersister(storage), client))

    await waitFor(() => expect(restoringValue).toBe(false))
    expect(client.getQueryData(['repos'])).toBeUndefined()
    expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(false)
  })

  it('keeps the stored cache while the session is still loading', async () => {
    const { store, storage } = createStorage()
    seed(storage, queryCacheBuster('user-1'))
    const client = createClient()

    render(tree(loading(), createTestPersister(storage), client))
    await settle()

    expect(client.getQueryData(['repos'])).toBeUndefined()
    expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(true)
    expect(restoringValue).toBe(false)
  })

  it('persists allowlisted successful queries only', async () => {
    const { store, storage } = createStorage()
    const client = createClient()

    render(tree(signedIn(), createTestPersister(storage), client))
    await waitFor(() => expect(restoringValue).toBe(false))

    act(() => {
      client.setQueryData(['repos'], [{ id: 1 }])
      client.setQueryData(['opencode', 'sessions', '/work/repo'], [{ id: 'ses_1' }])
      client.setQueryData(['settings', 'user-1'], { opencodeServerAuth: 'secret' })
      client.setQueryData(['opencode', 'transcript', 'ses_1'], [{ text: 'streamed' }])
      client.setQueryData(['provider-credentials'], [{ apiKey: 'secret' }])
    })
    await settle()

    const persisted = JSON.parse(store.get(QUERY_CACHE_STORAGE_KEY) ?? '{}')
    const roots = persisted.clientState.queries.map((query: { queryKey: unknown[] }) => query.queryKey[0])

    expect(persisted.buster).toBe(queryCacheBuster('user-1'))
    expect(roots.sort()).toEqual(['opencode', 'repos'])
    expect(store.get(QUERY_CACHE_STORAGE_KEY)).not.toContain('secret')
    expect(store.get(QUERY_CACHE_STORAGE_KEY)).not.toContain('streamed')
  })

  it('is restoring until the restore resolves', async () => {
    let resolveRestore: () => void = () => {}
    const persister: QueryCachePersister = {
      persistClient: vi.fn(),
      restoreClient: vi.fn(
        () => new Promise<undefined>((resolve) => {
          resolveRestore = () => resolve(undefined)
        }),
      ),
      removeClient: vi.fn(),
      hasPersistedClient: () => true,
    }

    render(tree(signedIn(), persister, createClient()))
    expect(restoringValue).toBe(true)

    act(() => resolveRestore())
    await waitFor(() => expect(restoringValue).toBe(false))
  })

  it('clears the persisted cache and the in-memory cache on sign-out', async () => {
    const { store, storage } = createStorage()
    seed(storage, queryCacheBuster('user-1'))
    const persister = createTestPersister(storage)
    const client = createClient()

    const view = render(tree(signedIn(), persister, client))
    await waitFor(() => expect(client.getQueryData(['repos'])).toEqual([{ id: 1 }]))

    view.rerender(tree(signedOut(), persister, client))

    await waitFor(() => expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(false))
    expect(client.getQueryData(['repos'])).toBeUndefined()
  })

  it('clears the in-memory cache when the validated user changes', async () => {
    const { store, storage } = createStorage()
    seed(storage, queryCacheBuster('user-1'))
    const persister = createTestPersister(storage)
    const client = createClient()

    const view = render(tree(signedIn('user-1'), persister, client))
    await waitFor(() => expect(client.getQueryData(['repos'])).toEqual([{ id: 1 }]))

    view.rerender(tree(signedIn('user-2'), persister, client))

    await waitFor(() => expect(client.getQueryData(['repos'])).toBeUndefined())
    await waitFor(() => expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(false))
    await waitFor(() => expect(restoringValue).toBe(false))
  })

  it('subscribes without a restoring pass when nothing is persisted yet', async () => {
    const { store, storage } = createStorage()
    const client = createClient()
    const persister = createTestPersister(storage)

    render(tree(signedIn(), persister, client))

    expect(restoringHistory).not.toContain(true)

    act(() => {
      client.setQueryData(['repos'], [{ id: 1 }])
    })
    await settle()

    expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(true)
    expect(restoringHistory).not.toContain(true)
  })

  it('saves an allowlisted update but not a transcript update', async () => {
    const client = createClient()
    const persistClient = vi.fn()
    const persister: QueryCachePersister = {
      persistClient,
      restoreClient: () => undefined,
      removeClient: vi.fn(),
      hasPersistedClient: () => false,
    }

    render(tree(signedIn(), persister, client))

    act(() => {
      client.setQueryData(['opencode', 'transcript', 'ses_1'], [{ text: 'streamed' }])
    })
    await settle()
    expect(persistClient).not.toHaveBeenCalled()

    act(() => {
      client.setQueryData(['repos'], [{ id: 1 }])
    })
    await settle()

    expect(persistClient).toHaveBeenCalledTimes(1)
    const persisted = persistClient.mock.calls[0][0]
    expect(persisted.buster).toBe(queryCacheBuster('user-1'))
    expect(persisted.clientState.queries.map((query: { queryKey: unknown[] }) => query.queryKey)).toEqual([
      ['repos'],
    ])
  })

  it('drops a save scheduled before sign-out instead of rewriting the cache', async () => {
    const { store, storage } = createStorage()
    const client = createClient()
    const persister = createTestPersister(storage)

    const view = render(tree(signedIn(), persister, client, 20))
    act(() => {
      client.setQueryData(['repos'], [{ id: 1 }])
    })

    view.rerender(tree(signedOut(), persister, client, 20))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(false)
    expect(client.getQueryData(['repos'])).toBeUndefined()
  })
})
