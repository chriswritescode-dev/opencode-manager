import { useQuery } from '@tanstack/react-query'
import { oauthApi } from '@/api/oauth'

interface UseProviderIntegrationsOptions {
  enabled?: boolean
}

export function useProviderIntegrations(options: UseProviderIntegrationsOptions = {}) {
  return useQuery({
    queryKey: ['provider-integrations'],
    queryFn: () => oauthApi.getIntegrations(),
    enabled: options.enabled ?? true,
  })
}
