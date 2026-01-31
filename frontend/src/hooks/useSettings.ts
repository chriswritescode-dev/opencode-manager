import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import type { UserPreferences } from '@/api/types/settings'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'

export function useSettings(userId = 'default') {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['settings', userId],
    queryFn: () => settingsApi.getSettings(userId),
    staleTime: 1000 * 60 * 5,
  })

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<UserPreferences>) =>
      settingsApi.updateSettings({ preferences: updates }, userId),
    onMutate: async (updates) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['settings', userId] })
      
      // Snapshot current value
      const previousData = queryClient.getQueryData(['settings', userId])
      
      // Optimistically update cache immediately
      queryClient.setQueryData(['settings', userId], (old: typeof data) => {
        if (!old) return old
        return {
          ...old,
          preferences: {
            ...old.preferences,
            ...updates,
          },
          updatedAt: Date.now(),
        }
      })
      
      return { previousData }
    },
    onError: (_err, _updates, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(['settings', userId], context.previousData)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', userId] })
      invalidateConfigCaches(queryClient)
    },
  })

  const resetMutation = useMutation({
    mutationFn: () => settingsApi.resetSettings(userId),
    onSuccess: (newData) => {
      queryClient.setQueryData(['settings', userId], newData)
    },
  })

  return {
    settings: data,
    preferences: data?.preferences,
    isLoading,
    error,
    updateSettings: updateMutation.mutate,
    updateSettingsAsync: updateMutation.mutateAsync,
    resetSettings: resetMutation.mutate,
    isUpdating: updateMutation.isPending,
    isResetting: resetMutation.isPending,
  }
}
