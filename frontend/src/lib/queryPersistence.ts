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
import { SESSION_PINS_QUERY_KEY } from '@/hooks/useSessionPins'
import { ACTIVE_WORK_SESSIONS_QUERY_ROOT } from '@/lib/queryInvalidation'

type DehydratedQuery = DehydratedState['queries'][number]

export interface PersistedQueryRule {
  readonly prefix: readonly string[]
  readonly lastSegment?: string
  /** Set `gcTime` in the query options instead of a prefix default, because keys under one prefix need different retention. */
  readonly gcTimeInQueryOptions?: boolean
}

export interface QueryCacheStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export interface QueryCachePersister extends Persister {
  /** Whether a cache for any buster is currently stored, so a first save needs no restore pass. */
  hasPersistedClient: () => boolean
}

/**
 * Query-key prefixes whose cached data is written to disk so a previously loaded list can paint
 * before the network answers.
 *
 * Every rule is a list or roster key whose shape is stable across reloads of the same account.
 * Excluded on purpose: `settings` (contains the OpenCode server auth token and API keys),
 * `provider-credentials`, `passkeys`, `provider-auth-methods`, the `opencode` transcript kinds
 * (large, and rewritten on every streamed token), `schedules` and `all-schedules` (a schedule or
 * MCP config can carry `client_secret`), `reposGitStatus` (a `Map` that JSON turns into `{}`), and
 * every root not listed here.
 *
 * `opencode` shares one root with transcript, provider and config keys, so those rules match the
 * second segment too and the `vcs` rule additionally requires `info` as the last segment.
 */
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

/** Minimum spacing between persisted saves, so a burst of cache changes costs one write. */
export const PERSIST_THROTTLE_MS = 1000

export const QUERY_CACHE_STORAGE_KEY = 'ocm.query-cache.v1'

const SESSION_LIST_OPTIONS_INDEX = 3

/**
 * Cache actions that change stored data or a query status. `fetch`, `pause` and `continue` only move
 * `fetchStatus`, which is not persisted, so they never justify a save.
 */
const PERSISTED_UPDATE_ACTIONS: ReadonlySet<string> = new Set([
  'success',
  'error',
  'failed',
  'invalidate',
  'setState',
])

/**
 * Whether a query cache event can change the persisted cache: the query key must be allowlisted and,
 * for an update, the action must change data or status.
 *
 * Streaming a transcript rewrites its key once per frame, so filtering here keeps the expensive
 * dehydrate away from every non-allowlisted update.
 */
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

/**
 * Whether a query key belongs to one of the allowlisted roots. Only the segments named by a rule
 * are inspected, so the directory, server id or search options appended to a list key stay free.
 */
export function isPersistedQueryKey(queryKey: readonly unknown[]): boolean {
  return PERSISTED_QUERY_RULES.some((rule) => matchesRule(rule, queryKey))
}

function isSessionListQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'opencode' && queryKey[1] === 'sessions'
}

function sessionListHasSearch(queryKey: readonly unknown[]): boolean {
  const options = queryKey[SESSION_LIST_OPTIONS_INDEX]
  if (typeof options !== 'object' || options === null) return false
  const search = (options as { search?: unknown }).search
  return typeof search === 'string' && search.trim() !== ''
}

/**
 * Decides whether one query is allowed on disk: its key must match an allowlisted rule, it must
 * hold successfully fetched data, and a paged session list must be the unfiltered one.
 *
 * A search result depends on the query the user typed, so persisting it would spend the storage
 * budget on keys that are rarely read again while evicting the lists that are.
 */
export function shouldPersistQuery(query: Query): boolean {
  if (query.state.status !== 'success') return false
  if (!isPersistedQueryKey(query.queryKey)) return false
  if (isSessionListQueryKey(query.queryKey) && sessionListHasSearch(query.queryKey)) return false
  return true
}

/**
 * Cache owner key used as the persister `buster`. A persisted cache written for another origin or
 * account is discarded on restore instead of hydrating this one.
 */
export function queryCacheBuster(userId: string): string {
  return `${window.location.origin}|${userId}`
}

interface InfiniteQueryData {
  pages: unknown[]
  pageParams: unknown[]
}

function isInfiniteQueryData(data: unknown): data is InfiniteQueryData {
  if (typeof data !== 'object' || data === null) return false
  const candidate = data as Partial<InfiniteQueryData>
  return Array.isArray(candidate.pages) && Array.isArray(candidate.pageParams)
}

function capInfinitePages(data: unknown): unknown {
  if (!isInfiniteQueryData(data) || data.pages.length <= 1) return data
  return { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
}

function capQueryPages(query: DehydratedQuery): DehydratedQuery {
  if (query.state.data === undefined) return query
  return {
    ...query,
    state: { ...query.state, data: capInfinitePages(query.state.data) },
  }
}

/**
 * Keeps only the first page of every infinite query in a dehydrated state.
 *
 * A restored list is refetched page by page anyway, so the extra pages only cost storage, and the
 * first page keeps `hasNextPage` derivable from its own next-page parameter.
 */
export function capInfiniteQueryPages(clientState: DehydratedState): DehydratedState {
  return { ...clientState, queries: clientState.queries.map(capQueryPages) }
}

/** Serializes the persisted client with {@link capInfiniteQueryPages} applied before the write. */
export function serializePersistedClient(client: PersistedClient): string {
  return JSON.stringify({ ...client, clientState: capInfiniteQueryPages(client.clientState) })
}

/**
 * Drops the oldest half of the persisted queries on every failed save.
 *
 * The sync persister re-serializes after each retry, so removing one query at a time burns a whole
 * write per query on a large cache. Halving the remaining set converges in a few passes, and the
 * age order is sorted once per save so the retries only filter it.
 *
 * Returning `undefined` once no query is left ends the retry loop instead of rewriting an empty
 * client that a full quota still rejects.
 */
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

/** Reads `localStorage`, which throws instead of returning `null` when the browser has storage disabled. */
function readBrowserStorage(): QueryCacheStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Creates the localStorage persister that stores the dehydrated cache under
 * {@link QUERY_CACHE_STORAGE_KEY}. Infinite queries are capped to their first page before the write,
 * and {@link createDropOldestHalfRetryer} keeps a full quota from silencing persistence.
 *
 * Writes are spaced by `throttleTime`; {@link createBusterGuardedPersister} throttles at the buster
 * level instead, so the persister it wraps is created with a zero throttle.
 */
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
  /** The buster that may still be written, or `null` once the account is signed out. */
  readBuster: () => string | null
  throttleTime?: number
}

/**
 * Wraps a persister so a save runs only when the buster that owns it is still active at write time.
 *
 * The throttle lives here, after the guard, because a save scheduled before sign-out would otherwise
 * land after `removeClient` and rewrite the previous account's cache.
 */
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

/**
 * Raises `gcTime` to {@link PERSISTED_CACHE_MAX_AGE_MS} for the allowlisted rules only, so a
 * restored inactive query survives long enough to be rendered while the global `gcTime` keeps its
 * normal value.
 *
 * `setQueryDefaults` matches by key prefix, so a rule whose keys need different retention, or
 * whose key only ends in a specific segment, sets `gcTime` in its own query options instead.
 */
export function applyPersistedQueryDefaults(queryClient: QueryClient): void {
  for (const rule of PERSISTED_QUERY_RULES) {
    if (rule.lastSegment !== undefined || rule.gcTimeInQueryOptions) continue
    queryClient.setQueryDefaults(rule.prefix, { gcTime: PERSISTED_CACHE_MAX_AGE_MS })
  }
}
