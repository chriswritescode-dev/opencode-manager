import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateOpenCodeServerRequest,
  OpenCodeServerStatus,
  TestOpenCodeServerRequest,
  UpdateOpenCodeServerRequest,
} from '@opencode-manager/shared/schemas'
import {
  createOpenCodeServer,
  deleteOpenCodeServer,
  listOpenCodeServers,
  listOpenCodeServerStatuses,
  testOpenCodeServer,
  testOpenCodeServerById,
  updateOpenCodeServer,
} from '@/api/opencodeServers'

const OPENCODE_SERVERS_QUERY_KEY = ['opencode-servers']
const OPENCODE_SERVER_STATUSES_QUERY_KEY = ['opencode-server-statuses']
const SERVER_STATUS_POLL_INTERVAL_MS = 15000

export function useOpenCodeServers(options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const serversQuery = useQuery({
    queryKey: OPENCODE_SERVERS_QUERY_KEY,
    queryFn: listOpenCodeServers,
    enabled: options.enabled ?? true,
  })

  const invalidateServers = () => {
    queryClient.invalidateQueries({ queryKey: OPENCODE_SERVERS_QUERY_KEY })
  }

  const createMutation = useMutation({
    mutationFn: (input: CreateOpenCodeServerRequest) => createOpenCodeServer(input),
    onSuccess: invalidateServers,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateOpenCodeServerRequest }) =>
      updateOpenCodeServer(id, input),
    onSuccess: invalidateServers,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOpenCodeServer(id),
    onSuccess: invalidateServers,
  })

  const testMutation = useMutation({
    mutationFn: (input: TestOpenCodeServerRequest) => testOpenCodeServer(input),
  })

  const testByIdMutation = useMutation({
    mutationFn: (id: string) => testOpenCodeServerById(id),
  })

  return {
    servers: serversQuery.data ?? [],
    isLoading: serversQuery.isLoading,
    isSuccess: serversQuery.isSuccess,
    error: serversQuery.error,
    refetch: serversQuery.refetch,
    createAsync: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    updateAsync: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    deleteAsync: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    testAsync: testMutation.mutateAsync,
    testByIdAsync: testByIdMutation.mutateAsync,
  }
}

export function useOpenCodeServerStatuses(options: { enabled?: boolean } = {}) {
  const statusesQuery = useQuery({
    queryKey: OPENCODE_SERVER_STATUSES_QUERY_KEY,
    queryFn: listOpenCodeServerStatuses,
    refetchInterval: SERVER_STATUS_POLL_INTERVAL_MS,
    retry: false,
    enabled: options.enabled ?? true,
  })

  const statusById = (statusesQuery.data ?? []).reduce<Record<string, OpenCodeServerStatus>>(
    (byId, status) => {
      byId[status.serverId] = status
      return byId
    },
    {},
  )

  return {
    statuses: statusesQuery.data ?? [],
    statusById,
    isLoading: statusesQuery.isLoading,
    error: statusesQuery.error,
    refetch: statusesQuery.refetch,
  }
}
