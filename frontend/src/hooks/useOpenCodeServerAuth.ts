import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getOpenCodeServerAuth, updateOpenCodeServerAuth } from '@/api/settings'

export function useOpenCodeServerAuth() {
  const queryClient = useQueryClient()
  
  const query = useQuery({
    queryKey: ['settings', 'opencode-server-auth'],
    queryFn: getOpenCodeServerAuth,
  })

  const setPassword = useMutation({
    mutationFn: (password: string) => updateOpenCodeServerAuth(password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'opencode-server-auth'] })
    },
  })

  const clearPassword = useMutation({
    mutationFn: () => updateOpenCodeServerAuth(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'opencode-server-auth'] })
    },
  })

  return {
    status: query.data,
    isLoading: query.isLoading,
    setPassword,
    clearPassword,
  }
}
