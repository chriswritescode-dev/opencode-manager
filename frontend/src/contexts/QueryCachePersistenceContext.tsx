import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IsRestoringProvider, useQueryClient } from '@tanstack/react-query'
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type Persister,
} from '@tanstack/react-query-persist-client'
import { useAuth } from '@/hooks/useAuth'
import {
  PERSISTED_CACHE_MAX_AGE_MS,
  createQueryCachePersister,
  queryCacheBuster,
  shouldPersistQuery,
} from '@/lib/queryPersistence'

export interface QueryCachePersistenceProviderProps {
  children?: ReactNode
  persister?: Persister
}

/**
 * Restores the allowlisted part of the React Query cache for the signed-in account and keeps it
 * persisted while that account stays signed in.
 *
 * The restore starts only once the session resolves to a signed-in user and uses
 * `"<origin>|<userId>"` as the persister buster, so a cache written for another origin or account
 * is discarded instead of hydrating this one. While the restore is in flight the subtree runs under
 * `IsRestoringProvider`, which keeps queries from fetching before the persisted data is available.
 *
 * A cache stored for a different user id is dropped from memory as well, and leaving the signed-in
 * state clears both the in-memory client and the persisted cache.
 */
export function QueryCachePersistenceProvider({
  children,
  persister,
}: QueryCachePersistenceProviderProps) {
  const queryClient = useQueryClient()
  const { user, isAuthenticated, isLoading } = useAuth()
  const defaultPersister = useMemo(() => createQueryCachePersister(), [])
  const activePersister = persister ?? defaultPersister
  const userId = isAuthenticated ? user?.id ?? null : null
  const buster = userId === null ? null : queryCacheBuster(userId)
  const [restoredBuster, setRestoredBuster] = useState<string | null>(null)
  const previousUserIdRef = useRef<string | null>(null)
  const restoring = buster !== null && restoredBuster !== buster

  useEffect(() => {
    const previousUserId = previousUserIdRef.current
    previousUserIdRef.current = userId
    if (previousUserId !== null && userId !== null && previousUserId !== userId) {
      queryClient.clear()
    }
  }, [userId, queryClient])

  useEffect(() => {
    if (isLoading) return

    if (buster === null) {
      setRestoredBuster(null)
      void Promise.resolve(activePersister.removeClient()).catch(() => {})
      queryClient.clear()
      return
    }

    let cancelled = false
    let unsubscribe: (() => void) | undefined

    void (async () => {
      await persistQueryClientRestore({
        queryClient,
        persister: activePersister,
        maxAge: PERSISTED_CACHE_MAX_AGE_MS,
        buster,
      }).catch(() => {})
      if (cancelled) return

      setRestoredBuster(buster)
      unsubscribe = persistQueryClientSubscribe({
        queryClient,
        persister: activePersister,
        buster,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      })
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [buster, isLoading, activePersister, queryClient])

  return <IsRestoringProvider value={restoring}>{children}</IsRestoringProvider>
}
