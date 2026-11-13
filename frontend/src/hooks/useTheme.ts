import { useThemeMode } from '@/contexts/theme-context'
import { getDocumentThemeMode } from '@/lib/theme/colorTheme'

export function useTheme(): 'light' | 'dark' {
  const contextMode = useThemeMode()
  return contextMode ?? getDocumentThemeMode()
}
