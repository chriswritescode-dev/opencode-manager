import { useQuery } from '@tanstack/react-query'
import { openCodeLocation } from '@opencode-manager/shared/opencode'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { findFiles } from '@/api/opencode'
import { useOpenCodeServerId } from '@/contexts/opencode-server-context'
import { serverScopedKey } from '@/lib/serverScope'

export interface FileSearchResult {
  files: string[]
  isLoading: boolean
  error: Error | null
}

export function useFileSearch(
  query: string,
  enabled: boolean = true,
  directory?: string
): FileSearchResult {
  const serverId = useOpenCodeServerId()
  const debouncedQuery = useDebouncedValue(query, 300)

  const { data, isLoading, error } = useQuery({
    queryKey: serverScopedKey(['file-search', debouncedQuery, directory], serverId),
    queryFn: () => findFiles({ ...openCodeLocation(directory), query: debouncedQuery }, serverId),
    enabled: enabled && !!debouncedQuery,
    staleTime: 60000,
  })

  return {
    files: data || [],
    isLoading,
    error
  }
}
