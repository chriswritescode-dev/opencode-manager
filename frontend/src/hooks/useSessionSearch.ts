import { useMemo, useState } from 'react'
import { useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { selectRootSessions } from '@/components/session/session-partition'
import { getSessionKey } from '@/lib/sessionKey'

const DEFAULT_LIMIT = 25

export interface UseSessionSearchOptions {
  limit?: number
  allDirectories?: boolean
}

/**
 * Owns the sessions-dialog search state: the raw query, its debounced server
 * value, the root-session selection, and the immediate local title filter.
 */
export function useSessionSearch(directories: string[], options: UseSessionSearchOptions = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT
  const allDirectories = options.allDirectories ?? false
  const [query, setQuery] = useState('')
  const trimmedQuery = query.trim()
  const debouncedQuery = useDebouncedValue(trimmedQuery, 150)
  const search = trimmedQuery ? debouncedQuery : ''
  const {
    data: sessions,
    isLoading,
    isError,
    isPlaceholderData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useSessionsAcrossDirectories(directories, { search, limit, keepPreviousResults: true, allDirectories })

  const directorySet = useMemo(() => new Set(directories), [directories])

  const rootSessions = useMemo(
    () => selectRootSessions(sessions ?? [], { directories: directorySet, keyFn: getSessionKey }),
    [sessions, directorySet],
  )

  const filteredSessions = useMemo(() => {
    if (!trimmedQuery) return rootSessions
    const needle = trimmedQuery.toLowerCase()
    return rootSessions.filter((session) => (session.title ?? '').toLowerCase().includes(needle))
  }, [rootSessions, trimmedQuery])

  const isSearchPending = trimmedQuery !== search || isPlaceholderData
  const canFetchNextPage = Boolean(
    hasNextPage && !isFetchingNextPage && !isFetchNextPageError && !isSearchPending,
  )

  return {
    query,
    setQuery,
    trimmedQuery,
    sessions,
    filteredSessions,
    isSearchPending,
    isLoading,
    isError,
    isPlaceholderData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    canFetchNextPage,
  }
}
