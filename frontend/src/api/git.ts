import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { fetchWrapper, FetchError } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import {
  DeleteBranchResultSchema,
  GitOperationStateSchema,
  GitStashEntrySchema,
  IntegrateBranchResultSchema,
} from '@opencode-manager/shared/schemas'
import type { DeleteBranchRequest, DeleteBranchResult, GitStashEntry, IntegrateBranchRequest, IntegrateBranchResult, RenameBranchRequest, StashApplyRequest, StashDropRequest, StashPushRequest } from '@opencode-manager/shared'
import type { GitStatusResponse, FileDiffResponse, GitCommit, CommitDetails } from '@/types/git'

const gitFileStatusTypeSchema = z.enum(['modified', 'added', 'deleted', 'renamed', 'untracked', 'copied'])

const gitFileStatusSchema = z.object({
  path: z.string(),
  status: gitFileStatusTypeSchema,
  staged: z.boolean(),
  oldPath: z.string().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
})

const gitStatusResponseSchema: z.ZodType<GitStatusResponse> = z.object({
  branch: z.string(),
  ahead: z.number(),
  behind: z.number(),
  files: z.array(gitFileStatusSchema),
  hasChanges: z.boolean(),
  operation: GitOperationStateSchema.nullable(),
})

const fileDiffResponseSchema: z.ZodType<FileDiffResponse> = z.object({
  path: z.string(),
  status: gitFileStatusTypeSchema,
  diff: z.string().nullable(),
  additions: z.number(),
  deletions: z.number(),
  isBinary: z.boolean(),
  truncated: z.boolean().optional(),
})

const gitCommitBaseSchema = z.object({
  hash: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  date: z.string(),
  message: z.string(),
  unpushed: z.boolean().optional(),
})

const commitFileSchema = z.object({
  path: z.string(),
  status: gitFileStatusTypeSchema,
  oldPath: z.string().optional(),
  additions: z.number(),
  deletions: z.number(),
})

const gitCommitSchema: z.ZodType<GitCommit> = gitCommitBaseSchema

const commitDetailsSchema: z.ZodType<CommitDetails> = gitCommitBaseSchema.extend({
  files: z.array(commitFileSchema),
})

const gitLogResponseSchema = z.object({ commits: z.array(gitCommitSchema) })
const gitStashesResponseSchema = z.object({ stashes: z.array(GitStashEntrySchema) })
const commitMessageResponseSchema = z.object({ message: z.string() })
const deleteBranchResponseSchema = DeleteBranchResultSchema.extend({ status: gitStatusResponseSchema })
const integrateBranchResponseSchema = IntegrateBranchResultSchema.extend({ targetStatus: gitStatusResponseSchema })

export async function fetchGitStatus(repoId: number): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/status`, gitStatusResponseSchema)
}

export async function fetchReposGitStatus(repoIds: number[]): Promise<Map<number, GitStatusResponse>> {
  const data = await fetchWrapper(`${API_BASE_URL}/api/repos/git-status-batch`, z.record(z.string(), gitStatusResponseSchema), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoIds })
  })
  return new Map(Object.entries(data).map(([id, status]) => [Number(id), status]))
}

export async function fetchFileDiff(repoId: number, path: string, includeStaged?: boolean): Promise<FileDiffResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/diff-full`, fileDiffResponseSchema, {
    params: { path, includeStaged },
  })
}

export async function fetchCommitFileDiff(repoId: number, commitHash: string, path: string): Promise<FileDiffResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/commit/${commitHash}/diff`, fileDiffResponseSchema, {
    params: { path },
  })
}

export async function fetchGitDiff(repoId: number, path: string): Promise<{ diff: string }> {
  const data = await fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/diff`, z.string(), {
    params: { path },
  })
  return { diff: data }
}

export async function fetchGitLog(repoId: number, limit?: number, branch?: string): Promise<{ commits: GitCommit[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/log`, gitLogResponseSchema, {
    params: { limit, branch },
  })
}

export async function fetchCommitDetails(repoId: number, hash: string): Promise<CommitDetails> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/commit/${hash}`, commitDetailsSchema)
}

export async function gitFetch(repoId: number): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/fetch`, gitStatusResponseSchema, {
    method: 'POST',
  })
}

export async function gitPull(repoId: number): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/pull`, gitStatusResponseSchema, {
    method: 'POST',
  })
}

export async function gitPush(repoId: number, setUpstream: boolean = false): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/push`, gitStatusResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setUpstream }),
  })
}

export async function gitCommit(repoId: number, message: string, stagedPaths?: string[]): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/commit`, gitStatusResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, stagedPaths }),
  })
}

export async function gitGenerateCommitMessage(repoId: number): Promise<{ message: string }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/commit-message`, commitMessageResponseSchema, {
    method: 'POST',
  })
}

export async function gitStageFiles(repoId: number, paths: string[]): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/stage`, gitStatusResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
}

export async function gitUnstageFiles(repoId: number, paths: string[]): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/unstage`, gitStatusResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
}

export async function gitDiscardFiles(repoId: number, paths: string[], staged: boolean): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/discard`, gitStatusResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, staged }),
  })
}

export async function gitReset(repoId: number, commitHash: string): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/reset`, gitStatusResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commitHash }),
  })
}

export async function gitRenameBranch(repoId: number, request: RenameBranchRequest): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/branches/rename`, gitStatusResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function gitDeleteBranch(
  repoId: number,
  request: DeleteBranchRequest
): Promise<DeleteBranchResult & { status: GitStatusResponse }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/branches`, deleteBranchResponseSchema, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

async function fetchGitStashes(repoId: number): Promise<{ stashes: GitStashEntry[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/stash`, gitStashesResponseSchema)
}

