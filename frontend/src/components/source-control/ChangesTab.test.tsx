import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/render'
import { makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import type { GitStatusResponse } from '@/types/git'
import { ChangesTab } from './ChangesTab'

const statusWithChanges: GitStatusResponse = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  hasChanges: true,
  operation: null,
  files: [
    { path: 'notes.txt', status: 'modified', staged: true },
    { path: 'todo.txt', status: 'modified', staged: false },
  ],
}

const statusAfterCommit: GitStatusResponse = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  hasChanges: true,
  operation: null,
  files: [{ path: 'todo.txt', status: 'modified', staged: false }],
}

function renderTab(commit: FetchRoute['respond']) {
  return renderWithProviders(<ChangesTab repoId={1} onFileSelect={() => {}} isMobile={false} />, {
    auth: false,
    theme: false,
    toaster: true,
    fetchRoutes: [
      { method: 'GET', path: '/api/repos/1/git/status', respond: () => ({ json: statusWithChanges }) },
      {
        method: 'GET',
        path: '/api/repos/1/git-identity',
        respond: () => ({ json: { name: 'Alpha', email: 'alpha@example.com', scope: 'repository', presetId: 'a' } }),
      },
      { method: 'POST', path: '/api/repos/1/git/commit', respond: commit },
      {
        method: 'GET',
        path: '/api/settings',
        respond: () => ({
          json: makeSettingsResponse({
            preferences: makeUserPreferences({
              gitIdentities: [{ id: 'a', name: 'Alpha', email: 'alpha@example.com' }],
            }),
          }),
        }),
      },
    ],
  })
}

async function commitMessage(user: ReturnType<typeof userEvent.setup>, message: string) {
  await user.type(await screen.findByPlaceholderText('Commit message...'), message)
  await user.click(screen.getByRole('button', { name: /^Commit/ }))
}

describe('ChangesTab commit message', () => {
  it('keeps the message when the commit fails', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderTab(() => ({ status: 500, json: { error: 'Commit failed' } }))

    await commitMessage(user, 'fix the thing')

    expect(fetchFake.lastRequest('POST', '/api/repos/1/git/commit')?.body).toEqual({ message: 'fix the thing' })
    expect(await screen.findByText('Commit failed')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Commit message...')).toHaveValue('fix the thing')
  })

  it('clears the message after a successful commit', async () => {
    const user = userEvent.setup()
    renderTab(() => ({ json: statusAfterCommit }))

    await commitMessage(user, 'fix the thing')

    await screen.findByText('Commit created')
    expect(screen.getByPlaceholderText('Commit message...')).toHaveValue('')
  })
})
