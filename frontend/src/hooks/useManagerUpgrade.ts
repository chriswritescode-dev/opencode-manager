import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'

export function useManagerUpgrade() {
  const queryClient = useQueryClient()

  const { data: status } = useQuery({
    queryKey: ['manager-upgrade-status'],
    queryFn: settingsApi.getManagerUpgradeStatus,
    refetchInterval: (q) => {
      const s = q.state.data?.job?.status
      return s === 'pulling' || s === 'recreating' ? 3000 : false
    },
  })

  const mutation = useMutation({
    mutationFn: () => settingsApi.startManagerUpgrade(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager-upgrade-status'] })
    },
  })

  return {
    status,
    isSupported: status?.supported ?? false,
    startUpgrade: mutation.mutateAsync,
    isUpgrading: mutation.isPending,
  }
}
