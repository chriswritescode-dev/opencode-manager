import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import type { OpenCodeConfigFile } from '@/api/types/settings'

export const OPEN_CODE_CONFIG_QUERY_KEY = ['opencode-config', 'file'] as const

export function useOpenCodeConfigFile(enabled = true) {
  return useQuery<OpenCodeConfigFile>({
    queryKey: OPEN_CODE_CONFIG_QUERY_KEY,
    queryFn: () => settingsApi.getOpenCodeConfig(),
    enabled,
  })
}
