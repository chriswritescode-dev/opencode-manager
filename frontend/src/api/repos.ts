import type { Repo } from './types'
import { FetchError, fetchWrapper, fetchWrapperVoid, fetchWrapperBlob } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import { saveFile } from '@/lib/download'
import { z } from 'zod'
import {
  AssistantModeStatusSchema,
  DeleteRepoResultSchema,
  DiscoverReposResponseSchema,
  RepoGitIdentitySchema,
  RepoSchema,
  WorktreeSetupResultSchema,
} from '@opencode-manager/shared/schemas'
import type { CreateRepoWorkspaceRequest, DiscoverReposResponse, AssistantModeStatus, AssistantModeInitRequest, DeleteRepoRequest, DeleteRepoResult, RepoGitIdentity, WorktreeSetupResult } from '@opencode-manager/shared/types'
import type { RepoSibling } from '@opencode-manager/shared/utils'
import { formatScheduleWorktreeLabel } from '@/lib/schedules/schedule-worktree'

export type { RepoSibling } from '@opencode-manager/shared/utils'

const repoSchemaBase = RepoSchema.extend({
  currentBranch: z.string().optional(),
  worktreeSetup: WorktreeSetupResultSchema.optional(),
})

const repoSchema: z.ZodType<Repo> = repoSchemaBase

const repoListSchema = z.array(repoSchema)

const repoWorktreeScheduleSchema = z.object({
  repoId: z.number(),
  jobId: z.number(),
  runId: z.number().nullable(),
  inUse: z.boolean(),
  name: z.string(),
})

const repoSiblingSchema: z.ZodType<RepoSibling> = repoSchemaBase.extend({
  currentBranch: z.string().optional(),
  worktreeSource: z.enum(['opencode', 'schedule', 'git']).optional(),
  schedule: repoWorktreeScheduleSchema.optional(),
})

const repoSiblingListSchema = z.array(repoSiblingSchema)

const repoWorktreeSetupResponseSchema: z.ZodType<RepoWorktree & { worktreeSetup?: WorktreeSetupResult }> = z.object({
  directory: z.string(),
  worktreeSetup: WorktreeSetupResultSchema.optional(),
})

const gitBranchSchema = z.object({
  name: z.string(),
  type: z.enum(['local', 'remote']),
  current: z.boolean(),
  upstream: z.string().optional(),
  ahead: z.number().optional(),
  behind: z.number().optional(),
  isWorktree: z.boolean().optional(),
})

const branchListResponseSchema: z.ZodType<{ branches: GitBranch[]; status: { ahead: number; behind: number } }> = z.object({
  branches: z.array(gitBranchSchema),
  status: z.object({ ahead: z.number(), behind: z.number() }),
})

export interface CreateRepoOptions {
  repoUrl?: string
  localPath?: string
  branch?: string
  directoryName?: string
  useWorktree?: boolean
  skipSSHVerification?: boolean
  baseBranch?: string
}

export async function createRepo(options: CreateRepoOptions = {}): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos`, repoSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })
}

export async function listRepos(): Promise<Repo[]> {
  return fetchWrapper(`${API_BASE_URL}/api/repos`, repoListSchema)
}

export async function discoverRepos(rootPath: string, maxDepth?: number): Promise<DiscoverReposResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/discover`, DiscoverReposResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootPath, maxDepth }),
  })
}

export async function getRepo(id: number): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}`, repoSchema)
}


export function workspaceLabel(workspace: RepoSibling): string {
  return workspace.currentBranch || workspace.branch || workspace.localPath || 'worktree'
}

export function worktreeSourceLabel(worktree: RepoSibling): string | null {
  if (worktree.schedule) {
    return `Schedule · ${formatScheduleWorktreeLabel(worktree.schedule.runId)}`
  }
  if (worktree.worktreeSource === 'git') return 'Git'
  return worktree.worktreeSource === 'opencode' ? 'OpenCode' : null
}

export interface RepoWorktree {
  directory: string
}

export async function getRepoSiblings(id: number): Promise<RepoSibling[]> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/siblings`, repoSiblingListSchema)
}

