import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

type UrlHistoryMode = 'push' | 'replace'

interface UseUrlParamsReturn {
  search: string
  searchParams: URLSearchParams
  updateParams: (updater: (params: URLSearchParams) => void, mode?: UrlHistoryMode) => void
}

export function useUrlParams(): UseUrlParamsReturn {
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef(location.search)

  useEffect(() => {
    searchRef.current = location.search
  }, [location.search])

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])

  const updateParams = useCallback(
    (updater: (params: URLSearchParams) => void, mode: UrlHistoryMode = 'replace') => {
      const params = new URLSearchParams(searchRef.current)
      updater(params)
      navigate({ search: params.toString() }, { replace: mode === 'replace' })
    },
    [navigate],
  )

  return { search: location.search, searchParams, updateParams }
}
