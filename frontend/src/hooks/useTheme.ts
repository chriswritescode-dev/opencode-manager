import { useEffect, useState } from 'react'

import { DEFAULT_THEME_PRESET, getAppThemeVariables } from '@/lib/opencodeThemes'

import { useSettings } from './useSettings'

export function useTheme() {
  const { preferences } = useSettings()
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    const theme = preferences?.theme || 'dark'
    const themePreset = preferences?.themePreset || DEFAULT_THEME_PRESET
    const root = document.documentElement

    const applyTheme = (mode: 'light' | 'dark') => {
      const isDark = mode === 'dark'

      if (isDark) {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }

      Object.entries(getAppThemeVariables(themePreset, mode)).forEach(([name, value]) => {
        root.style.setProperty(name, value)
      })

      root.dataset.themePreset = themePreset
      root.dataset.colorScheme = mode
      setCurrentTheme(mode)
    }

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mediaQuery.matches ? 'dark' : 'light')

      const listener = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light')
      mediaQuery.addEventListener('change', listener)
      return () => mediaQuery.removeEventListener('change', listener)
    } else {
      applyTheme(theme === 'dark' ? 'dark' : 'light')
    }
  }, [preferences?.theme, preferences?.themePreset])

  return currentTheme
}
