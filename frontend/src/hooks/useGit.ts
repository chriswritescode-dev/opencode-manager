import { useMutation, useQueryClient } from '@tanstack/react-query'
import { gitFetch, gitPull, gitPush, gitCommit, gitStageFiles, gitUnstageFiles, fetchGitLog, fetchGitDiff, gitReset, getApiErrorMessage } from '@/api/git'
import { createBranch, switchBranch } from '@/api/repos'
import { showToast } from '@/lib/toast'

export function useGit(repoId: number | undefined, onError?: (error: unknown) => void) {
  const queryClient = useQueryClient()

  const handleError = (error: unknown) => {
    if (onError) {
      onError(error)
    } else {
      showToast.error(getApiErrorMessage(error))
    }
  }

  const invalidateCache = (additionalKeys: string[] = []) => {
    if (!repoId) return
    const keys = ['gitStatus', 'fileDiff', 'gitLog', ...additionalKeys]
    keys.forEach(key => queryClient.invalidateQueries({ queryKey: [key, repoId] }))
  }

  const fetch = useMutation({
    mutationFn: () => {
      if (!repoId) throw new Error('No repo ID')
      return gitFetch(repoId)
    },
    onSuccess: () => {
      invalidateCache()
      showToast.success('Fetch completed')
    },
    onError: handleError,
  })

  const pull = useMutation({
    mutationFn: () => {
      if (!repoId) throw new Error('No repo ID')
      return gitPull(repoId)
    },
    onSuccess: () => {
      invalidateCache()
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
      queryClient.setQueryData(['gitStatus', repoId], data)
      const keysToInvalidate = ['fileDiff', 'gitLog', 'repo', 'branches']
      keysToInvalidate.forEach(key => queryClient.invalidateQueries({ queryKey: [key, repoId] }))
      showToast.success('Push completed')
    },
    onError: handleError,
  })

  const commit = useMutation({
    mutationFn: ({ message, stagedPaths }: { message: string; stagedPaths?: string[] }) => {
      if (!repoId) throw new Error('No repo ID')
      return gitCommit(repoId, message, stagedPaths)
    },
    onSuccess: () => {
      invalidateCache()
      showToast.success('Commit created')
    },
    onError: handleError,
  })

  const stageFilesMutation = useMutation({
    mutationFn: (paths: string[]) => {
      if (!repoId) throw new Error('No repo ID')
      return gitStageFiles(repoId, paths)
    },
    onSuccess: () => {
      invalidateCache()
      showToast.success('Files staged')
    },
    onError: handleError,
  })

  const unstageFilesMutation = useMutation({
    mutationFn: (paths: string[]) => {
      if (!repoId) throw new Error('No repo ID')
      return gitUnstageFiles(repoId, paths)
    },
    onSuccess: () => {
      invalidateCache()
      showToast.success('Files unstaged')
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
    mutationFn: (branchName: string) => {
      if (!repoId) throw new Error('No repo ID')
      return createBranch(repoId, branchName)
    },
    onSuccess: () => {
      invalidateCache(['branches'])
      showToast.success('Branch created')
    },
    onError: handleError,
  })

  const switchBranchMutation = useMutation({
    mutationFn: (branchName: string) => {
      if (!repoId) throw new Error('No repo ID')
      return switchBranch(repoId, branchName)
    },
    onSuccess: () => {
      invalidateCache(['branches'])
      showToast.success('Switched to branch')
    },
    onError: handleError,
  })

  const resetMutation = useMutation({
    mutationFn: (commitHash: string) => {
      if (!repoId) throw new Error('No repo ID')
      return gitReset(repoId, commitHash)
    },
    onSuccess: () => {
      invalidateCache()
      showToast.success('Reset to commit')
    },
    onError: handleError,
  })

  return {
    fetch,
    pull,
    push,
    commit,
    stageFiles: stageFilesMutation,
    unstageFiles: unstageFilesMutation,
    log,
    diff,
    createBranch: createBranchMutation,
    switchBranch: switchBranchMutation,
    reset: resetMutation
  }
}
