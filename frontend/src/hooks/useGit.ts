import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { gitFetch, gitPull, gitPush, gitCommit, gitStageFiles, gitUnstageFiles, gitDiscardFiles, fetchGitLog, fetchGitDiff, gitReset, gitRenameBranch, gitDeleteBranch, gitStashPush, gitStashApply, gitStashDrop, gitContinueOperation, gitAbortOperation, gitGenerateCommitMessage, gitIntegrateBranch, getApiErrorMessage, fetchGitStatus } from '@/api/git'
import { createBranch } from '@/api/repos'
import type { DeleteBranchRequest, DeleteBranchResult, IntegrateBranchRequest, RenameBranchRequest, StashPushRequest } from '@opencode-manager/shared'
import type { GitStatusResponse } from '@/types/git'
import { showToast } from '@/lib/toast'
import { invalidateRepoGitCaches, setRepoGitStatusCaches } from '@/lib/queryInvalidation'

interface RepoGitMutationConfig<TData, TVariables> {
  mutationFn: (repoId: number, variables: TVariables) => Promise<TData>
  successMessage?: string | ((data: TData, variables: TVariables) => string)
  statusFromData?: (data: TData) => GitStatusResponse | undefined
  invalidate?: (queryClient: QueryClient, repoId: number, data: TData, variables: TVariables) => void
  onError?: ((error: unknown) => void) | null
}

function useRepoGitMutation<TData, TVariables>(
  repoId: number | undefined,
  queryClient: QueryClient,
  handleError: (error: unknown) => void,
  { mutationFn, successMessage, statusFromData, invalidate, onError }: RepoGitMutationConfig<TData, TVariables>,
) {
  return useMutation({
    mutationFn: (variables: TVariables) => {
      if (!repoId) throw new Error('No repo ID')
      return mutationFn(repoId, variables)
    },
    onSuccess: (data, variables) => {
      if (repoId) {
        const status = statusFromData?.(data)
        if (status) setRepoGitStatusCaches(queryClient, repoId, status)
        invalidate?.(queryClient, repoId, data, variables)
      }
      if (successMessage) {
        showToast.success(typeof successMessage === 'function' ? successMessage(data, variables) : successMessage)
      }
    },
    onError: onError === null ? undefined : (onError ?? handleError),
  })
}

