/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { applyColorTheme, getDocumentThemeMode, type ThemeMode } from '@/lib/theme/colorTheme'

const ThemeContext = createContext<ThemeMode | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { preferences } = useSettings()
  const [themeMode, setThemeMode] = useState<ThemeMode>(getDocumentThemeMode)
  const hasPreferences = preferences !== undefined
  const theme = preferences?.theme || 'dark'
  const colorTheme = preferences?.colorTheme

  useEffect(() => {
    if (!hasPreferences) return

    const root = document.documentElement

    const applyTheme = (isDark: boolean) => {
      root.classList.toggle('dark', isDark)
      setThemeMode(isDark ? 'dark' : 'light')
      applyColorTheme(root, colorTheme, isDark)
    }

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mediaQuery.matches)

      const listener = (event: MediaQueryListEvent) => applyTheme(event.matches)
      mediaQuery.addEventListener('change', listener)
      return () => mediaQuery.removeEventListener('change', listener)
    }

    applyTheme(theme === 'dark')
  }, [hasPreferences, theme, colorTheme])

  return <ThemeContext.Provider value={themeMode}>{children}</ThemeContext.Provider>
}

export function useThemeMode(): ThemeMode | null {
  return useContext(ThemeContext)
}
