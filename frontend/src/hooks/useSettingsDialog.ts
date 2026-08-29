import { useCallback, useRef } from 'react'
import { useUrlParams } from './useUrlParams'

const SETTINGS_CONTENT_TABS = ['account', 'general', 'notifications', 'voice', 'git', 'shortcuts', 'opencode', 'providers', 'logs'] as const

export type SettingsContentTab = (typeof SETTINGS_CONTENT_TABS)[number]

export function isSettingsContentTab(value: string | null): value is SettingsContentTab {
  return value !== null && (SETTINGS_CONTENT_TABS as readonly string[]).includes(value)
}

interface UseSettingsDialogReturn {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  activeTab: SettingsContentTab
  selectedTab: SettingsContentTab | null
  setActiveTab: (tab: SettingsContentTab) => void
}

export function useSettingsDialog(): UseSettingsDialogReturn {
  const { searchParams, updateParams } = useUrlParams()

  const isOpen = searchParams.get('settings') === 'open'
  const rawTab = searchParams.get('settingsTab')
  const selectedTab = isSettingsContentTab(rawTab) ? rawTab : null
  const activeTab = selectedTab || 'account'

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

  const setActiveTab = useCallback((tab: SettingsContentTab) => {
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
    selectedTab,
    setActiveTab,
  }
}
