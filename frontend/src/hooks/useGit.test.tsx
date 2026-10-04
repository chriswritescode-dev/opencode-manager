import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGit } from './useGit'
import * as gitApi from '../api/git'
import * as toast from '../lib/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { GitStatusResponse } from '../types/git'

vi.mock('../api/git', () => ({
  gitFetch: vi.fn(),
  gitPull: vi.fn(),
  gitPush: vi.fn(),
  gitCommit: vi.fn(),
  gitStageFiles: vi.fn(),
  gitUnstageFiles: vi.fn(),
  gitDiscardFiles: vi.fn(),
  gitReset: vi.fn(),
  gitRenameBranch: vi.fn(),
  gitDeleteBranch: vi.fn(),
  gitStashPush: vi.fn(),
  gitStashApply: vi.fn(),
  gitStashDrop: vi.fn(),
  gitContinueOperation: vi.fn(),
  gitAbortOperation: vi.fn(),
  gitGenerateCommitMessage: vi.fn(),
  gitIntegrateBranch: vi.fn(),
  fetchGitStatus: vi.fn(),
  fetchGitLog: vi.fn(),
  fetchGitDiff: vi.fn(),
  createBranch: vi.fn(),
  getApiErrorMessage: vi.fn((error: unknown) => typeof error === 'string' ? error : String(error)),
}))
vi.mock('../lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  },
}))

const mockInvalidateQueries = vi.fn()
const mockSetQueryData = vi.fn()
const mockSetQueriesData = vi.fn()

const mockRealQueryClient = vi.hoisted(() => ({ current: null as unknown }))

