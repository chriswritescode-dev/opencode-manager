import type { QueryClient } from '@tanstack/react-query'

interface InvalidateConfigCachesOptions {
  clearModelData?: boolean
}

export async function invalidateProviderCaches(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['provider-credentials'] }),
    queryClient.invalidateQueries({ queryKey: ['provider-auth-methods'] }),
    queryClient.invalidateQueries({ queryKey: ['providers'] }),
    queryClient.invalidateQueries({ queryKey: ['providers-with-models'] }),
    queryClient.invalidateQueries({ queryKey: ['opencode', 'providers'] }),
    queryClient.invalidateQueries({ queryKey: ['providers-for-execution-model'] }),
  ])
}

export async function invalidateConfigCaches(
  queryClient: QueryClient,
  options: InvalidateConfigCachesOptions = {}
): Promise<void> {
  if (options.clearModelData) {
    queryClient.removeQueries({ queryKey: ['providers-with-models'] })
    queryClient.removeQueries({ queryKey: ['opencode', 'providers'] })
    queryClient.removeQueries({ queryKey: ['opencode', 'config'] })
  }

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['opencode', 'config'] }),
    queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] }),
    queryClient.invalidateQueries({ queryKey: ['opencode-config'] }),
    queryClient.invalidateQueries({ queryKey: ['health'] }),
    queryClient.invalidateQueries({ queryKey: ['mcp-status'] }),
    queryClient.invalidateQueries({ queryKey: ['opencode-skills'] }),
    queryClient.invalidateQueries({ queryKey: ['managed-skills'] }),
    invalidateProviderCaches(queryClient),
  ])
}

export function invalidateSettingsCaches(queryClient: QueryClient, userId = 'default') {
  queryClient.invalidateQueries({ queryKey: ['settings', userId] })
  void invalidateConfigCaches(queryClient)
}

export function invalidateSessionCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === 'opencode' &&
      (query.queryKey[1] === 'sessions' ||
        query.queryKey[1] === 'session' ||
        query.queryKey[1] === 'messages'),
  })
}