export async function deleteRepoWorkspace(repoId: number, directory: string): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/${repoId}/workspaces`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directory }),
  })
}

export async function createRepoWorkspace(repoId: number, request: CreateRepoWorkspaceRequest = {}): Promise<RepoWorktree & { worktreeSetup?: WorktreeSetupResult }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/workspaces`, repoWorktreeSetupResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export type DeleteBranchChoice = NonNullable<DeleteRepoRequest['deleteBranch']>

export interface DeleteRepoOptions {
  deleteBranch?: DeleteBranchChoice
}

export async function deleteRepo(id: number, options?: DeleteRepoOptions): Promise<DeleteRepoResult> {
  const request: RequestInit = { method: 'DELETE' }
  if (options) {
    request.headers = { 'Content-Type': 'application/json' }
    request.body = JSON.stringify(options)
  }
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}`, DeleteRepoResultSchema, request)
}

export async function updateRepoGitCredential(id: number, credentialId?: string): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/git-credential`, repoSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentialId }),
  })
}

export async function getRepoGitIdentity(id: number): Promise<RepoGitIdentity> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/git-identity`, RepoGitIdentitySchema)
}

export async function updateRepoGitIdentity(id: number, identityId: string | null): Promise<RepoGitIdentity> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/git-identity`, RepoGitIdentitySchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityId }),
  })
}

export async function renameRepo(id: number, name: string | null): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}`, repoSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name ?? '' }),
  })
}

export class GitAuthError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'GitAuthError'
    this.code = code
  }
}

export async function switchBranch(id: number, branch: string): Promise<Repo> {
  try {
    return await fetchWrapper(`${API_BASE_URL}/api/repos/${id}/branch/switch`, repoSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    })
  } catch (error) {
    if (error instanceof FetchError && error.code === 'AUTH_FAILED') {
      throw new GitAuthError(error.message, error.code)
    }
    throw error
  }
}

export interface GitBranch {
  name: string
  type: 'local' | 'remote'
  current: boolean
  upstream?: string
  ahead?: number
  behind?: number
  isWorktree?: boolean
}

export async function listBranches(id: number): Promise<{ branches: GitBranch[], status: { ahead: number, behind: number } }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/git/branches`, branchListResponseSchema)
}

export async function createBranch(id: number, branch: string): Promise<Repo> {
  try {
    return await fetchWrapper(`${API_BASE_URL}/api/repos/${id}/branch/create`, repoSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    })
  } catch (error) {
    if (error instanceof FetchError && error.code === 'AUTH_FAILED') {
      throw new GitAuthError(error.message, error.code)
    }
    throw error
  }
}

export interface DownloadOptions {
  includeGit?: boolean
  includePaths?: string[]
}

export async function downloadRepo(id: number, repoName: string, options?: DownloadOptions): Promise<void> {
  const params = new URLSearchParams()
  if (options?.includeGit) params.append('includeGit', 'true')
  if (options?.includePaths?.length) params.append('includePaths', options.includePaths.join(','))

  const url = `${API_BASE_URL}/api/repos/${id}/download${params.toString() ? '?' + params.toString() : ''}`
  
  const blob = await fetchWrapperBlob(url)
  await saveFile(blob, `${repoName}.zip`)
}

export async function updateRepoOrder(order: number[]): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  })
}

export async function resetRepoPermissions(id: number): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/${id}/reset-permissions`, {
    method: 'POST',
  })
}

export async function touchRepoActivity(id: number): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/${id}/access`, {
    method: 'POST',
  })
}

export async function getAssistantModeStatus(id: number): Promise<AssistantModeStatus> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/assistant-mode`, AssistantModeStatusSchema, {
    method: 'GET',
  })
}

export async function initializeAssistantMode(
  id: number,
  options?: AssistantModeInitRequest
): Promise<AssistantModeStatus> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/assistant-mode`, AssistantModeStatusSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options ?? {}),
  })
}
