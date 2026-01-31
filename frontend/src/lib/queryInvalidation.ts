import type { QueryClient } from '@tanstack/react-query'

export function invalidateConfigCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['opencode', 'config'] })
  queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
  queryClient.invalidateQueries({ queryKey: ['opencode-config'] })
  queryClient.invalidateQueries({ queryKey: ['health'] })
  queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
  queryClient.invalidateQueries({ queryKey: ['providers'] })
}

export function invalidateSettingsCaches(queryClient: QueryClient, userId = 'default') {
  queryClient.invalidateQueries({ queryKey: ['settings', userId] })
  invalidateConfigCaches(queryClient)
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

export function invalidateAllConfigRelatedCaches(queryClient: QueryClient, userId = 'default') {
  invalidateSettingsCaches(queryClient, userId)
  invalidateSessionCaches(queryClient)
}
