import { useCallback, useRef } from 'react'
import { useUrlParams } from './useUrlParams'

type Tab = 'account' | 'general' | 'notifications' | 'voice' | 'git' | 'shortcuts' | 'opencode' | 'providers' | 'menu'

interface UseSettingsDialogReturn {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  activeTab: Tab
  setActiveTab: (tab: Tab) => void
}

export function useSettingsDialog(): UseSettingsDialogReturn {
  const { searchParams, updateParams } = useUrlParams()

  const isOpen = searchParams.get('settings') === 'open'
  const activeTab = (searchParams.get('settingsTab') as Tab) || 'account'

  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  const open = useCallback(() => {
    updateParams((p) => {
      p.set('settings', 'open')
      p.set('settingsTab', activeTabRef.current)
      p.delete('mobileTab')
    }, 'push')
  }, [updateParams])

  const close = useCallback(() => {
    updateParams((p) => {
      p.delete('settings')
      p.delete('settingsTab')
    }, 'replace')
  }, [updateParams])

  const toggle = useCallback(() => {
    const isCurrentlyOpen = searchParams.get('settings') === 'open'
    if (isCurrentlyOpen) {
      close()
    } else {
      open()
    }
  }, [searchParams, open, close])

  const setActiveTab = useCallback((tab: Tab) => {
    updateParams((p) => {
      p.set('settings', 'open')
      p.set('settingsTab', tab)
    }, 'replace')
  }, [updateParams])

  return {
    isOpen,
    open,
    close,
    toggle,
    activeTab,
    setActiveTab,
  }
}
