import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import { OPEN_CODE_MANAGED_CONFIG_QUERY_KEY } from '@/lib/queryInvalidation'
import type { ManagedOpenCodeConfig } from '@/api/types/settings'

export function useOpenCodeManagedConfig() {
  return useQuery<ManagedOpenCodeConfig>({
    queryKey: OPEN_CODE_MANAGED_CONFIG_QUERY_KEY,
    queryFn: () => settingsApi.getManagedOpenCodeConfig(),
  })
}
