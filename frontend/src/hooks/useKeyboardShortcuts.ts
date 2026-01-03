import { useEffect, useCallback, useRef, useState } from 'react'
import { useSettings } from './useSettings'
import { DEFAULT_LEADER_KEY } from '@/api/types/settings'

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

const normalizeShortcut = (shortcut: string): string => {
  return shortcut.replace(/Cmd/g, isMac ? 'Cmd' : 'Ctrl')
}

const parseEventShortcut = (e: KeyboardEvent): string => {
  const keys = []
  if (e.ctrlKey) keys.push('Ctrl')
  if (e.metaKey) keys.push('Cmd')
  if (e.altKey) keys.push('Alt')
  if (e.shiftKey) keys.push('Shift')
  
  const mainKey = e.key
  if (!['Control', 'Meta', 'Alt', 'Shift'].includes(mainKey)) {
    let displayKey = mainKey
    if (mainKey === ' ') displayKey = 'Space'
    else if (mainKey === 'ArrowUp') displayKey = 'Up'
    else if (mainKey === 'ArrowDown') displayKey = 'Down'
    else if (mainKey === 'ArrowLeft') displayKey = 'Left'
    else if (mainKey === 'ArrowRight') displayKey = 'Right'
    else if (mainKey === 'Enter') displayKey = 'Return'
    else if (mainKey === 'Escape') displayKey = 'Esc'
    else if (mainKey === 'Tab') displayKey = 'Tab'
    else if (mainKey === 'Backspace') displayKey = 'Backspace'
    else if (mainKey === 'Delete') displayKey = 'Delete'
    else if (mainKey.length === 1) displayKey = mainKey.toUpperCase()
    
    keys.push(displayKey)
    return keys.join('+')
  }
  return ''
}

const DEFAULT_DIRECT_SHORTCUTS = ['submit', 'abort']
const LEADER_TIMEOUT = 1500

interface ShortcutActions {
  openModelDialog?: () => void
  openSessions?: () => void
  sessions?: () => void
  newSession?: () => void
  closeSession?: () => void
  toggleSidebar?: () => void
  submitPrompt?: () => void
  abortSession?: () => void
  toggleMode?: () => void
  undo?: () => void
  redo?: () => void
  compact?: () => void
  fork?: () => void
  openSettings?: () => void
}

export function useKeyboardShortcuts(actions: ShortcutActions = {}) {
  const { preferences } = useSettings()
  const [leaderActive, setLeaderActive] = useState(false)
  const leaderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences

  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const clearLeaderTimeout = useCallback(() => {
    if (leaderTimeoutRef.current) {
      clearTimeout(leaderTimeoutRef.current)
      leaderTimeoutRef.current = null
    }
  }, [])

  const executeAction = useCallback((action: string, e: KeyboardEvent) => {
    e.preventDefault()
    const currentActions = actionsRef.current
    
    switch (action) {
      case 'selectModel':
        currentActions.openModelDialog?.()
        break
      case 'sessions':
        currentActions.openSessions?.()
        break
      case 'newSession':
        currentActions.newSession?.()
        break
      case 'closeSession':
        currentActions.closeSession?.()
        break
      case 'toggleSidebar':
        currentActions.toggleSidebar?.()
        break
      case 'submit':
        currentActions.submitPrompt?.()
        break
      case 'abort':
        currentActions.abortSession?.()
        break
      case 'toggleMode':
        currentActions.toggleMode?.()
        break
      case 'undo':
        currentActions.undo?.()
        break
      case 'redo':
        currentActions.redo?.()
        break
      case 'compact':
        currentActions.compact?.()
        break
      case 'fork':
        currentActions.fork?.()
        break
      case 'settings':
        currentActions.openSettings?.()
        break
    }
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const shortcut = parseEventShortcut(e)
    if (!shortcut) return

    const prefs = preferencesRef.current
    const shortcuts = prefs?.keyboardShortcuts || {}
    const leaderKey = normalizeShortcut(prefs?.leaderKey || DEFAULT_LEADER_KEY)
    const directShortcuts = prefs?.directShortcuts ?? DEFAULT_DIRECT_SHORTCUTS
    
    const activeFileEditor = document.querySelector('[data-file-editor="true"]')
    if (activeFileEditor && document.activeElement === activeFileEditor) {
      return
    }
    
    const target = e.target as HTMLElement
    const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true'
    const isFileEditor = target.getAttribute('data-file-editor') === 'true'
    
    if (isFileEditor) return

    if (leaderActive) {
      clearLeaderTimeout()
      setLeaderActive(false)
      
      const action = Object.entries(shortcuts).find(([actionName, keys]) => {
        if (directShortcuts.includes(actionName)) return false
        if (!keys) return false
        return normalizeShortcut(keys) === shortcut
      })?.[0]
      
      if (action) {
        executeAction(action, e)
      }
      return
    }

    if (shortcut === leaderKey && !isInInput) {
      e.preventDefault()
      setLeaderActive(true)
      clearLeaderTimeout()
      leaderTimeoutRef.current = setTimeout(() => {
        setLeaderActive(false)
      }, LEADER_TIMEOUT)
      return
    }

    const directAction = Object.entries(shortcuts).find(([actionName, keys]) => {
      if (!directShortcuts.includes(actionName)) return false
      if (!keys) return false
      return normalizeShortcut(keys) === shortcut
    })?.[0]
    
    if (directAction) {
      if (isInInput && directAction !== 'submit' && directAction !== 'abort') {
        return
      }
      executeAction(directAction, e)
    }
  }, [leaderActive, clearLeaderTimeout, executeAction])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      clearLeaderTimeout()
    }
  }, [handleKeyDown, clearLeaderTimeout])

  return { leaderActive }
}