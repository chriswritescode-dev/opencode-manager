import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IsRestoringProvider, useQueryClient } from '@tanstack/react-query'
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client'
import { useAuth } from '@/hooks/useAuth'
import {
  PERSISTED_CACHE_MAX_AGE_MS,
  PERSIST_THROTTLE_MS,
  createBusterGuardedPersister,
  createQueryCachePersister,
  queryCacheBuster,
  shouldPersistCacheEvent,
  shouldPersistQuery,
  type QueryCachePersister,
} from '@/lib/queryPersistence'

export interface QueryCachePersistenceProviderProps {
  children?: ReactNode
  persister?: QueryCachePersister
  /** Spacing between persisted saves; tests lower it instead of waiting a second per write. */
  persistThrottleMs?: number
}

/**
 * Restores the allowlisted part of the React Query cache for the signed-in account and keeps it
 * persisted while that account stays signed in.
 *
 * This provider owns the cache teardown. Signing out or switching accounts clears both the in-memory
 * client and the persisted cache here, and the persister drops any save still queued for the account
 * that just left, so a trailing write cannot recreate the previous account's cache.
 *
 * The restore starts only once the session resolves to a signed-in user and uses
 * `"<origin>|<userId>"` as the persister buster, so a cache written for another origin or account is
 * discarded instead of hydrating this one. While the restore is in flight the subtree runs under
 * `IsRestoringProvider`, which keeps queries from fetching before the persisted data is available.
 * A first sign-in with nothing on disk subscribes straight away, because there is nothing to wait for.
 *
 * Saves are driven by query cache events whose key is allowlisted and, for an update, whose action
 * changes data or status, so a streaming transcript update costs no dehydrate.
 */
export function QueryCachePersistenceProvider({
  children,
  persister,
  persistThrottleMs = PERSIST_THROTTLE_MS,
}: QueryCachePersistenceProviderProps) {
  const queryClient = useQueryClient()
  const { user, isAuthenticated, isLoading } = useAuth()
  const defaultPersister = useMemo(() => createQueryCachePersister(undefined, 0), [])
  const basePersister = persister ?? defaultPersister
  const userId = isAuthenticated ? user?.id ?? null : null
  const buster = userId === null ? null : queryCacheBuster(userId)
  const activeBusterRef = useRef<string | null>(null)
  const [restoredBuster, setRestoredBuster] = useState<string | null>(null)
  const previousUserIdRef = useRef<string | null>(null)
  const hasPersistedCache = useMemo(
    () => buster !== null && basePersister.hasPersistedClient(),
    [buster, basePersister],
  )
  const restoring = buster !== null && restoredBuster !== buster && hasPersistedCache
  const activePersister = useMemo(
    () => createBusterGuardedPersister({
      persister: basePersister,
      readBuster: () => activeBusterRef.current,
      throttleTime: persistThrottleMs,
    }),
    [basePersister, persistThrottleMs],
  )

  useLayoutEffect(() => {
    activeBusterRef.current = buster
  }, [buster])

  useEffect(() => {
    if (isLoading) return

    if (buster === null) {
      setRestoredBuster(null)
      void Promise.resolve(activePersister.removeClient()).catch(() => {})
      queryClient.clear()
      previousUserIdRef.current = null
      return
    }

    if (previousUserIdRef.current !== null && previousUserIdRef.current !== userId) {
      queryClient.clear()
    }
    previousUserIdRef.current = userId

    let cancelled = false
    let unsubscribe: (() => void) | undefined

    const subscribe = () => {
      unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (!shouldPersistCacheEvent(event)) return
        void persistQueryClientSave({
          queryClient,
          persister: activePersister,
          buster,
          dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
        }).catch(() => {})
      })
    }

    if (!hasPersistedCache) {
      setRestoredBuster(buster)
      subscribe()
    } else {
      void (async () => {
        await persistQueryClientRestore({
          queryClient,
          persister: activePersister,
          maxAge: PERSISTED_CACHE_MAX_AGE_MS,
          buster,
        }).catch(() => {})
        if (cancelled) return

        setRestoredBuster(buster)
        subscribe()
      })()
    }

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [buster, userId, isLoading, hasPersistedCache, activePersister, queryClient])

  return <IsRestoringProvider value={restoring}>{children}</IsRestoringProvider>
}
