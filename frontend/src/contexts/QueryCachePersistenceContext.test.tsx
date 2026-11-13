import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { QueryClient, QueryClientProvider, dehydrate, useIsRestoring } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { MemoryRouter } from 'react-router-dom'
import { parseJsonText, type JsonValue } from '@opencode-manager/shared/utils'
import { createFetchFake, type FetchRouteResult } from '@/test/fetchFake'
import { makeAuthConfig, makeAuthSession, type AuthSessionFixture } from '@/test/fixtures/api'
import { AuthProvider } from './AuthContext'
import { QueryCachePersistenceProvider } from './QueryCachePersistenceContext'
import { authClient } from '@/lib/auth-client'
import {
  QUERY_CACHE_STORAGE_KEY,
  queryCacheBuster,
  type QueryCachePersister,
} from '@/lib/queryPersistence'

type FixtureUser = AuthSessionFixture['user']

const USER_ONE: FixtureUser = { id: 'user-1', email: 'user-1@example.com', name: 'user-1' }
const USER_TWO: FixtureUser = { id: 'user-2', email: 'user-2@example.com', name: 'user-2' }

interface SessionState {
  user: FixtureUser | null
  pending: boolean
}

const persistedClientSchema = z.object({
  buster: z.string(),
  clientState: z.object({
    queries: z.array(z.object({ queryKey: z.array(z.unknown()) })),
  }),
})

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
  data: JsonValue = [{ id: 1 }],
): void {
  const seedClient = new QueryClient()
  seedClient.setQueryData(queryKey, data)
  storage.setItem(
    QUERY_CACHE_STORAGE_KEY,
    JSON.stringify({ buster, timestamp: Date.now(), clientState: dehydrate(seedClient) }),
  )
  seedClient.clear()
}

function installAuthRoutes(state: SessionState): void {
  const fetchFake = createFetchFake([
    {
      method: 'GET',
      path: '/api/auth/get-session',
      respond: (): FetchRouteResult | Promise<FetchRouteResult> => {
        if (state.pending) return new Promise<FetchRouteResult>(() => undefined)
        return { json: state.user ? makeAuthSession({ user: state.user }) : null }
      },
    },
    { method: 'GET', path: '/api/auth-info/config', respond: () => ({ json: makeAuthConfig() }) },
    { method: 'POST', path: '/api/auth/sign-out', respond: () => {
      state.user = null
      return { json: {} }
    } },
  ])
  fetchFake.install()
}

function resetSessionAtom(): void {
  const atom = authClient.$store.atoms.session
  atom.set({ ...atom.get(), data: null, error: null, isPending: true, isRefetching: false })
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

function tree(persister: QueryCachePersister, client: QueryClient, persistThrottleMs = 0) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <QueryCachePersistenceProvider persister={persister} persistThrottleMs={persistThrottleMs}>
            <RestoringProbe />
          </QueryCachePersistenceProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

async function signOutThroughProvider(): Promise<void> {
  await act(async () => {
    await authClient.signOut()
    authClient.$store.notify('$sessionSignal')
  })
}

beforeEach(() => {
  restoringValue = undefined
  restoringHistory = []
  localStorage.clear()
  resetSessionAtom()
  authClient.$store.notify('$sessionSignal')
})

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
})

