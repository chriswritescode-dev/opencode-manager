import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listMemories,
  createMemory,
  getMemory,
  updateMemory,
  deleteMemory,
  getProjectSummary,
} from '@/api/memory'
import type { CreateMemoryRequest, UpdateMemoryRequest } from '@opencode-manager/shared/types'
import { showToast } from '@/lib/toast'

export function useMemories(filters?: {
  projectId?: string
  scope?: string
  content?: string
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: ['memories', filters?.projectId, filters?.scope, filters?.content],
    queryFn: () => listMemories(filters).then(r => r.memories),
    enabled: !!filters?.projectId,
  })
}

export function useMemory(id: number | undefined) {
  return useQuery({
    queryKey: ['memory', id],
    queryFn: () => {
      if (id === undefined) throw new Error('Memory ID required')
      return getMemory(id).then(r => r.memory)
    },
    enabled: id !== undefined,
  })
}

export function useCreateMemory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateMemoryRequest) => createMemory(data).then(r => r.memory),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories'] })
      queryClient.invalidateQueries({ queryKey: ['projectSummary'] })
      showToast.success('Memory created')
    },
    onError: (error) => {
      showToast.error(`Failed to create memory: ${error}`)
    },
  })
}

export function useUpdateMemory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateMemoryRequest }) =>
      updateMemory(id, data).then(r => r.memory),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories'] })
      showToast.success('Memory updated')
    },
    onError: (error) => {
      showToast.error(`Failed to update memory: ${error}`)
    },
  })
}

export function useDeleteMemory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deleteMemory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories'] })
      showToast.success('Memory deleted')
    },
    onError: (error) => {
      showToast.error(`Failed to delete memory: ${error}`)
    },
  })
}

export function useProjectSummary(repoId: number | undefined) {
  return useQuery({
    queryKey: ['projectSummary', repoId],
    queryFn: () => {
      if (repoId === undefined) throw new Error('Repo ID required')
      return getProjectSummary(repoId)
    },
    enabled: repoId !== undefined,
  })
}
