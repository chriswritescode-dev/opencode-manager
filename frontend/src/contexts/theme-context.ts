import { createContext, useContext } from 'react'
import type { ThemeMode } from '@/lib/theme/colorTheme'

export const ThemeContext = createContext<ThemeMode | null>(null)

export function useThemeMode(): ThemeMode | null {
  return useContext(ThemeContext)
}
