import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listShells, removeShell } from '@/api/opencode'
import { reconcileShellList, type ShellRecord } from '@/lib/backgroundWork'
import { shellsQueryKey } from '@/lib/queryInvalidation'
import { showToast } from '@/lib/toast'

function useShellListQuery(directory: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: shellsQueryKey(directory),
    queryFn: async () => {
      const fetchStartedAt = Date.now()
      const fetched = await listShells(directory ?? '')
      const existing = queryClient.getQueryData<ShellRecord[]>(shellsQueryKey(directory)) ?? []
      return reconcileShellList(existing, fetched, fetchStartedAt, directory ?? '')
    },
    enabled,
    staleTime: Infinity,
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
  const query = useShellListQuery(directory, Boolean(directory && shellID))

  const shell = useMemo(
    () => (query.data ?? []).find((candidate) => candidate.id === shellID),
    [query.data, shellID],
  )

  const listLoaded = query.isSuccess

  return { shell, listLoaded }
}

export function useKillShell(directory: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => removeShell(id, directory ?? ''),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<ShellRecord[]>(shellsQueryKey(directory), (current) =>
        current?.map((shell) =>
          shell.id === id
            ? { ...shell, status: 'killed', time: { ...shell.time, completed: shell.time.completed ?? Date.now() } }
            : shell,
        ),
      )
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : 'Failed to kill shell command')
    },
  })
}
