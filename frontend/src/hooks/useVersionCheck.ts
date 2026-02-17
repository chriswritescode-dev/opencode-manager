import { useQuery } from '@tanstack/react-query'
import { settingsApi, type VersionInfo } from '@/api/settings'

async function fetchVersionInfo(): Promise<VersionInfo> {
  return settingsApi.getVersionInfo()
}

export function useVersionCheck() {
  return useQuery({
    queryKey: ['version-check'],
    queryFn: fetchVersionInfo,
    staleTime: Infinity,
    retry: false,
  })
}
