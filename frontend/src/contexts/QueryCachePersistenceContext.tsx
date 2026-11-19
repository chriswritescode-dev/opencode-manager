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
  persistThrottleMs?: number
}

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
