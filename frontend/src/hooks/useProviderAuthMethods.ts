import { useQuery } from '@tanstack/react-query'
import { oauthApi } from '@/api/oauth'

interface UseProviderAuthMethodsOptions {
  enabled?: boolean
}

export function useProviderAuthMethods(options: UseProviderAuthMethodsOptions = {}) {
  return useQuery({
    queryKey: ['provider-auth-methods'],
    queryFn: () => oauthApi.getAuthMethods(),
    enabled: options.enabled ?? true,
  })
}
