import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mcpApi } from '@/api/mcp'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { invalidateSessionCaches } from '@/lib/queryInvalidation'
import { serverScopedKey } from '@/lib/serverScope'
import { showToast as toast } from '@/lib/toast'

export function useMcpServers() {
  const queryClient = useQueryClient()
  const serverId = useOpenCodeServerId()
  const statusQueryKey = serverScopedKey(['mcp-status'], serverId)

  const statusQuery = useQuery({
    queryKey: statusQueryKey,
    queryFn: () => mcpApi.getStatus(undefined, serverId),
    refetchInterval: 5000,
    staleTime: 2000,
  })

  const connectMutation = useMutation({
    mutationFn: (name: string) => mcpApi.connect(name, undefined, serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      invalidateSessionCaches(queryClient)
      toast.success('MCP server connected')
    },
    onError: (error: Error) => {
      toast.error(`Failed to connect MCP server: ${error.message}`)
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: (name: string) => mcpApi.disconnect(name, undefined, serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      invalidateSessionCaches(queryClient)
      toast.success('MCP server disconnected')
    },
    onError: (error: Error) => {
      toast.error(`Failed to disconnect MCP server: ${error.message}`)
    },
  })

  const startAuthMutation = useMutation({
    mutationFn: ({ name, directory }: { name: string; directory?: string }) =>
      mcpApi.startAuth(name, directory),
    onError: (error: Error) => {
      toast.error(`Failed to start authentication: ${error.message}`)
    },
  })

  const removeAuthMutation = useMutation({
    mutationFn: (name: string) => mcpApi.removeAuth(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      invalidateSessionCaches(queryClient)
      toast.success('Authentication credentials removed')
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove authentication: ${error.message}`)
    },
  })

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    error: statusQuery.error,
    refetch: statusQuery.refetch,

    connect: connectMutation.mutate,
    connectAsync: connectMutation.mutateAsync,
    isConnecting: connectMutation.isPending,

    disconnect: disconnectMutation.mutate,
    disconnectAsync: disconnectMutation.mutateAsync,
    isDisconnecting: disconnectMutation.isPending,

    startAuth: startAuthMutation.mutate,
    startAuthAsync: startAuthMutation.mutateAsync,
    isStartingAuth: startAuthMutation.isPending,

    removeAuth: removeAuthMutation.mutate,
    removeAuthAsync: removeAuthMutation.mutateAsync,
    isRemovingAuth: removeAuthMutation.isPending,
  }
}
