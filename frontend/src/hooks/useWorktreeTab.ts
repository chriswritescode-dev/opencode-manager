import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

export type WorktreeTabValue = 'repo' | 'workspaces'

export interface UseWorktreeTabReturn {
  activeTab: WorktreeTabValue
  setActiveTab: (tab: WorktreeTabValue) => void
}

export function useWorktreeTab(): UseWorktreeTabReturn {
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef(location.search)

  useEffect(() => {
    searchRef.current = location.search
  }, [location.search])

  const activeTab = useMemo<WorktreeTabValue>(() => {
    const searchParams = new URLSearchParams(location.search)
    const tabParam = searchParams.get('tab')
    return tabParam === 'workspaces' ? 'workspaces' : 'repo'
  }, [location.search])

  const setActiveTab = useCallback((tab: WorktreeTabValue) => {
    const newParams = new URLSearchParams(searchRef.current)
    if (tab === 'repo') {
      newParams.delete('tab')
    } else {
      newParams.set('tab', tab)
    }
    navigate({ search: newParams.toString() }, { replace: true })
  }, [navigate])

  return {
    activeTab,
    setActiveTab,
  }
}
