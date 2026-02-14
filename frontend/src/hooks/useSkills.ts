import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { skillsApi, type CreateSkillRequest, type UpdateSkillRequest } from '@/api/skills'
import { showToast } from '@/lib/toast'

export const useSkills = (repoId: number | undefined) => {
  return useQuery({
    queryKey: ['skills', repoId],
    queryFn: () => skillsApi.listSkills(repoId!),
    enabled: !!repoId,
  })
}

export const useCreateSkill = (repoId: number | undefined) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateSkillRequest | FormData) => {
      return skillsApi.createSkill(repoId!, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills', repoId] })
      showToast.success('Skill created successfully')
    },
    onError: (error: unknown) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as { message: string }).message
        : 'Failed to create skill'
      showToast.error(message)
    },
  })
}

export const useUpdateSkill = (repoId: number | undefined) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ name, data }: { name: string; data: UpdateSkillRequest }) => {
      return skillsApi.updateSkill(repoId!, name, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills', repoId] })
      showToast.success('Skill updated successfully')
    },
    onError: (error: unknown) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as { message: string }).message
        : 'Failed to update skill'
      showToast.error(message)
    },
  })
}

export const useDeleteSkill = (repoId: number | undefined) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (name: string) => {
      return skillsApi.deleteSkill(repoId!, name)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills', repoId] })
      showToast.success('Skill deleted successfully')
    },
    onError: (error: unknown) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as { message: string }).message
        : 'Failed to delete skill'
      showToast.error(message)
    },
  })
}
