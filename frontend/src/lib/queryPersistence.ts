import type {
  DehydratedState,
  Query,
  QueryCacheNotifyEvent,
  QueryClient,
} from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import type {
  PersistedClient,
  Persister,
  PersistRetryer,
} from '@tanstack/react-query-persist-client'
import { JsonValueSchema } from '@opencode-manager/shared/utils'
import { z } from 'zod'
import { SESSION_PINS_QUERY_KEY } from '@/hooks/useSessionPins'
import { ACTIVE_WORK_SESSIONS_QUERY_ROOT } from '@/lib/queryInvalidation'

type DehydratedQuery = DehydratedState['queries'][number]

export interface PersistedQueryRule {
  readonly prefix: readonly string[]
  readonly lastSegment?: string
  readonly gcTimeInQueryOptions?: boolean
}

export interface QueryCacheStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export interface QueryCachePersister extends Persister {
  hasPersistedClient: () => boolean
}

export const PERSISTED_QUERY_RULES: readonly PersistedQueryRule[] = [
  { prefix: ['repos'] },
  { prefix: SESSION_PINS_QUERY_KEY },
  { prefix: ['opencode-servers'] },
  { prefix: ['opencode', 'sessions'], gcTimeInQueryOptions: true },
  { prefix: ['opencode', 'session'] },
  { prefix: ['opencode', ACTIVE_WORK_SESSIONS_QUERY_ROOT] },
  { prefix: ['opencode', 'projects'] },
  { prefix: ['opencode', 'vcs'], lastSegment: 'info' },
]

export const PERSISTED_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

export const PERSIST_THROTTLE_MS = 1000

export const QUERY_CACHE_STORAGE_KEY = 'ocm.query-cache.v1'

const SESSION_LIST_OPTIONS_INDEX = 3

const SessionListOptionsSchema = z.looseObject({ search: z.string().optional() })

const InfiniteQueryDataSchema = z.looseObject({
  pages: z.array(z.union([JsonValueSchema, z.undefined()])),
  pageParams: z.array(z.union([JsonValueSchema, z.undefined()])),
})

const PERSISTED_UPDATE_ACTIONS: ReadonlySet<string> = new Set([
  'success',
  'error',
  'failed',
  'invalidate',
  'setState',
])

export function shouldPersistCacheEvent(event: QueryCacheNotifyEvent): boolean {
  if (event.type === 'added' || event.type === 'removed') {
    return isPersistedQueryKey(event.query.queryKey)
  }
  if (event.type !== 'updated') return false
  if (!PERSISTED_UPDATE_ACTIONS.has(event.action.type)) return false
  return isPersistedQueryKey(event.query.queryKey)
}

function matchesRule(rule: PersistedQueryRule, queryKey: readonly unknown[]): boolean {
  if (queryKey.length < rule.prefix.length) return false
  if (!rule.prefix.every((segment, index) => queryKey[index] === segment)) return false
  return rule.lastSegment === undefined || queryKey[queryKey.length - 1] === rule.lastSegment
}

export function isPersistedQueryKey(queryKey: readonly unknown[]): boolean {
  return PERSISTED_QUERY_RULES.some((rule) => matchesRule(rule, queryKey))
}

function isSessionListQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'opencode' && queryKey[1] === 'sessions'
}

function sessionListHasSearch(queryKey: readonly unknown[]): boolean {
  const parsed = SessionListOptionsSchema.safeParse(queryKey[SESSION_LIST_OPTIONS_INDEX])
  return parsed.success && parsed.data.search !== undefined && parsed.data.search.trim() !== ''
}

export function shouldPersistQuery(query: Query): boolean {
  if (query.state.status !== 'success') return false
  if (!isPersistedQueryKey(query.queryKey)) return false
  if (isSessionListQueryKey(query.queryKey) && sessionListHasSearch(query.queryKey)) return false
  return true
}

export function queryCacheBuster(userId: string): string {
  return `${window.location.origin}|${userId}`
}

