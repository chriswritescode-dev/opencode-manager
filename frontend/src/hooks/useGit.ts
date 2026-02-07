import { useMutation, useQueryClient } from '@tanstack/react-query'
import { gitFetch, gitPull, gitPush, gitCommit, gitStageFiles, gitUnstageFiles, gitDiscardFiles, fetchGitLog, fetchGitDiff, gitReset, getApiErrorMessage } from '@/api/git'
import { createBranch, switchBranch } from '@/api/repos'
import { showToast } from '@/lib/toast'

export function useGit(repoId: number | undefined) {
  const queryClient = useQueryClient()

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
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
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
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
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
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
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
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
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
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
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
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
  })

  const discardFilesMutation = useMutation({
    mutationFn: ({ paths, staged }: { paths: string[]; staged: boolean }) => {
      if (!repoId) throw new Error('No repo ID')
      return gitDiscardFiles(repoId, paths, staged)
    },
    onSuccess: () => {
      invalidateCache()
      showToast.success('Changes discarded')
    },
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
  })

  const log = useMutation({
    mutationFn: ({ limit }: { limit?: number }) => {
      if (!repoId) throw new Error('No repo ID')
      return fetchGitLog(repoId, limit)
    },
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
  })

  const diff = useMutation({
    mutationFn: (path: string) => {
      if (!repoId) throw new Error('No repo ID')
      return fetchGitDiff(repoId, path)
    },
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
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
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
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
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
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
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
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
    switchBranch: switchBranchMutation,
    reset: resetMutation
  }
}
