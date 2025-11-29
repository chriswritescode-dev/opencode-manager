import { useEffect, useState } from 'react'
import { useSettings } from './useSettings'

export function useTheme() {
  const { preferences } = useSettings()
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    const theme = preferences?.theme || 'dark'
    const root = document.documentElement

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.add('dark')
        setCurrentTheme('dark')
      } else {
        root.classList.remove('dark')
        setCurrentTheme('light')
      }
    }

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mediaQuery.matches)

      const listener = (e: MediaQueryListEvent) => applyTheme(e.matches)
      mediaQuery.addEventListener('change', listener)
      return () => mediaQuery.removeEventListener('change', listener)
    } else {
      applyTheme(theme === 'dark')
    }
  }, [preferences?.theme])

  return currentTheme
}