describe('QueryCachePersistenceProvider', () => {
  it('restores the cache written for the current user', async () => {
    installAuthRoutes({ user: USER_ONE, pending: false })
    const { store, storage } = createStorage()
    seed(storage, queryCacheBuster('user-1'))
    const client = createClient()

    render(tree(createTestPersister(storage), client))

    await waitFor(() => expect(client.getQueryData(['repos'])).toEqual([{ id: 1 }]))
    await waitFor(() => expect(restoringValue).toBe(false))
    expect(store.size).toBe(1)
  })

  it('discards a cache written for another user', async () => {
    installAuthRoutes({ user: USER_ONE, pending: false })
    const { store, storage } = createStorage()
    seed(storage, queryCacheBuster('user-2'))
    const client = createClient()

    render(tree(createTestPersister(storage), client))

    await waitFor(() => expect(restoringValue).toBe(false))
    expect(client.getQueryData(['repos'])).toBeUndefined()
    expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(false)
  })

  it('keeps the stored cache while the session is still loading', async () => {
    installAuthRoutes({ user: null, pending: true })
    const { store, storage } = createStorage()
    seed(storage, queryCacheBuster('user-1'))
    const client = createClient()

    render(tree(createTestPersister(storage), client))
    await settle()

    expect(client.getQueryData(['repos'])).toBeUndefined()
    expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(true)
    expect(restoringValue).toBe(false)
  })

  it('persists allowlisted successful queries only', async () => {
    installAuthRoutes({ user: USER_ONE, pending: false })
    const { store, storage } = createStorage()
    const client = createClient()

    render(tree(createTestPersister(storage), client))
    await waitFor(() => expect(restoringValue).toBe(false))

    act(() => {
      client.setQueryData(['repos'], [{ id: 1 }])
      client.setQueryData(['opencode', 'sessions', '/work/repo'], [{ id: 'ses_1' }])
      client.setQueryData(['settings', 'user-1'], { opencodeServerAuth: 'secret' })
      client.setQueryData(['opencode', 'transcript', 'ses_1'], [{ text: 'streamed' }])
      client.setQueryData(['provider-integrations'], [{ apiKey: 'secret' }])
    })
    await settle()

    const persisted = persistedClientSchema.parse(parseJsonText(store.get(QUERY_CACHE_STORAGE_KEY) ?? '{}'))
    const roots = persisted.clientState.queries.map((query) => query.queryKey[0])

    expect(persisted.buster).toBe(queryCacheBuster('user-1'))
    expect(roots.sort()).toEqual(['opencode', 'repos'])
    expect(store.get(QUERY_CACHE_STORAGE_KEY)).not.toContain('secret')
    expect(store.get(QUERY_CACHE_STORAGE_KEY)).not.toContain('streamed')
  })

  it('is restoring until the restore resolves', async () => {
    installAuthRoutes({ user: USER_ONE, pending: false })
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

    render(tree(persister, createClient()))
    await waitFor(() => expect(restoringValue).toBe(true))

    act(() => resolveRestore())
    await waitFor(() => expect(restoringValue).toBe(false))
  })

  it('clears the persisted cache and the in-memory cache on sign-out', async () => {
    installAuthRoutes({ user: USER_ONE, pending: false })
    const { store, storage } = createStorage()
    seed(storage, queryCacheBuster('user-1'))
    const persister = createTestPersister(storage)
    const client = createClient()

    render(tree(persister, client))
    await waitFor(() => expect(client.getQueryData(['repos'])).toEqual([{ id: 1 }]))

    await signOutThroughProvider()

    await waitFor(() => expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(false))
    expect(client.getQueryData(['repos'])).toBeUndefined()
  })

  it('clears the in-memory cache when the validated user changes', async () => {
    const session: SessionState = { user: USER_ONE, pending: false }
    installAuthRoutes(session)
    const { store, storage } = createStorage()
    seed(storage, queryCacheBuster('user-1'))
    const persister = createTestPersister(storage)
    const client = createClient()

    render(tree(persister, client))
    await waitFor(() => expect(client.getQueryData(['repos'])).toEqual([{ id: 1 }]))

    session.user = USER_TWO
    act(() => {
      authClient.$store.notify('$sessionSignal')
    })

    await waitFor(() => expect(client.getQueryData(['repos'])).toBeUndefined())
    await waitFor(() => expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(false))
    await waitFor(() => expect(restoringValue).toBe(false))
  })

  it('subscribes without a restoring pass when nothing is persisted yet', async () => {
    installAuthRoutes({ user: USER_ONE, pending: false })
    const { store, storage } = createStorage()
    const client = createClient()
    const persister = createTestPersister(storage)

    render(tree(persister, client))

    expect(restoringHistory).not.toContain(true)

    await waitFor(() => {
      act(() => {
        client.setQueryData(['repos'], [{ id: 1 }])
      })
      expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(true)
    })
    expect(restoringHistory).not.toContain(true)
  })

  it('saves an allowlisted update but not a transcript update', async () => {
    installAuthRoutes({ user: USER_ONE, pending: false })
    const client = createClient()
    const persistClient = vi.fn<QueryCachePersister['persistClient']>()
    const persister: QueryCachePersister = {
      persistClient,
      restoreClient: () => undefined,
      removeClient: vi.fn(),
      hasPersistedClient: () => false,
    }

    render(tree(persister, client))

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
    expect(persisted.clientState.queries.map((query) => query.queryKey)).toEqual([['repos']])
  })

  it('drops a save scheduled before sign-out instead of rewriting the cache', async () => {
    installAuthRoutes({ user: USER_ONE, pending: false })
    const { store, storage } = createStorage()
    const client = createClient()
    const persister = createTestPersister(storage)

    render(tree(persister, client, 20))
    act(() => {
      client.setQueryData(['repos'], [{ id: 1 }])
    })

    await signOutThroughProvider()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(false)
    expect(client.getQueryData(['repos'])).toBeUndefined()
  })
})
