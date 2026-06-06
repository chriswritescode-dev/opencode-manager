import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export type UrlHistoryMode = 'push' | 'replace'

export interface UseUrlParamsReturn {
  search: string
  updateParams: (updater: (params: URLSearchParams) => void, mode?: UrlHistoryMode) => void
}

export function useUrlParams(): UseUrlParamsReturn {
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef(location.search)

  useEffect(() => {
    searchRef.current = location.search
  }, [location.search])

  const updateParams = useCallback(
    (updater: (params: URLSearchParams) => void, mode: UrlHistoryMode = 'replace') => {
      const params = new URLSearchParams(searchRef.current)
      updater(params)
      navigate({ search: params.toString() }, { replace: mode === 'replace' })
    },
    [navigate],
  )

  return { search: location.search, updateParams }
}
