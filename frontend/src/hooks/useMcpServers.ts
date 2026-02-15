import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mcpApi } from '@/api/mcp'
import type { McpStatusMap, McpServerConfig } from '@/api/mcp'
import { showToast as toast } from '@/lib/toast'

const SESSION_QUERY_PREDICATE = (query: { queryKey: readonly unknown[] }) =>
  query.queryKey[0] === 'opencode' &&
  (query.queryKey[1] === 'sessions' || query.queryKey[1] === 'session' || query.queryKey[1] === 'messages')

export function useMcpServers() {
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: ['mcp-status'],
    queryFn: () => mcpApi.getStatus(),
    refetchInterval: 5000,
    staleTime: 2000,
  })

  const addServerMutation = useMutation({
    mutationFn: ({ name, config }: { name: string; config: McpServerConfig }) =>
      mcpApi.addServer(name, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      queryClient.invalidateQueries({ predicate: SESSION_QUERY_PREDICATE })
      toast.success('MCP server added successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to add MCP server: ${error.message}`)
    },
  })

  const connectMutation = useMutation({
    mutationFn: (name: string) => mcpApi.connect(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      queryClient.invalidateQueries({ predicate: SESSION_QUERY_PREDICATE })
      toast.success('MCP server connected')
    },
    onError: (error: Error) => {
      toast.error(`Failed to connect MCP server: ${error.message}`)
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: (name: string) => mcpApi.disconnect(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      queryClient.invalidateQueries({ predicate: SESSION_QUERY_PREDICATE })
      toast.success('MCP server disconnected')
    },
    onError: (error: Error) => {
      toast.error(`Failed to disconnect MCP server: ${error.message}`)
    },
  })

  const startAuthMutation = useMutation({
    mutationFn: ({ name, serverUrl, scope, clientId, clientSecret, directory }: { name: string; serverUrl: string; scope?: string; clientId?: string; clientSecret?: string; directory?: string }) =>
      mcpApi.startAuth(name, serverUrl, scope, clientId, clientSecret, directory),
    onError: (error: Error) => {
      toast.error(`Failed to start authentication: ${error.message}`)
    },
  })

  const completeAuthMutation = useMutation({
    mutationFn: ({ name, code }: { name: string; code: string }) =>
      mcpApi.completeAuth(name, code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      toast.success('Authentication completed')
    },
    onError: (error: Error) => {
      toast.error(`Failed to complete authentication: ${error.message}`)
    },
  })

  const removeAuthMutation = useMutation({
    mutationFn: (name: string) => mcpApi.removeAuth(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      queryClient.invalidateQueries({ predicate: SESSION_QUERY_PREDICATE })
      toast.success('Authentication credentials removed')
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove authentication: ${error.message}`)
    },
  })

  return {
    status: statusQuery.data as McpStatusMap | undefined,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    error: statusQuery.error,
    refetch: statusQuery.refetch,

    addServer: addServerMutation.mutate,
    addServerAsync: addServerMutation.mutateAsync,
    isAddingServer: addServerMutation.isPending,

    connect: connectMutation.mutate,
    connectAsync: connectMutation.mutateAsync,
    isConnecting: connectMutation.isPending,

    disconnect: disconnectMutation.mutate,
    disconnectAsync: disconnectMutation.mutateAsync,
    isDisconnecting: disconnectMutation.isPending,

    startAuth: startAuthMutation.mutate,
    startAuthAsync: startAuthMutation.mutateAsync,
    isStartingAuth: startAuthMutation.isPending,

    completeAuth: completeAuthMutation.mutate,
    completeAuthAsync: completeAuthMutation.mutateAsync,
    isCompletingAuth: completeAuthMutation.isPending,

    removeAuth: removeAuthMutation.mutate,
    removeAuthAsync: removeAuthMutation.mutateAsync,
    isRemovingAuth: removeAuthMutation.isPending,
  }
}
