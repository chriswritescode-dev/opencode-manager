import { useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

type Tab = 'account' | 'general' | 'notifications' | 'voice' | 'git' | 'shortcuts' | 'opencode' | 'providers' | 'menu'

interface UseSettingsDialogUrlReturn {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  activeTab: Tab
  setActiveTab: (tab: Tab) => void
}

export function useSettingsDialogUrl(): UseSettingsDialogUrlReturn {
  const navigate = useNavigate()
  const location = useLocation()

  const searchParams = new URLSearchParams(location.search)
  const isOpen = searchParams.get('settings') === 'open'
  const activeTab = (searchParams.get('tab') as Tab) || 'account'

  const open = useCallback(() => {
    const newParams = new URLSearchParams(location.search)
    newParams.set('settings', 'open')
    newParams.set('tab', activeTab)
    navigate({ search: newParams.toString() }, { replace: true })
  }, [activeTab, navigate, location.search])

  const close = useCallback(() => {
    const newParams = new URLSearchParams(location.search)
    newParams.delete('settings')
    newParams.delete('tab')
    navigate({ search: newParams.toString() }, { replace: true })
  }, [navigate, location.search])

  const toggle = useCallback(() => {
    if (isOpen) {
      close()
    } else {
      open()
    }
  }, [isOpen, open, close])

  const setActiveTab = useCallback((tab: Tab) => {
    const newParams = new URLSearchParams(location.search)
    newParams.set('settings', 'open')
    newParams.set('tab', tab)
    navigate({ search: newParams.toString() }, { replace: true })
  }, [navigate, location.search])

  return {
    isOpen,
    open,
    close,
    toggle,
    activeTab,
    setActiveTab,
  }
}
