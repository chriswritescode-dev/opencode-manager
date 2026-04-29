import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import type { OpenCodeServerAuthSettings, UpdateOpenCodeServerAuthSettings } from '@/api/types/settings'

export function useOpenCodeServerAuthSettings() {
  const queryClient = useQueryClient()

  const { data: settings, isLoading, error } = useQuery<OpenCodeServerAuthSettings>({
    queryKey: ['settings', 'opencode-server-auth'],
    queryFn: () => settingsApi.getOpenCodeServerAuthSettings(),
  })

  const mutation = useMutation({
    mutationFn: (request: UpdateOpenCodeServerAuthSettings) =>
      settingsApi.updateOpenCodeServerAuthSettings(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'opencode-server-auth'] })
    },
  })

  return {
    settings,
    isLoading,
    error,
    updateAuthSettingsAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  }
}