export async function gitStashPush(repoId: number, request: StashPushRequest): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/stash`, gitStatusResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function gitStashApply(repoId: number, index: number, request: StashApplyRequest): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/stash/${index}/apply`, gitStatusResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function gitStashDrop(repoId: number, index: number, request: StashDropRequest): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/stash/${index}`, gitStatusResponseSchema, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function gitContinueOperation(repoId: number): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/operation/continue`, gitStatusResponseSchema, {
    method: 'POST',
  })
}

export async function gitAbortOperation(repoId: number): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/operation/abort`, gitStatusResponseSchema, {
    method: 'POST',
  })
}

export async function gitIntegrateBranch(
  repoId: number,
  request: IntegrateBranchRequest
): Promise<IntegrateBranchResult & { targetStatus: GitStatusResponse }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/integrate`, integrateBranchResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

interface GitStatusQueryOptions {
  refetchInterval?: number | false
}

export function useGitStatus(repoId: number | undefined, options: GitStatusQueryOptions = {}) {
  return useQuery({
    queryKey: ['gitStatus', repoId],
    queryFn: () => repoId ? fetchGitStatus(repoId) : Promise.reject(new Error('No repo ID')),
    enabled: !!repoId,
    refetchInterval: options.refetchInterval ?? false,
  })
}

export function useGitStashes(repoId: number | undefined) {
  return useQuery({
    queryKey: ['gitStashes', repoId],
    queryFn: () => repoId ? fetchGitStashes(repoId) : Promise.reject(new Error('No repo ID')),
    enabled: !!repoId,
  })
}

export function useFileDiff(repoId: number | undefined, path: string | undefined, includeStaged?: boolean) {
  return useQuery({
    queryKey: ['fileDiff', repoId, path, includeStaged],
    queryFn: () => (repoId && path) ? fetchFileDiff(repoId, path, includeStaged) : Promise.reject(new Error('Missing params')),
    enabled: !!repoId && !!path,
  })
}

export function useCommitFileDiff(repoId: number | undefined, commitHash: string | undefined, path: string | undefined) {
  return useQuery({
    queryKey: ['commitFileDiff', repoId, commitHash, path],
    queryFn: () => (repoId && commitHash && path) ? fetchCommitFileDiff(repoId, commitHash, path) : Promise.reject(new Error('Missing params')),
    enabled: !!repoId && !!commitHash && !!path,
  })
}

export function useGitLog(repoId: number | undefined, limit?: number, branch?: string) {
  return useQuery({
    queryKey: ['gitLog', repoId, limit, branch],
    queryFn: () => repoId ? fetchGitLog(repoId, limit, branch) : Promise.reject(new Error('No repo ID')),
    enabled: !!repoId,
  })
}

export function useCommitDetails(repoId: number | undefined, hash: string | undefined) {
  return useQuery({
    queryKey: ['commitDetails', repoId, hash],
    queryFn: () => (repoId && hash) ? fetchCommitDetails(repoId, hash) : Promise.reject(new Error('Missing params')),
    enabled: !!repoId && !!hash,
  })
}

function parseGitErrorMessage(message: string): string {
  if (message.includes('no upstream') || message.includes('does not have any commits yet')) {
    return 'No upstream branch configured. Push with --set-upstream or create commits first.'
  }
  if (message.includes('non-fast-forward') || message.includes('rejected')) {
    return 'Push rejected. Pull changes first, then push again.'
  }
  if (message.includes('CONFLICT') || message.includes('Merge conflict')) {
    return 'Merge conflict detected. Resolve conflicts before continuing.'
  }
  if (message.includes('Authentication failed') || message.includes('could not read Username')) {
    return 'Git authentication failed. Check your credentials in Settings.'
  }
  if (message.includes('Permission denied')) {
    return 'Permission denied. Check your repository access.'
  }
  if (message.includes('not a git repository')) {
    return 'Not a valid Git repository.'
  }
  return message
}

const gitErrorBodySchema = z.object({
  message: z.string().optional(),
  error: z.string().optional(),
})

export function getApiErrorMessage(cause: unknown): string {
  if (cause instanceof FetchError) {
    if (cause.code === 'AUTH_FAILED') {
      return 'Git authentication failed. Check your credentials in Settings.'
    }
    if (cause.code === 'CONFLICT') {
      return 'Merge conflict detected. Resolve conflicts before continuing.'
    }
    if (cause.code === 'NOT_FOUND') {
      return 'Repository or file not found.'
    }
    if (cause.statusCode === 401) return 'Git authentication failed. Check your credentials in Settings.'
    if (cause.statusCode === 409) return 'Merge conflict detected. Resolve conflicts before continuing.'
    if (cause.statusCode === 404) return 'Repository or file not found.'
    return parseGitErrorMessage(cause.message)
  }
  if (cause instanceof Error) {
    return parseGitErrorMessage(cause.message)
  }
  const stringCause = z.string().safeParse(cause)
  if (stringCause.success) {
    return parseGitErrorMessage(stringCause.data)
  }
  const body = gitErrorBodySchema.safeParse(cause)
  const message = (body.success ? body.data.message ?? body.data.error : undefined) ?? String(cause)
  return parseGitErrorMessage(message || 'An error occurred')
}
