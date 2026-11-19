import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddRepoDialog } from './AddRepoDialog'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'

function Harness() {
  const [open, setOpen] = useState(true)

  return (
    <>
      <button onClick={() => setOpen(true)}>reopen</button>
      <AddRepoDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function renderDialog(routes: FetchRoute[]) {
  return renderWithProviders(<Harness />, {
    auth: false,
    theme: false,
    fetchRoutes: [
      { method: 'GET', path: '/api/repos', respond: () => ({ json: [] }) },
      ...routes,
    ],
  })
}

describe('AddRepoDialog', () => {
  it('links each field label to its input', () => {
    renderDialog([])

    expect(screen.getByLabelText('Repository URL')).toBeInTheDocument()
    expect(screen.getByLabelText('Directory Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Branch (optional)')).toBeInTheDocument()
  })

  it('rejects a URL containing whitespace before submitting', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderDialog([])

    await user.type(screen.getByLabelText('Repository URL'), 'not a url !!')

    expect(screen.getByText('Enter a valid repository URL without spaces.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Repository' })).toBeDisabled()
    expect(fetchFake.findRequests('POST', '/api/repos')).toHaveLength(0)
  })

  it('adds the repository with the entered URL and directory name', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderDialog([
      { method: 'POST', path: '/api/repos', respond: () => ({ json: { id: 9, name: 'demo', localPath: 'demo', fullPath: '/repos/demo', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: 1 } }) },
    ])

    await user.type(screen.getByLabelText('Repository URL'), 'https://github.com/test/demo.git')
    await user.click(screen.getByRole('button', { name: 'Add Repository' }))

    expect(await screen.findByText('Repository added')).toBeInTheDocument()
    expect(fetchFake.lastRequest('POST', '/api/repos')?.body).toEqual({
      repoUrl: 'https://github.com/test/demo.git',
      directoryName: 'demo',
      useWorktree: false,
      skipSSHVerification: false,
    })
  })

  it('clears the previous error and input when reopened', async () => {
    const user = userEvent.setup()
    renderDialog([
      {
        method: 'POST',
        path: '/api/repos',
        respond: () => ({
          status: 500,
          json: { error: 'Repository not found or access denied: https://github.com/test/missing.' },
        }),
      },
    ])

    const input = screen.getByLabelText('Repository URL')
    await user.type(input, 'test/missing')
    await user.click(screen.getByRole('button', { name: 'Add Repository' }))

    expect(await screen.findByText('Repository not found or access denied: https://github.com/test/missing.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'reopen' }))

    expect(screen.getByLabelText('Repository URL')).toHaveValue('')
    expect(screen.queryByText('Repository not found or access denied: https://github.com/test/missing.')).not.toBeInTheDocument()
  })
})
