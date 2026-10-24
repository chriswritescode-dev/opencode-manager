import type { Query, QueryClient } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { removeOldestQuery, type Persister } from '@tanstack/react-query-persist-client'

export interface PersistedQueryRule {
  readonly prefix: readonly string[]
  readonly lastSegment?: string
}

export interface QueryCacheStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

/**
 * Query-key prefixes whose cached data is written to disk so a previously loaded list can paint
 * before the network answers.
 *
 * Every rule is a list or roster key whose shape is stable across reloads of the same account.
 * Excluded on purpose: `settings` (contains the OpenCode server auth token and API keys),
 * `provider-credentials`, `passkeys`, `provider-auth-methods`, the `opencode` transcript kinds
 * (large, and rewritten on every streamed token), `schedules` and `all-schedules` (a schedule or
 * MCP config can carry `client_secret`), and every root not listed here.
 *
 * `opencode` shares one root with transcript, provider and config keys, so those rules match the
 * second segment too and the `vcs` rule additionally requires `info` as the last segment.
 */
export const PERSISTED_QUERY_RULES: readonly PersistedQueryRule[] = [
  { prefix: ['repos'] },
  { prefix: ['reposGitStatus'] },
  { prefix: ['session-pins'] },
  { prefix: ['opencode-servers'] },
  { prefix: ['opencode', 'sessions'] },
  { prefix: ['opencode', 'session'] },
  { prefix: ['opencode', 'active-work-sessions'] },
  { prefix: ['opencode', 'projects'] },
  { prefix: ['opencode', 'vcs'], lastSegment: 'info' },
]

export const PERSISTED_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

export const QUERY_CACHE_STORAGE_KEY = 'ocm.query-cache.v1'

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

/**
 * Decides whether one query is allowed on disk: its key must match an allowlisted rule and it must
 * hold successfully fetched data. Pending and error states carry nothing worth restoring.
 */
export function shouldPersistQuery(query: Query): boolean {
  return query.state.status === 'success' && isPersistedQueryKey(query.queryKey)
}

/**
 * Cache owner key used as the persister `buster`. A persisted cache written for another origin or
 * account is discarded on restore instead of hydrating this one.
 */
export function queryCacheBuster(userId: string): string {
  return `${window.location.origin}|${userId}`
}

/**
 * Creates the localStorage persister that stores the dehydrated cache under
 * {@link QUERY_CACHE_STORAGE_KEY}, saving at most once per second. `removeOldestQuery` keeps a full
 * quota from silencing persistence: the oldest entry is dropped and the write retried.
 */
export function createQueryCachePersister(
  storage: QueryCacheStorage | null = typeof window === 'undefined' ? null : window.localStorage,
): Persister {
  return createSyncStoragePersister({
    storage,
    key: QUERY_CACHE_STORAGE_KEY,
    throttleTime: 1000,
    retry: removeOldestQuery,
  })
}

/**
 * Raises `gcTime` to {@link PERSISTED_CACHE_MAX_AGE_MS} for the allowlisted rules only, so a
 * restored inactive query survives long enough to be rendered while the global `gcTime` keeps its
 * normal value.
 */
export function applyPersistedQueryDefaults(queryClient: QueryClient): void {
  for (const rule of PERSISTED_QUERY_RULES) {
    queryClient.setQueryDefaults(rule.prefix, { gcTime: PERSISTED_CACHE_MAX_AGE_MS })
  }
}

/** Removes the persisted cache from storage, e.g. on logout. */
export function clearPersistedQueryCache(
  storage: QueryCacheStorage | null = typeof window === 'undefined' ? null : window.localStorage,
): void {
  try {
    storage?.removeItem(QUERY_CACHE_STORAGE_KEY)
  } catch {
    return
  }
}
