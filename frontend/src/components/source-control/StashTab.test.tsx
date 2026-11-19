import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installPointerCapture } from '@/test/browserFakes'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'
import type { GitStatusResponse } from '@/types/git'
import type { GitStashEntry } from '@opencode-manager/shared'
import { StashTab } from './StashTab'

const stashEntry: GitStashEntry = {
  index: 0,
  ref: 'stash@{0}',
  hash: 'abc123',
  message: 'wip note',
  branch: 'main',
  date: '2024-01-01T00:00:00+00:00',
}

const cleanStatus: GitStatusResponse = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  hasChanges: false,
  operation: null,
  files: [],
}

function stashRoutes(stashes: GitStashEntry[]): FetchRoute[] {
  return [
    { method: 'GET', path: '/api/repos/1/git/stash', respond: () => ({ json: { stashes } }) },
    { method: 'POST', path: '/api/repos/1/git/stash', respond: () => ({ json: cleanStatus }) },
    { method: 'POST', path: '/api/repos/1/git/stash/0/apply', respond: () => ({ json: cleanStatus }) },
    { method: 'DELETE', path: '/api/repos/1/git/stash/0', respond: () => ({ json: cleanStatus }) },
  ]
}

function renderTab(stashes: GitStashEntry[] = [stashEntry]) {
  return renderWithProviders(<StashTab repoId={1} />, {
    auth: false,
    theme: false,
    fetchRoutes: stashRoutes(stashes),
  })
}

describe('StashTab', () => {
  beforeEach(() => {
    installPointerCapture()
  })

  it('renders stash entries with the message and branch', async () => {
    renderTab()

    expect(await screen.findByText('wip note')).toBeInTheDocument()
    expect(screen.getByText(/main/)).toBeInTheDocument()
  })

  it('applies or pops a stash with the entry hash', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderTab()
    await screen.findByText('wip note')

    await user.click(screen.getByRole('button', { name: /apply/i }))
    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/repos/1/git/stash/0/apply')?.body).toEqual({
        hash: 'abc123',
        pop: false,
      }),
    )

    await user.click(screen.getByRole('button', { name: /pop/i }))
    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/repos/1/git/stash/0/apply')?.body).toEqual({
        hash: 'abc123',
        pop: true,
      }),
    )
  })

  it('stashes the typed message and clears the input on success', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderTab()
    const input = await screen.findByRole('textbox', { name: 'Stash message' })

    await user.type(input, 'new stash')
    await user.click(screen.getByRole('button', { name: /stash changes/i }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/repos/1/git/stash')?.body).toEqual({
        message: 'new stash',
        includeUntracked: true,
      }),
    )
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('drops a stash only after confirmation', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderTab()
    await screen.findByText('wip note')

    await user.click(screen.getByTitle('Drop stash'))
    expect(fetchFake.findRequests('DELETE', '/api/repos/1/git/stash/0')).toHaveLength(0)

    await user.click(await screen.findByRole('button', { name: 'Drop' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('DELETE', '/api/repos/1/git/stash/0')?.body).toEqual({ hash: 'abc123' }),
    )
  })
})
