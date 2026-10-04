import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { FetchError } from '@opencode-manager/shared'
import type { GitOperationState } from '@opencode-manager/shared'
import type { GitStatusResponse } from '@/types/git'
import { IntegrateBranchDialog } from './IntegrateBranchDialog'

const { integrateMutate, fetchStatus, continueMutate, abortMutate, resolveMutate } = vi.hoisted(() => ({
  integrateMutate: vi.fn(),
  fetchStatus: vi.fn(),
  continueMutate: vi.fn(),
  abortMutate: vi.fn(),
  resolveMutate: vi.fn(),
}))

vi.mock('@/api/git', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    fetchGitStatus: fetchStatus,
    getApiErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    useGitStatus: (repoId: number | undefined, options?: { refetchInterval?: number | false }) =>
      useQuery({
        queryKey: ['gitStatus', repoId],
        queryFn: () => (repoId ? fetchStatus(repoId) : Promise.reject(new Error('No repo ID'))),
        enabled: !!repoId,
        refetchInterval: options?.refetchInterval ?? false,
      }),
  }
})

vi.mock('@/api/repos', () => ({
  getRepo: vi.fn().mockResolvedValue({ id: 1, defaultBranch: 'main' }),
  listBranches: vi.fn().mockResolvedValue({
    branches: [
      { name: 'feature', type: 'local', current: true },
      { name: 'main', type: 'local', current: false },
    ],
    status: { ahead: 0, behind: 0 },
  }),
}))

vi.mock('@/hooks/useGit', () => ({
  useGit: () => ({
    integrateBranch: { mutate: integrateMutate, isPending: false },
    continueOperation: { mutate: continueMutate, isPending: false },
    abortOperation: { mutate: abortMutate, isPending: false },
  }),
}))

vi.mock('@/hooks/useResolveConflictsWithAgent', () => ({
  useResolveConflictsWithAgent: () => ({ mutate: resolveMutate, isPending: false }),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function wrap(node: ReactNode, queryClient: QueryClient) {
  return <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
}

function targetStatus(operation: GitOperationState | null): GitStatusResponse {
  return { branch: 'main', ahead: 0, behind: 0, files: [], hasChanges: false, operation }
}

function conflictError(operation: GitOperationState) {
  return new FetchError('Integration stopped on conflicts', 409, 'MERGE_CONFLICT', undefined, {
    details: { targetRepoId: 2, operation },
  })
}

function failIntegration(operation: GitOperationState) {
  integrateMutate.mockImplementation(
    (_variables: unknown, options?: { onError?: (error: unknown) => void }) => {
      options?.onError?.(conflictError(operation))
    },
  )
}

async function triggerConflict(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Integrate' }))
  await screen.findByText('Merge in progress')
}

describe('IntegrateBranchDialog', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the operation banner for the target repo when integration stops on conflicts', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const operation = { kind: 'merge' as const, conflictedFiles: ['file.txt'] }
    failIntegration(operation)
    fetchStatus.mockResolvedValue(targetStatus(operation))

    render(wrap(<IntegrateBranchDialog repoId={1} sourceBranch="feature" open onOpenChange={vi.fn()} />, queryClient))

    await triggerConflict(user)

    expect(screen.getByText('file.txt')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Integrate' })).not.toBeInTheDocument()
    expect(integrateMutate).toHaveBeenCalledWith({ targetBranch: 'main', strategy: 'merge' }, expect.any(Object))
  })

  it('writes the polled target status into the batched repo status cache when integration stops on conflicts', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const operation = { kind: 'merge' as const, conflictedFiles: ['file.txt'] }
    failIntegration(operation)
    const conflicted = targetStatus(operation)
    fetchStatus.mockResolvedValue(conflicted)
    queryClient.setQueryData(['reposGitStatus', [1, 2]], new Map<number, GitStatusResponse>([
      [1, targetStatus(null)],
      [2, targetStatus(null)],
    ]))

    render(wrap(<IntegrateBranchDialog repoId={1} sourceBranch="feature" open onOpenChange={vi.fn()} />, queryClient))

    await triggerConflict(user)

    await waitFor(() => {
      const batched = queryClient.getQueryData<Map<number, GitStatusResponse>>(['reposGitStatus', [1, 2]])
      expect(batched?.get(2)).toEqual(conflicted)
    })
    const batched = queryClient.getQueryData<Map<number, GitStatusResponse>>(['reposGitStatus', [1, 2]])
    expect(batched?.get(1)?.operation).toBeNull()
  })

  it('enables continue once the target status reports the conflicts resolved', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const operation = { kind: 'merge' as const, conflictedFiles: ['file.txt'] }
    failIntegration(operation)
    fetchStatus.mockResolvedValue(targetStatus(operation))

    render(wrap(<IntegrateBranchDialog repoId={1} sourceBranch="feature" open onOpenChange={vi.fn()} />, queryClient))

    await triggerConflict(user)
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()

    queryClient.setQueryData(['gitStatus', 2], targetStatus({ kind: 'merge', conflictedFiles: [] }))

    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled())
  })

  it('removes the banner when continue clears the target operation', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const operation = { kind: 'merge' as const, conflictedFiles: [] }
    failIntegration(operation)
    fetchStatus.mockResolvedValue(targetStatus(operation))
    continueMutate.mockImplementation(() => {
      queryClient.setQueryData(['gitStatus', 2], targetStatus(null))
    })

    render(wrap(<IntegrateBranchDialog repoId={1} sourceBranch="feature" open onOpenChange={vi.fn()} />, queryClient))

    await triggerConflict(user)
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(continueMutate).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText('Merge in progress')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Integrate' })).toBeInTheDocument()
  })
})
