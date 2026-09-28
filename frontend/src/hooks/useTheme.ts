import { useThemeMode } from '@/contexts/ThemeContext'
import { getDocumentThemeMode } from '@/lib/theme/colorTheme'

export function useTheme(): 'light' | 'dark' {
  const contextMode = useThemeMode()
  return contextMode ?? getDocumentThemeMode()
}
