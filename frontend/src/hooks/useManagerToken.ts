import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getManagerToken, rotateManagerToken } from '@/api/settings'

export function useManagerToken() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['settings', 'manager-token'],
    queryFn: getManagerToken,
  })

  const rotate = useMutation({
    mutationFn: rotateManagerToken,
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'manager-token'], data)
    },
  })

  return {
    token: query.data?.token,
    isLoading: query.isLoading,
    rotate,
  }
}
