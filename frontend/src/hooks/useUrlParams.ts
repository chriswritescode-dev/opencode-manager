import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { JsonObjectSchema, type JsonObject, type JsonValue } from '@opencode-manager/shared/utils'

type UrlHistoryMode = 'push' | 'replace'

const URL_PARAM_HISTORY_KEY = 'urlParamHistory'

const previousSearchStateSchema = z.object({ previousSearch: z.string() })

interface UseUrlParamsReturn {
  search: string
  searchParams: URLSearchParams
  updateParams: (updater: (params: URLSearchParams) => void, mode?: UrlHistoryMode) => void
  closePushedParams: (updater: (params: URLSearchParams) => void) => void
}

interface SplitSearch {
  search: string
  locationSearch: string
}

interface ReplaceNavigateOptions {
  replace: true
  state?: JsonValue
}

function splitSearch(params: URLSearchParams): SplitSearch {
  const search = params.toString()
  return { search, locationSearch: search ? `?${search}` : '' }
}

function withPreviousSearch(state: JsonValue | undefined, previousSearch: string): JsonObject {
  const parsedBase = JsonObjectSchema.safeParse(state)
  const history: JsonObject = { previousSearch }
  const next: JsonObject = parsedBase.success ? { ...parsedBase.data } : {}
  next[URL_PARAM_HISTORY_KEY] = history
  return next
}

function replaceOptions(state: JsonValue | undefined): ReplaceNavigateOptions {
  return state === null || state === undefined ? { replace: true } : { replace: true, state }
}

function readPreviousSearch(state: JsonValue | undefined): string | null {
  const stateObject = JsonObjectSchema.safeParse(state)
  if (!stateObject.success) return null
  const entry = previousSearchStateSchema.safeParse(stateObject.data[URL_PARAM_HISTORY_KEY])
  return entry.success ? entry.data.previousSearch : null
}

export function useUrlParams(): UseUrlParamsReturn {
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef(location.search)
  const stateRef = useRef<JsonValue>(location.state)

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
