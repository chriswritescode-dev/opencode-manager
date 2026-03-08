import { useQuery } from '@tanstack/react-query'
import { useOpenCodeClient } from './useOpenCode'

export function useLSPStatus(opcodeUrl: string | null | undefined, directory?: string) {
  const client = useOpenCodeClient(opcodeUrl, directory)

  return useQuery({
    queryKey: ['opencode', 'lsp', opcodeUrl, directory],
    queryFn: () => client!.getLSPStatus(),
    enabled: !!client,
    refetchInterval: 30000,
    staleTime: 10000,
    refetchOnWindowFocus: true,
  })
}
