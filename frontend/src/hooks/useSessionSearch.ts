import { useCallback, useMemo, useState } from 'react'
import { useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { selectRootSessions } from '@/components/session/session-partition'
import { buildSessionKey } from '@/lib/sessionKey'
import type { Session } from '@/api/types'

const DEFAULT_LIMIT = 25

export interface UseSessionSearchOptions {
  limit?: number
}

/**
 * Owns the sessions-dialog search state: the raw query, its debounced server
 * value, the root-session selection, and the immediate local title filter.
 */
export function useSessionSearch(directories: string[], options: UseSessionSearchOptions = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT
  const [query, setQuery] = useState('')
  const trimmedQuery = query.trim()
  const debouncedQuery = useDebouncedValue(trimmedQuery, 150)
  const search = trimmedQuery ? debouncedQuery : ''
  const {
    data: sessions,
    isLoading,
    isPlaceholderData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useSessionsAcrossDirectories(directories, { search, limit, keepPreviousResults: true })

  const directorySet = useMemo(() => new Set(directories), [directories])
  const getSessionSelectionKey = useCallback(
    (session: Session) => buildSessionKey(session.location.directory, session.id),
    [],
  )

  const rootSessions = useMemo(
    () => selectRootSessions(sessions ?? [], { directories: directorySet, keyFn: getSessionSelectionKey }),
    [sessions, directorySet, getSessionSelectionKey],
  )

  const filteredSessions = useMemo(() => {
    if (!trimmedQuery) return rootSessions
    const needle = trimmedQuery.toLowerCase()
    return rootSessions.filter((session) => (session.title ?? '').toLowerCase().includes(needle))
  }, [rootSessions, trimmedQuery])

  const isSearchPending = trimmedQuery !== search || isPlaceholderData
  const canFetchNextPage = Boolean(
    hasNextPage && !isFetchingNextPage && !isFetchNextPageError && !isPlaceholderData,
  )

  return {
    query,
    setQuery,
    trimmedQuery,
    sessions,
    filteredSessions,
    isSearchPending,
    isLoading,
    isPlaceholderData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    canFetchNextPage,
  }
}
