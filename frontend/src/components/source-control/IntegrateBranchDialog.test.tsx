import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installPointerCapture } from '@/test/browserFakes'
import { makeRepo } from '@/test/fixtures/api'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'
import type { GitOperationState } from '@opencode-manager/shared'
import type { GitStatusResponse } from '@/types/git'
import { IntegrateBranchDialog } from './IntegrateBranchDialog'

function targetStatus(operation: GitOperationState | null): GitStatusResponse {
  return { branch: 'main', ahead: 0, behind: 0, files: [], hasChanges: false, operation }
}

interface DialogServer {
  operation: GitOperationState | null
  result: ReturnType<typeof renderWithProviders>
}

interface DialogServerState {
  operation: GitOperationState | null
}

function renderDialog(initialOperation: GitOperationState): DialogServer {
  const state: DialogServerState = { operation: initialOperation }

  const routes: FetchRoute[] = [
    { method: 'GET', path: '/api/repos/1', respond: () => ({ json: makeRepo({ id: 1, defaultBranch: 'main' }) }) },
    {
      method: 'GET',
      path: '/api/repos/1/git/branches',
      respond: () => ({
        json: {
          branches: [
            { name: 'feature', type: 'local', current: true },
            { name: 'main', type: 'local', current: false },
          ],
          status: { ahead: 0, behind: 0 },
        },
      }),
    },
    {
      method: 'POST',
      path: '/api/repos/1/git/integrate',
      respond: () => ({
        status: 409,
        json: {
          error: 'Integration stopped on conflicts',
          code: 'MERGE_CONFLICT',
          details: { targetRepoId: 2, operation: state.operation },
        },
      }),
    },
    { method: 'GET', path: '/api/repos/2', respond: () => ({ json: makeRepo({ id: 2, defaultBranch: 'main' }) }) },
    {
      method: 'GET',
      path: '/api/repos/2/git/status',
      respond: () => ({ json: targetStatus(state.operation) }),
    },
    {
      method: 'POST',
      path: '/api/repos/2/git/operation/continue',
      respond: () => {
        state.operation = null
        return { json: targetStatus(null) }
      },
    },
  ]

  const result = renderWithProviders(
    <IntegrateBranchDialog repoId={1} sourceBranch="feature" open onOpenChange={vi.fn()} />,
    { auth: false, theme: false, fetchRoutes: routes },
  )

  return {
    get operation() {
      return state.operation
    },
    set operation(next) {
      state.operation = next
    },
    result,
  }
}

async function triggerConflict(user: ReturnType<typeof userEvent.setup>) {
  const integrate = await screen.findByRole('button', { name: 'Integrate' })
  await waitFor(() => expect(integrate).toBeEnabled())
  await user.click(integrate)
  await screen.findByText('Merge in progress')
}

describe('IntegrateBranchDialog', () => {
  beforeEach(() => {
    installPointerCapture()
  })

  it('renders the operation banner for the target repo when integration stops on conflicts', async () => {
    const user = userEvent.setup()
    const server = renderDialog({ kind: 'merge', conflictedFiles: ['file.txt'] })

    await triggerConflict(user)

    expect(screen.getByText('file.txt')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Integrate' })).not.toBeInTheDocument()
    expect(server.result.fetchFake.lastRequest('POST', '/api/repos/1/git/integrate')?.body).toEqual({
      targetBranch: 'main',
      strategy: 'merge',
    })
  })

  it('writes the polled target status into the batched repo status cache when integration stops on conflicts', async () => {
    const user = userEvent.setup()
    const conflicted = { kind: 'merge' as const, conflictedFiles: ['file.txt'] }
    const server = renderDialog(conflicted)
    const { queryClient } = server.result
    queryClient.setQueryData(
      ['reposGitStatus', [1, 2]],
      new Map<number, GitStatusResponse>([
        [1, targetStatus(null)],
        [2, targetStatus(null)],
      ]),
    )

    await triggerConflict(user)

    await waitFor(() => {
      const batched = queryClient.getQueryData<Map<number, GitStatusResponse>>(['reposGitStatus', [1, 2]])
      expect(batched?.get(2)).toEqual(targetStatus(conflicted))
    })
    const batched = queryClient.getQueryData<Map<number, GitStatusResponse>>(['reposGitStatus', [1, 2]])
    expect(batched?.get(1)?.operation).toBeNull()
  })

  it('enables continue once the target status reports the conflicts resolved', async () => {
    const user = userEvent.setup()
    const server = renderDialog({ kind: 'merge', conflictedFiles: ['file.txt'] })
    const { queryClient } = server.result

    await triggerConflict(user)
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()

    server.operation = { kind: 'merge', conflictedFiles: [] }
    await queryClient.refetchQueries({ queryKey: ['gitStatus', 2] })

    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled())
  })

  it('removes the banner when continue clears the target operation', async () => {
    const user = userEvent.setup()
    const server = renderDialog({ kind: 'merge', conflictedFiles: [] })

    await triggerConflict(user)
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.queryByText('Merge in progress')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Integrate' })).toBeInTheDocument()
    expect(server.result.fetchFake.findRequests('POST', '/api/repos/2/git/operation/continue')).toHaveLength(1)
  })
})
