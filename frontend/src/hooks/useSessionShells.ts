import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listShells, removeShell, type ShellInfo } from '@/api/opencode'
import { shellsQueryKey } from '@/lib/queryInvalidation'
import { showToast } from '@/lib/toast'

export function useSessionShells(sessionID: string | undefined, directory: string | undefined) {
  const query = useQuery({
    queryKey: shellsQueryKey(directory),
    queryFn: () => listShells(directory ?? ''),
    enabled: Boolean(directory),
    staleTime: Infinity,
  })

  const shells = useMemo(
    () =>
      (query.data ?? []).filter(
        (shell) => shell.status === 'running' && shell.metadata.sessionID === sessionID,
      ),
    [query.data, sessionID],
  )

  return shells
}

export function useKillShell(directory: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => removeShell(id, directory ?? ''),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<ShellInfo[]>(shellsQueryKey(directory), (current) =>
        current?.filter((shell) => shell.id !== id),
      )
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : 'Failed to kill shell command')
    },
  })
}
