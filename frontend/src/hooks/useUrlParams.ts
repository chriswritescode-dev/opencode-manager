import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

type UrlHistoryMode = 'push' | 'replace'

const URL_PARAM_HISTORY_KEY = 'urlParamHistory'

interface UrlParamHistoryState {
  previousSearch: string
}

interface UseUrlParamsReturn {
  search: string
  searchParams: URLSearchParams
  updateParams: (updater: (params: URLSearchParams) => void, mode?: UrlHistoryMode) => void
  /**
   * Closes params that an opener pushed: goes back in history when the current entry was pushed by
   * `updateParams`, so closing leaves no duplicate entry, and replaces the entry otherwise so a
   * deep link cannot send Back out of the app.
   */
  closePushedParams: (updater: (params: URLSearchParams) => void) => void
}

function splitSearch(params: URLSearchParams): { search: string; locationSearch: string } {
  const search = params.toString()
  return { search, locationSearch: search ? `?${search}` : '' }
}

function withPreviousSearch(state: unknown, previousSearch: string): Record<string, unknown> {
  const base = state !== null && typeof state === 'object' ? state : {}
  return { ...base, [URL_PARAM_HISTORY_KEY]: { previousSearch } satisfies UrlParamHistoryState }
}

function replaceOptions(state: unknown): { replace: true; state?: unknown } {
  return state == null ? { replace: true } : { replace: true, state }
}

function readPreviousSearch(state: unknown): string | null {
  if (state === null || typeof state !== 'object') return null
  const entry = (state as Record<string, unknown>)[URL_PARAM_HISTORY_KEY]
  if (entry === null || typeof entry !== 'object') return null
  const previousSearch = (entry as UrlParamHistoryState).previousSearch
  return typeof previousSearch === 'string' ? previousSearch : null
}

export function useUrlParams(): UseUrlParamsReturn {
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef(location.search)
  const stateRef = useRef(location.state)

  useEffect(() => {
    searchRef.current = location.search
    stateRef.current = location.state
  }, [location])

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])

  const updateParams = useCallback(
    (updater: (params: URLSearchParams) => void, mode: UrlHistoryMode = 'replace') => {
      const previousSearch = searchRef.current
      const params = new URLSearchParams(previousSearch)
      updater(params)
      const { search, locationSearch } = splitSearch(params)
      if (locationSearch === previousSearch) return

      const nextState = mode === 'push' ? withPreviousSearch(stateRef.current, previousSearch) : stateRef.current
      searchRef.current = locationSearch
      stateRef.current = nextState
      navigate({ search }, mode === 'push' ? { state: nextState } : replaceOptions(nextState))
    },
    [navigate],
  )

  const closePushedParams = useCallback(
    (updater: (params: URLSearchParams) => void) => {
      const currentSearch = searchRef.current
      const params = new URLSearchParams(currentSearch)
      updater(params)
      const { search, locationSearch } = splitSearch(params)
      if (locationSearch === currentSearch) return

      const previousSearch = readPreviousSearch(stateRef.current)
      if (previousSearch !== null) {
        searchRef.current = previousSearch
        stateRef.current = null
        navigate(-1)
        return
      }

      searchRef.current = locationSearch
      navigate({ search }, replaceOptions(stateRef.current))
    },
    [navigate],
  )

  return { search: location.search, searchParams, updateParams, closePushedParams }
}
