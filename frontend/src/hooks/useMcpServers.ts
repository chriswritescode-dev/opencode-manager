import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mcpApi } from '@/api/mcp'
import type { McpStatusMap, McpServerConfig, McpStatus } from '@/api/mcp'
import { showToast as toast } from '@/lib/toast'

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
      toast.success('MCP server disconnected')
    },
    onError: (error: Error) => {
      toast.error(`Failed to disconnect MCP server: ${error.message}`)
    },
  })

  const startAuthMutation = useMutation({
    mutationFn: (name: string) => mcpApi.startAuth(name),
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

  const authenticateMutation = useMutation({
    mutationFn: (name: string) => mcpApi.authenticate(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      toast.success('Authentication completed')
    },
    onError: (error: Error) => {
      toast.error(`Failed to authenticate: ${error.message}`)
    },
  })

  const removeAuthMutation = useMutation({
    mutationFn: (name: string) => mcpApi.removeAuth(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      toast.success('Authentication credentials removed')
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove authentication: ${error.message}`)
    },
  })

  const toggleServer = async (name: string, currentStatus: McpStatus) => {
    if (currentStatus.status === 'connected') {
      return disconnectMutation.mutateAsync(name)
    } else if (currentStatus.status === 'disabled') {
      return connectMutation.mutateAsync(name)
    } else if (currentStatus.status === 'needs_auth') {
      return authenticateMutation.mutateAsync(name)
    }
  }

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

    toggleServer,
    isToggling: connectMutation.isPending || disconnectMutation.isPending || authenticateMutation.isPending,

    startAuth: startAuthMutation.mutate,
    startAuthAsync: startAuthMutation.mutateAsync,
    isStartingAuth: startAuthMutation.isPending,

    completeAuth: completeAuthMutation.mutate,
    completeAuthAsync: completeAuthMutation.mutateAsync,
    isCompletingAuth: completeAuthMutation.isPending,

    authenticate: authenticateMutation.mutate,
    authenticateAsync: authenticateMutation.mutateAsync,
    isAuthenticating: authenticateMutation.isPending,

    removeAuth: removeAuthMutation.mutate,
    removeAuthAsync: removeAuthMutation.mutateAsync,
    isRemovingAuth: removeAuthMutation.isPending,
  }
}
