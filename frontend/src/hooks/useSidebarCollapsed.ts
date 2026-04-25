import { useState, useCallback } from 'react'

const STORAGE_KEY = 'oc:sidebar:collapsed'

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === null) {
      return false
    }
    try {
      const parsed = JSON.parse(stored)
      return typeof parsed === 'boolean' ? parsed : false
    } catch {
      return false
    }
  })

  const toggle = useCallback(() => {
    setCollapsed((prev: boolean) => {
      const newValue = !prev
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newValue))
      }
      return newValue
    })
  }, [])

  return [collapsed, toggle]
}