export function useGit(repoId: number | undefined, onError?: (error: unknown) => void) {
  const queryClient = useQueryClient()

  const handleError = (error: unknown) => {
    if (onError) {
      onError(error)
    } else {
      showToast.error(getApiErrorMessage(error))
    }
  }

  const fetch = useMutation({
    mutationFn: () => {
      if (!repoId) throw new Error('No repo ID')
      return gitFetch(repoId)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false })
      showToast.success('Fetch completed')
    },
    onError: handleError,
  })

  const pull = useMutation({
    mutationFn: () => {
      if (!repoId) throw new Error('No repo ID')
      return gitPull(repoId)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false })
      showToast.success('Pull completed')
    },
    onError: handleError,
  })

  const push = useMutation({
    mutationFn: (options?: { setUpstream?: boolean }) => {
      if (!repoId) throw new Error('No repo ID')
      return gitPush(repoId, options?.setUpstream ?? false)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false, invalidateRepoMeta: false })
      showToast.success('Push completed')
    },
    onError: handleError,
  })

  const commit = useMutation({
    mutationFn: ({ message, stagedPaths }: { message: string; stagedPaths?: string[] }) => {
      if (!repoId) throw new Error('No repo ID')
      return gitCommit(repoId, message, stagedPaths)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false, invalidateRepoMeta: false })
      showToast.success('Commit created')
    },
    onError: handleError,
  })

  const stageFilesMutation = useMutation({
    mutationFn: (paths: string[]) => {
      if (!repoId) throw new Error('No repo ID')
      return gitStageFiles(repoId, paths)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false, invalidateRepoMeta: false })
      showToast.success('Files staged')
    },
    onError: handleError,
  })

  const unstageFilesMutation = useMutation({
    mutationFn: (paths: string[]) => {
      if (!repoId) throw new Error('No repo ID')
      return gitUnstageFiles(repoId, paths)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false, invalidateRepoMeta: false })
      showToast.success('Files unstaged')
    },
    onError: handleError,
  })

  const discardFilesMutation = useMutation({
    mutationFn: ({ paths, staged }: { paths: string[]; staged: boolean }) => {
      if (!repoId) throw new Error('No repo ID')
      return gitDiscardFiles(repoId, paths, staged)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false, invalidateRepoMeta: false })
    },
    onError: handleError,
  })

  const log = useMutation({
    mutationFn: ({ limit }: { limit?: number }) => {
      if (!repoId) throw new Error('No repo ID')
      return fetchGitLog(repoId, limit)
    },
    onError: handleError,
  })

  const diff = useMutation({
    mutationFn: (path: string) => {
      if (!repoId) throw new Error('No repo ID')
      return fetchGitDiff(repoId, path)
    },
    onError: handleError,
  })

  const createBranchMutation = useMutation({
    mutationFn: async (branchName: string) => {
      if (!repoId) throw new Error('No repo ID')
      await createBranch(repoId, branchName)
      return fetchGitStatus(repoId)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false })
      showToast.success('Branch created')
    },
    onError: handleError,
  })

  const resetMutation = useMutation({
    mutationFn: (commitHash: string) => {
      if (!repoId) throw new Error('No repo ID')
      return gitReset(repoId, commitHash)
    },
    onSuccess: (data) => {
      if (repoId) setRepoGitStatusCaches(queryClient, repoId, data)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false, invalidateRepoMeta: false })
      showToast.success('Reset to commit')
    },
    onError: handleError,
  })

  const renameBranchMutation = useRepoGitMutation<GitStatusResponse, RenameBranchRequest>(
    repoId,
    queryClient,
    handleError,
    {
      mutationFn: gitRenameBranch,
      statusFromData: (data) => data,
      invalidate: (client, id) => invalidateRepoGitCaches(client, id, { invalidateStatus: false }),
      successMessage: 'Branch renamed',
    },
  )

  const deleteBranchMutation = useRepoGitMutation<DeleteBranchResult & { status: GitStatusResponse }, DeleteBranchRequest>(
    repoId,
    queryClient,
    handleError,
    {
      mutationFn: gitDeleteBranch,
      statusFromData: (data) => data.status,
      invalidate: (client, id) => {
        client.invalidateQueries({ queryKey: ['branches', id] })
        invalidateRepoGitCaches(client, id, { invalidateStatus: false, invalidateRepoMeta: false })
      },
      successMessage: 'Branch deleted',
    },
  )

  const stashPushMutation = useRepoGitMutation<GitStatusResponse, StashPushRequest>(
    repoId,
    queryClient,
    handleError,
    {
      mutationFn: gitStashPush,
      statusFromData: (data) => data,
      invalidate: (client, id) => invalidateRepoGitCaches(client, id, {
        invalidateStatus: false,
        invalidateRepoMeta: false,
        invalidateStashes: true,
      }),
      successMessage: 'Changes stashed',
    },
  )

  const handleStashActionError = (error: unknown) => {
    if (repoId) {
      invalidateRepoGitCaches(queryClient, repoId, {
        invalidateRepoListStatus: true,
        invalidateStashes: true,
      })
    }
    handleError(error)
  }

  const stashApplyMutation = useRepoGitMutation<GitStatusResponse, { index: number; hash: string; pop: boolean }>(
    repoId,
    queryClient,
    handleError,
    {
      mutationFn: (id, { index, hash, pop }) => gitStashApply(id, index, { hash, pop }),
      statusFromData: (data) => data,
      invalidate: (client, id) => invalidateRepoGitCaches(client, id, {
        invalidateStatus: false,
        invalidateRepoMeta: false,
        invalidateStashes: true,
      }),
      successMessage: (_data, variables) => (variables.pop ? 'Stash popped' : 'Stash applied'),
      onError: handleStashActionError,
    },
  )

  const stashDropMutation = useRepoGitMutation<GitStatusResponse, { index: number; hash: string }>(
    repoId,
    queryClient,
    handleError,
    {
      mutationFn: (id, { index, hash }) => gitStashDrop(id, index, { hash }),
      statusFromData: (data) => data,
      invalidate: (client, id) => invalidateRepoGitCaches(client, id, {
        invalidateStatus: false,
        invalidateRepoMeta: false,
        invalidateStashes: true,
      }),
      successMessage: 'Stash dropped',
      onError: handleStashActionError,
    },
  )

  const continueOperationMutation = useRepoGitMutation<GitStatusResponse, void>(
    repoId,
    queryClient,
    handleError,
    {
      mutationFn: (id) => gitContinueOperation(id),
      statusFromData: (data) => data,
      invalidate: (client, id) => invalidateRepoGitCaches(client, id, { invalidateStatus: false, invalidateRepoMeta: false }),
      successMessage: 'Operation continued',
      onError: (error) => {
        if (repoId) invalidateRepoGitCaches(queryClient, repoId, { invalidateRepoListStatus: true })
        handleError(error)
      },
    },
  )

  const abortOperationMutation = useRepoGitMutation<GitStatusResponse, void>(
    repoId,
    queryClient,
    handleError,
    {
      mutationFn: (id) => gitAbortOperation(id),
      statusFromData: (data) => data,
      invalidate: (client, id) => invalidateRepoGitCaches(client, id, { invalidateStatus: false, invalidateRepoMeta: false }),
      successMessage: 'Operation aborted',
    },
  )

  const generateCommitMessageMutation = useRepoGitMutation<{ message: string }, void>(
    repoId,
    queryClient,
    handleError,
    {
      mutationFn: (id) => gitGenerateCommitMessage(id),
    },
  )

  const integrateBranchMutation = useMutation({
    mutationFn: (request: IntegrateBranchRequest) => {
      if (!repoId) throw new Error('No repo ID')
      return gitIntegrateBranch(repoId, request)
    },
    onSuccess: (data, request) => {
      setRepoGitStatusCaches(queryClient, data.targetRepoId, data.targetStatus)
      invalidateRepoGitCaches(queryClient, data.targetRepoId, {
        invalidateStatus: false,
        invalidateRepoMeta: false,
      })
      queryClient.invalidateQueries({ queryKey: ['repos'] })
      const noun = data.integratedCommits === 1 ? 'commit' : 'commits'
      showToast.success(`Integrated ${data.integratedCommits} ${noun} into ${request.targetBranch}`)
    },
  })

  return {
    fetch,
    pull,
    push,
    commit,
    stageFiles: stageFilesMutation,
    unstageFiles: unstageFilesMutation,
    discardFiles: discardFilesMutation,
    log,
    diff,
    createBranch: createBranchMutation,
    reset: resetMutation,
    renameBranch: renameBranchMutation,
    deleteBranch: deleteBranchMutation,
    stashPush: stashPushMutation,
    stashApply: stashApplyMutation,
    stashDrop: stashDropMutation,
    continueOperation: continueOperationMutation,
    abortOperation: abortOperationMutation,
    generateCommitMessage: generateCommitMessageMutation,
    integrateBranch: integrateBranchMutation,
  }
}