const mockGitStatus: GitStatusResponse = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [],
  hasChanges: false,
  operation: null,
}

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQueryClient: vi.fn(() => {
      const real = mockRealQueryClient.current as {
        invalidateQueries: (...args: unknown[]) => unknown
        setQueryData: (...args: unknown[]) => unknown
        setQueriesData: (...args: unknown[]) => unknown
      } | null
      return {
        invalidateQueries: (...args: unknown[]) => {
          mockInvalidateQueries(...args)
          return real?.invalidateQueries(...args)
        },
        setQueryData: (...args: unknown[]) => {
          mockSetQueryData(...args)
          return real?.setQueryData(...args)
        },
        setQueriesData: (...args: unknown[]) => {
          mockSetQueriesData(...args)
          return real?.setQueriesData(...args)
        },
      }
    })
  }
})

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useGit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvalidateQueries.mockClear()
    mockRealQueryClient.current = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    vi.mocked(gitApi.gitFetch).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitPull).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitPush).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitCommit).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitStageFiles).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitUnstageFiles).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitDiscardFiles).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitReset).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitRenameBranch).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitDeleteBranch).mockResolvedValue({ remoteDeleted: false, status: mockGitStatus })
    vi.mocked(gitApi.gitStashPush).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitStashApply).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitStashDrop).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitContinueOperation).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitAbortOperation).mockResolvedValue(mockGitStatus)
    vi.mocked(gitApi.gitGenerateCommitMessage).mockResolvedValue({ message: 'generated message' })
    vi.mocked(gitApi.gitIntegrateBranch).mockResolvedValue({ targetRepoId: 2, integratedCommits: 1, targetStatus: mockGitStatus })
    vi.mocked(gitApi.fetchGitStatus).mockResolvedValue(mockGitStatus)
  })

  const expectTargetedStatusCacheUpdate = () => {
    expect(mockSetQueryData).toHaveBeenCalledWith(['gitStatus', 1], mockGitStatus)
    expect(mockSetQueriesData).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['reposGitStatus'],
        predicate: expect.any(Function),
      }),
      expect.any(Function),
    )

    const [filters, updater] = mockSetQueriesData.mock.calls[0]
    expect(filters.predicate({ queryKey: ['reposGitStatus', [1, 2]] })).toBe(true)
    expect(filters.predicate({ queryKey: ['reposGitStatus', [2, 3]] })).toBe(false)
    expect(filters.predicate({ queryKey: ['other', [1]] })).toBe(false)

    const otherStatus = { ...mockGitStatus, branch: 'dev' }
    const oldData = new Map<number, GitStatusResponse>([[1, otherStatus], [2, otherStatus]])
    const updated = updater(oldData)
    expect(updated).not.toBe(oldData)
    expect(updated.get(1)).toBe(mockGitStatus)
    expect(updated.get(2)).toBe(otherStatus)
  }

  it('returns all mutations', () => {
    const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

    expect(result.current).toHaveProperty('fetch')
    expect(result.current).toHaveProperty('pull')
    expect(result.current).toHaveProperty('push')
    expect(result.current).toHaveProperty('commit')
    expect(result.current).toHaveProperty('stageFiles')
    expect(result.current).toHaveProperty('unstageFiles')
    expect(result.current).toHaveProperty('log')
    expect(result.current).toHaveProperty('diff')
  })

  describe('fetch mutation', () => {
    it('calls correct API and invalidates queries on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.fetch.mutateAsync()
      })

      expect(gitApi.gitFetch).toHaveBeenCalledWith(1)
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] })
    })

    it('shows toast error on failure', async () => {
      const mockGitFetch = vi.mocked(gitApi.gitFetch)
      mockGitFetch.mockRejectedValue('Fetch failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.fetch.mutateAsync().catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Fetch failed')
    })
  })

  describe('pull mutation', () => {
    it('calls correct API and invalidates queries on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.pull.mutateAsync()
      })

      expect(gitApi.gitPull).toHaveBeenCalledWith(1)
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] })
    })

    it('shows toast error on failure', async () => {
      const mockGitPull = vi.mocked(gitApi.gitPull)
      mockGitPull.mockRejectedValue('Pull failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.pull.mutateAsync().catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Pull failed')
    })
  })

  describe('push mutation', () => {
    it('calls correct API and invalidates queries on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.push.mutateAsync(undefined)
      })

      expect(gitApi.gitPush).toHaveBeenCalledWith(1, false)
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] })
    })

    it('shows toast error on failure', async () => {
      const mockGitPush = vi.mocked(gitApi.gitPush)
      mockGitPush.mockRejectedValue('Push failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.push.mutateAsync(undefined).catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Push failed')
    })
  })

  describe('commit mutation', () => {
    it('calls correct API and invalidates queries on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.commit.mutateAsync({ message: 'test commit' })
      })

      expect(gitApi.gitCommit).toHaveBeenCalledWith(1, 'test commit', undefined)
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] })
    })

    it('shows toast error on failure', async () => {
      const mockGitCommit = vi.mocked(gitApi.gitCommit)
      mockGitCommit.mockRejectedValue('Commit failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.commit.mutateAsync({ message: 'test' }).catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Commit failed')
    })
  })

  describe('stageFiles mutation', () => {
    it('calls correct API and invalidates queries on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.stageFiles.mutateAsync(['file.txt'])
      })

      expect(gitApi.gitStageFiles).toHaveBeenCalledWith(1, ['file.txt'])
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] })
    })

    it('shows toast error on failure', async () => {
      const mockGitStageFiles = vi.mocked(gitApi.gitStageFiles)
      mockGitStageFiles.mockRejectedValue('Stage failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.stageFiles.mutateAsync(['file.txt']).catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Stage failed')
    })
  })

  describe('unstageFiles mutation', () => {
    it('calls correct API and invalidates queries on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.unstageFiles.mutateAsync(['file.txt'])
      })

      expect(gitApi.gitUnstageFiles).toHaveBeenCalledWith(1, ['file.txt'])
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] })
    })

    it('shows toast error on failure', async () => {
      const mockGitUnstageFiles = vi.mocked(gitApi.gitUnstageFiles)
      mockGitUnstageFiles.mockRejectedValue('Unstage failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.unstageFiles.mutateAsync(['file.txt']).catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Unstage failed')
    })
  })

  describe('renameBranch mutation', () => {
    it('calls correct API and updates the status cache on success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.renameBranch.mutateAsync({ from: 'main', to: 'renamed' })
      })

      expect(gitApi.gitRenameBranch).toHaveBeenCalledWith(1, { from: 'main', to: 'renamed' })
      expectTargetedStatusCacheUpdate()
      expect(toast.showToast.success).toHaveBeenCalledWith('Branch renamed')
    })

    it('shows toast error on failure', async () => {
      vi.mocked(gitApi.gitRenameBranch).mockRejectedValue('Rename failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.renameBranch.mutateAsync({ from: 'main', to: 'renamed' }).catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Rename failed')
    })
  })

  describe('deleteBranch mutation', () => {
    it('calls correct API, updates the status cache and shows success toast', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.deleteBranch.mutateAsync({ name: 'feature', force: false, deleteRemote: false })
      })

      expect(gitApi.gitDeleteBranch).toHaveBeenCalledWith(1, { name: 'feature', force: false, deleteRemote: false })
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['branches', 1] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['repos'] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['repo', 1] })
      expect(toast.showToast.success).toHaveBeenCalledWith('Branch deleted')
    })

    it('shows toast error on failure', async () => {
      vi.mocked(gitApi.gitDeleteBranch).mockRejectedValue('Delete failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.deleteBranch
          .mutateAsync({ name: 'feature', force: false, deleteRemote: false })
          .catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Delete failed')
    })
  })

  describe('stashPush mutation', () => {
    it('invalidates the shared stash list prefix and updates the status cache', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.stashPush.mutateAsync({ message: 'wip', includeUntracked: true })
      })

      expect(gitApi.gitStashPush).toHaveBeenCalledWith(1, { message: 'wip', includeUntracked: true })
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitStashes'] })
      expect(toast.showToast.success).toHaveBeenCalledWith('Changes stashed')
    })

    it('shows toast error on failure', async () => {
      vi.mocked(gitApi.gitStashPush).mockRejectedValue('Stash failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.stashPush.mutateAsync({ message: 'wip', includeUntracked: true }).catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Stash failed')
    })
  })

  describe('stashApply success', () => {
    it('sends the hash and pop flag, invalidates the shared stash list prefix and shows the pop toast', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.stashApply.mutateAsync({ index: 0, hash: 'abc123', pop: true })
      })

      expect(gitApi.gitStashApply).toHaveBeenCalledWith(1, 0, { hash: 'abc123', pop: true })
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitStashes'] })
      expect(toast.showToast.success).toHaveBeenCalledWith('Stash popped')
    })
  })

  describe('stashDrop mutation', () => {
    it('sends the hash, invalidates the shared stash list prefix and updates the status cache', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.stashDrop.mutateAsync({ index: 0, hash: 'abc123' })
      })

      expect(gitApi.gitStashDrop).toHaveBeenCalledWith(1, 0, { hash: 'abc123' })
      expectTargetedStatusCacheUpdate()
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitStashes'] })
      expect(toast.showToast.success).toHaveBeenCalledWith('Stash dropped')
    })
  })

  describe('generateCommitMessage mutation', () => {
    it('calls the API and returns the generated message', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await expect(result.current.generateCommitMessage.mutateAsync()).resolves.toEqual({
        message: 'generated message',
      })
      expect(gitApi.gitGenerateCommitMessage).toHaveBeenCalledWith(1)
    })

    it('shows toast error on failure', async () => {
      vi.mocked(gitApi.gitGenerateCommitMessage).mockRejectedValue('Generation failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.generateCommitMessage.mutateAsync().catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Generation failed')
    })
  })

  describe('integrateBranch mutation', () => {
    it('writes the target status cache and refreshes the repo list without invalidating the source or batched status', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.integrateBranch.mutateAsync({ targetBranch: 'main', strategy: 'merge' })
      })

      expect(gitApi.gitIntegrateBranch).toHaveBeenCalledWith(1, { targetBranch: 'main', strategy: 'merge' })
      expect(toast.showToast.success).toHaveBeenCalledWith('Integrated 1 commit into main')
      expect(mockSetQueryData).toHaveBeenCalledWith(['gitStatus', 2], mockGitStatus)
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['gitStatus', 2] })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['reposGitStatus'] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['repos'] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 2] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 2] })
    })
  })

  describe('stashApply mutation', () => {
    it('invalidates the cached working-tree state and refreshes the stash list when apply conflicts', async () => {
      const realClient = mockRealQueryClient.current as QueryClient
      realClient.setQueryData(['gitStatus', 1], mockGitStatus)
      realClient.setQueryData(['fileDiff', 1, 'file.txt', undefined], { path: 'file.txt', diff: 'cached' })

      vi.mocked(gitApi.gitStashApply).mockRejectedValue(
        'CONFLICT (content): Merge conflict in file.txt',
      )
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.stashApply.mutateAsync({ index: 0, hash: 'abc123', pop: false }).catch(() => {})
      })

      expect(gitApi.gitStashApply).toHaveBeenCalledWith(1, 0, { hash: 'abc123', pop: false })
      expect(realClient.getQueryState(['gitStatus', 1])?.isInvalidated).toBe(true)
      expect(realClient.getQueryState(['fileDiff', 1, 'file.txt', undefined])?.isInvalidated).toBe(true)
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitStashes'] })

      const aggregateCall = mockInvalidateQueries.mock.calls.find(
        ([arg]) => (arg as { queryKey?: unknown[] } | undefined)?.queryKey?.[0] === 'reposGitStatus',
      )
      expect(aggregateCall).toBeDefined()
      const predicate = (aggregateCall![0] as { predicate: (query: { queryKey: unknown[] }) => boolean }).predicate
      expect(predicate({ queryKey: ['reposGitStatus', [1, 2]] })).toBe(true)
      expect(predicate({ queryKey: ['reposGitStatus', [2, 3]] })).toBe(false)

      expect(toast.showToast.error).toHaveBeenCalledWith('CONFLICT (content): Merge conflict in file.txt')
      expect(toast.showToast.success).not.toHaveBeenCalled()
      expect(gitApi.gitStashDrop).not.toHaveBeenCalled()
    })
  })

  describe('continueOperation mutation', () => {
    it('calls the API, updates the status cache and shows success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.continueOperation.mutateAsync()
      })

      expect(gitApi.gitContinueOperation).toHaveBeenCalledWith(1)
      expectTargetedStatusCacheUpdate()
      expect(toast.showToast.success).toHaveBeenCalledWith('Operation continued')
    })

    it('shows a toast error on failure', async () => {
      vi.mocked(gitApi.gitContinueOperation).mockRejectedValue('Continue failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.continueOperation.mutateAsync().catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Continue failed')
    })

    it('invalidates cached working-tree state and surfaces the error when continue stops on a later conflict', async () => {
      const realClient = mockRealQueryClient.current as QueryClient
      realClient.setQueryData(['gitStatus', 1], mockGitStatus)
      realClient.setQueryData(['fileDiff', 1, 'file.txt', undefined], { path: 'file.txt', diff: 'cached' })

      vi.mocked(gitApi.gitContinueOperation).mockRejectedValue(
        'CONFLICT (content): Merge conflict in other.txt',
      )
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.continueOperation.mutateAsync().catch(() => {})
      })

      expect(gitApi.gitContinueOperation).toHaveBeenCalledWith(1)
      expect(realClient.getQueryState(['gitStatus', 1])?.isInvalidated).toBe(true)
      expect(realClient.getQueryState(['fileDiff', 1, 'file.txt', undefined])?.isInvalidated).toBe(true)

      const aggregateCall = mockInvalidateQueries.mock.calls.find(
        ([arg]) => (arg as { queryKey?: unknown[] } | undefined)?.queryKey?.[0] === 'reposGitStatus',
      )
      expect(aggregateCall).toBeDefined()
      const predicate = (aggregateCall![0] as { predicate: (query: { queryKey: unknown[] }) => boolean }).predicate
      expect(predicate({ queryKey: ['reposGitStatus', [1, 2]] })).toBe(true)
      expect(predicate({ queryKey: ['reposGitStatus', [2, 3]] })).toBe(false)

      expect(toast.showToast.error).toHaveBeenCalledWith('CONFLICT (content): Merge conflict in other.txt')
      expect(toast.showToast.success).not.toHaveBeenCalled()
    })
  })

  describe('abortOperation mutation', () => {
    it('calls the API, updates the status cache and shows success', async () => {
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.abortOperation.mutateAsync()
      })

      expect(gitApi.gitAbortOperation).toHaveBeenCalledWith(1)
      expectTargetedStatusCacheUpdate()
      expect(toast.showToast.success).toHaveBeenCalledWith('Operation aborted')
    })

    it('shows a toast error on failure', async () => {
      vi.mocked(gitApi.gitAbortOperation).mockRejectedValue('Abort failed')
      const { result } = renderHook(() => useGit(1), { wrapper: createWrapper() })

      await waitFor(() => {
        result.current.abortOperation.mutateAsync().catch(() => {})
      })

      expect(toast.showToast.error).toHaveBeenCalledWith('Abort failed')
    })
  })
})
