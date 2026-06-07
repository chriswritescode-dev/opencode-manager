import { useCallback } from 'react'
import { useUrlParams } from './useUrlParams'

export type WorktreeTabValue = 'repo' | 'workspaces'

interface UseWorktreeTabReturn {
  activeTab: WorktreeTabValue
  setActiveTab: (tab: WorktreeTabValue) => void
}

export function useWorktreeTab(): UseWorktreeTabReturn {
  const { searchParams, updateParams } = useUrlParams()

  const activeTab: WorktreeTabValue = searchParams.get('repoTab') === 'workspaces' ? 'workspaces' : 'repo'

  const setActiveTab = useCallback((tab: WorktreeTabValue) => {
    updateParams((p) => {
      if (tab === 'repo') {
        p.delete('repoTab')
      } else {
        p.set('repoTab', tab)
      }
    }, 'replace')
  }, [updateParams])

  return {
    activeTab,
    setActiveTab,
  }
}
