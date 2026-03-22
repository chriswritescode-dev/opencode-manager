import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreatePromptTemplateRequest, UpdatePromptTemplateRequest } from '@opencode-manager/shared/types'
import {
  listPromptTemplates,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
} from '@/api/prompt-templates'
import { showToast } from '@/lib/toast'

export function usePromptTemplates() {
  return useQuery({
    queryKey: ['prompt-templates'],
    queryFn: async () => {
      const response = await listPromptTemplates()
      return response.templates
    },
  })
}

export function useCreatePromptTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreatePromptTemplateRequest) => createPromptTemplate(data).then(r => r.template),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompt-templates'] })
      showToast.success('Template created')
    },
    onError: (error) => {
      showToast.error(`Failed to create template: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useUpdatePromptTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdatePromptTemplateRequest }) =>
      updatePromptTemplate(id, data).then(r => r.template),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompt-templates'] })
      showToast.success('Template updated')
    },
    onError: (error) => {
      showToast.error(`Failed to update template: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useDeletePromptTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deletePromptTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompt-templates'] })
      showToast.success('Template deleted')
    },
    onError: (error) => {
      showToast.error(`Failed to delete template: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}
