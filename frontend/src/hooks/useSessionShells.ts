import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listShells, removeShell } from '@/api/opencode'
import { applyShellExit, recordShellExit, reconcileShellList, type ShellRecord } from '@/lib/backgroundWork'
import { shellsQueryKey } from '@/lib/queryInvalidation'
import { showToast } from '@/lib/toast'

function useShellListQuery<TData = ShellRecord[]>(
  directory: string | undefined,
  enabled: boolean,
  select?: (shells: ShellRecord[]) => TData,
) {
  const queryClient = useQueryClient()

  return useQuery<ShellRecord[], Error, TData>({
    queryKey: shellsQueryKey(directory),
    queryFn: async (): Promise<ShellRecord[]> => {
      const fetchStartedAt = Date.now()
      const fetched = await listShells(directory ?? '')
      const existing = queryClient.getQueryData<ShellRecord[]>(shellsQueryKey(directory)) ?? []
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
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => removeShell(id, directory ?? ''),
    onSuccess: (_result, id) => {
      recordShellExit(directory ?? '', { id, status: 'killed' })
      queryClient.setQueryData<ShellRecord[]>(shellsQueryKey(directory), (current) =>
        current && applyShellExit(current, { id, status: 'killed' }),
      )
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : 'Failed to kill shell command')
    },
  })
}
