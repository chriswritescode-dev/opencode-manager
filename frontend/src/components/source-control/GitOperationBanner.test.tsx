import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { GitOperationState } from '@opencode-manager/shared'
import { GitOperationBanner } from './GitOperationBanner'

const { continueMutate, abortMutate, resolveMutate } = vi.hoisted(() => ({
  continueMutate: vi.fn(),
  abortMutate: vi.fn(),
  resolveMutate: vi.fn(),
}))

vi.mock('@/hooks/useGit', () => ({
  useGit: () => ({
    continueOperation: { mutate: continueMutate, isPending: false },
    abortOperation: { mutate: abortMutate, isPending: false },
  }),
}))

vi.mock('@/hooks/useResolveConflictsWithAgent', () => ({
  useResolveConflictsWithAgent: () => ({ mutate: resolveMutate, isPending: false }),
}))

vi.mock('@/api/repos', () => ({
  getRepo: vi.fn().mockResolvedValue({
    id: 1,
    fullPath: '/abs/repos/my-repo',
    currentBranch: 'main',
    defaultBranch: 'main',
  }),
}))

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function wrap(node: ReactNode) {
  return <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
}

function renderBanner(operation: GitOperationState) {
  return render(wrap(<GitOperationBanner repoId={1} operation={operation} />))
}

describe('GitOperationBanner', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the operation kind and conflicted files', () => {
    renderBanner({ kind: 'merge', conflictedFiles: ['file.txt', 'other.ts'] })

    expect(screen.getByText('Merge in progress')).toBeInTheDocument()
    expect(screen.getByText('file.txt')).toBeInTheDocument()
    expect(screen.getByText('other.ts')).toBeInTheDocument()
    expect(screen.getByText('2 conflicts')).toBeInTheDocument()
  })

  it('disables continue while conflicts remain and enables it once resolved', () => {
    const { rerender } = renderBanner({ kind: 'merge', conflictedFiles: ['file.txt'] })
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()

    rerender(wrap(<GitOperationBanner repoId={1} operation={{ kind: 'merge', conflictedFiles: [] }} />))
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
  })

  it('continues the operation when continue is clicked', async () => {
    const user = userEvent.setup()
    renderBanner({ kind: 'rebase', conflictedFiles: [] })

    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(continueMutate).toHaveBeenCalledTimes(1)
  })

  it('requires confirmation before aborting', async () => {
    const user = userEvent.setup()
    renderBanner({ kind: 'cherry-pick', conflictedFiles: ['file.txt'] })

    await user.click(screen.getByRole('button', { name: /abort/i }))
    expect(abortMutate).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Abort' }))

    expect(abortMutate).toHaveBeenCalledTimes(1)
  })

  it('only offers agent resolution while conflicts remain', () => {
    const { rerender } = renderBanner({ kind: 'merge', conflictedFiles: [] })
    expect(screen.queryByRole('button', { name: /resolve with agent/i })).not.toBeInTheDocument()

    rerender(wrap(<GitOperationBanner repoId={1} operation={{ kind: 'merge', conflictedFiles: ['file.txt'] }} />))
    expect(screen.getByRole('button', { name: /resolve with agent/i })).toBeEnabled()
  })

  it('starts agent resolution with the current operation and branch', async () => {
    const user = userEvent.setup()
    renderBanner({ kind: 'merge', conflictedFiles: ['file.txt'] })

    await user.click(screen.getByRole('button', { name: /resolve with agent/i }))

    expect(resolveMutate).toHaveBeenCalledWith({
      operation: { kind: 'merge', conflictedFiles: ['file.txt'] },
      branch: 'main',
    })
  })
})
