import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ProjectConfigResponseSchema,
  RunProjectActionResponseSchema,
} from '@opencode-manager/shared/schemas'
import type {
  MoveProjectItemRequest,
  ProjectAction,
  ProjectConfigResponse,
  RunProjectActionResponse,
  TrustRepoConfigRequest,
} from '@opencode-manager/shared/types'
import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'

function projectConfigQueryKey(repoId: number, directory: string | undefined) {
  return ['projectConfig', repoId, directory ?? null] as const
}

export function getProjectConfig(repoId: number, directory?: string): Promise<ProjectConfigResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/project-config`, ProjectConfigResponseSchema, {
    params: { directory },
  })
}

function updateProjectActions(
  repoId: number,
  actions: ProjectAction[],
  directory?: string,
): Promise<ProjectConfigResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/project-config/actions`, ProjectConfigResponseSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actions }),
    params: { directory },
  })
}

function updateWorktreeSetup(
  repoId: number,
  commands: string[],
  directory?: string,
): Promise<ProjectConfigResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/project-config/worktree-setup`, ProjectConfigResponseSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
    params: { directory },
  })
}

function trustRepoConfig(repoId: number, request: TrustRepoConfigRequest): Promise<ProjectConfigResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/project-config/trust`, ProjectConfigResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

function moveProjectItem(repoId: number, request: MoveProjectItemRequest): Promise<ProjectConfigResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/project-config/move`, ProjectConfigResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

function runProjectAction(
  repoId: number,
  actionId: string,
  directory?: string,
): Promise<RunProjectActionResponse> {
  return fetchWrapper(
    `${API_BASE_URL}/api/repos/${repoId}/project-config/actions/${encodeURIComponent(actionId)}/run`,
    RunProjectActionResponseSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory }),
    },
  )
}

export function useProjectConfig(repoId: number, directory: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: projectConfigQueryKey(repoId, directory),
    queryFn: () => getProjectConfig(repoId, directory),
    enabled,
  })
}

export function useUpdateProjectActions(repoId: number, directory: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (actions: ProjectAction[]) => updateProjectActions(repoId, actions, directory),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectConfigQueryKey(repoId, directory) })
    },
  })
}

export function useUpdateWorktreeSetup(repoId: number, directory: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commands: string[]) => updateWorktreeSetup(repoId, commands, directory),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectConfigQueryKey(repoId, directory) })
    },
  })
}

export function useTrustRepoConfig(repoId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: TrustRepoConfigRequest) => trustRepoConfig(repoId, request),
    onSuccess: (_data, request) => {
      queryClient.invalidateQueries({ queryKey: projectConfigQueryKey(repoId, request.directory) })
    },
  })
}

export function useMoveProjectItem(repoId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: MoveProjectItemRequest) => moveProjectItem(repoId, request),
    onSuccess: (_data, request) => {
      queryClient.invalidateQueries({ queryKey: projectConfigQueryKey(repoId, request.directory) })
    },
  })
}

export function useRunProjectAction(repoId: number, directory: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (actionId: string) => runProjectAction(repoId, actionId, directory),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectConfigQueryKey(repoId, directory) })
      queryClient.invalidateQueries({ queryKey: ['terminals', repoId] })
    },
  })
}