type InfiniteQueryData = z.infer<typeof InfiniteQueryDataSchema>

function capInfinitePages(data: InfiniteQueryData): InfiniteQueryData {
  if (data.pages.length <= 1) return data
  return { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
}

function capQueryPages(query: DehydratedQuery): DehydratedQuery {
  const parsed = InfiniteQueryDataSchema.safeParse(query.state.data)
  if (!parsed.success) return query
  return {
    ...query,
    state: { ...query.state, data: capInfinitePages(parsed.data) },
  }
}

export function capInfiniteQueryPages(clientState: DehydratedState): DehydratedState {
  return { ...clientState, queries: clientState.queries.map(capQueryPages) }
}

export function serializePersistedClient(client: PersistedClient): string {
  return JSON.stringify({ ...client, clientState: capInfiniteQueryPages(client.clientState) })
}

export function createDropOldestHalfRetryer(): PersistRetryer {
  let ageOrderedQueries: readonly DehydratedQuery[] = []

  return ({ persistedClient }) => {
    const queries = persistedClient.clientState.queries
    if (queries.length === 0) return undefined
    const isRetryOfSameSave = queries.length < ageOrderedQueries.length
      && queries.every((query) => ageOrderedQueries.includes(query))
    if (!isRetryOfSameSave) {
      ageOrderedQueries = [...queries].sort(
        (left, right) => left.state.dataUpdatedAt - right.state.dataUpdatedAt,
      )
    }

    const remaining = new Set(queries)
    const oldestFirst = ageOrderedQueries.filter((query) => remaining.has(query))
    const keptQueries = new Set(oldestFirst.slice(Math.ceil(oldestFirst.length / 2)))

    return {
      ...persistedClient,
      clientState: {
        ...persistedClient.clientState,
        queries: queries.filter((query) => keptQueries.has(query)),
      },
    }
  }
}

function readBrowserStorage(): QueryCacheStorage | null {
  if (!('window' in globalThis)) return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function createQueryCachePersister(
  storage: QueryCacheStorage | null = readBrowserStorage(),
  throttleTime: number = PERSIST_THROTTLE_MS,
): QueryCachePersister {
  const persister = createSyncStoragePersister({
    storage,
    key: QUERY_CACHE_STORAGE_KEY,
    throttleTime,
    serialize: serializePersistedClient,
    retry: createDropOldestHalfRetryer(),
  })

  return {
    ...persister,
    hasPersistedClient: () => {
      if (storage === null) return false
      try {
        return storage.getItem(QUERY_CACHE_STORAGE_KEY) !== null
      } catch {
        return false
      }
    },
  }
}

export interface BusterGuardedPersisterOptions {
  persister: QueryCachePersister
  readBuster: () => string | null
  throttleTime?: number
}

export function createBusterGuardedPersister({
  persister,
  readBuster,
  throttleTime = PERSIST_THROTTLE_MS,
}: BusterGuardedPersisterOptions): QueryCachePersister {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingClient: PersistedClient | null = null

  const flush = () => {
    timer = null
    const client = pendingClient
    pendingClient = null
    if (client === null || client.buster !== readBuster()) return
    void Promise.resolve(persister.persistClient(client)).catch(() => {})
  }

  return {
    persistClient: (client) => {
      pendingClient = client
      if (timer === null) timer = setTimeout(flush, throttleTime)
    },
    restoreClient: () => persister.restoreClient(),
    removeClient: () => {
      pendingClient = null
      return persister.removeClient()
    },
    hasPersistedClient: () => persister.hasPersistedClient(),
  }
}

export function applyPersistedQueryDefaults(queryClient: QueryClient): void {
  for (const rule of PERSISTED_QUERY_RULES) {
    if (rule.lastSegment !== undefined || rule.gcTimeInQueryOptions) continue
    queryClient.setQueryDefaults(rule.prefix, { gcTime: PERSISTED_CACHE_MAX_AGE_MS })
  }
}
