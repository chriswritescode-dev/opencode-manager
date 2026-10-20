import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listShells, removeShell } from '@/api/opencode'
import { applyShellExit, recordShellExit, reconcileShellList, type ShellRecord } from '@/lib/backgroundWork'
import { shellsQueryKey } from '@/lib/queryInvalidation'
import { serverScopedKey } from '@/lib/serverScope'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { showToast } from '@/lib/toast'

function useShellListQuery<TData = ShellRecord[]>(
  directory: string | undefined,
  enabled: boolean,
  select?: (shells: ShellRecord[]) => TData,
) {
  const serverId = useOpenCodeServerId()
  const queryClient = useQueryClient()
  const queryKey = serverScopedKey(shellsQueryKey(directory), serverId)

  return useQuery<ShellRecord[], Error, TData>({
    queryKey,
    queryFn: async (): Promise<ShellRecord[]> => {
      const fetchStartedAt = Date.now()
      const fetched = await listShells(directory ?? '', serverId)
      const existing = queryClient.getQueryData<ShellRecord[]>(queryKey) ?? []
      return reconcileShellList(existing, fetched, fetchStartedAt, directory ?? '')
    },
    enabled,
    staleTime: Infinity,
    select,
  })
}

export function useSessionShells(sessionID: string | undefined, directory: string | undefined) {
  const query = useShellListQuery(directory, Boolean(directory))

  const shells = useMemo(
    () => (query.data ?? []).filter((shell) => shell.metadata.sessionID === sessionID),
    [query.data, sessionID],
  )

  const listLoaded = query.isSuccess

  return { shells, listLoaded }
}

export function useShell(shellID: string | undefined, directory: string | undefined) {
  const query = useShellListQuery<ShellRecord | undefined>(
    directory,
    Boolean(directory && shellID),
    (shells) => shells.find((candidate) => candidate.id === shellID),
  )

  const listLoaded = query.isSuccess

  return { shell: query.data, listLoaded }
}

export function useKillShell(directory: string | undefined) {
  const serverId = useOpenCodeServerId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => removeShell(id, directory ?? '', serverId),
    onSuccess: (_result, id) => {
      recordShellExit(directory ?? '', { id, status: 'killed' })
      queryClient.setQueryData<ShellRecord[]>(serverScopedKey(shellsQueryKey(directory), serverId), (current) =>
        current && applyShellExit(current, { id, status: 'killed' }),
      )
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : 'Failed to kill shell command')
    },
  })
}
