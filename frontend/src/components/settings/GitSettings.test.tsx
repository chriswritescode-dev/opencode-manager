import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GitSettings } from './GitSettings'
import { renderWithProviders } from '@/test/render'
import { createSettingsServer } from '@/test/fixtures/settingsServer'
import { makeRepo } from '@/test/fixtures/api'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import type { UserPreferences } from '@/api/types/settings'

interface RenderOptions {
  preferences?: Partial<UserPreferences>
  repos?: ReturnType<typeof makeRepo>[]
  patch?: () => FetchRouteResult | Promise<FetchRouteResult>
}

async function renderGitSettings(options: RenderOptions = {}) {
  const settings = createSettingsServer(
    { gitIdentity: { name: '', email: '' }, gitIdentities: [], gitCredentials: [], ...options.preferences },
    { patch: options.patch },
  )
  const repos = options.repos ?? []
  const fetchRoutes: FetchRoute[] = [
    ...settings.routes,
    { method: 'GET', path: '/api/repos', respond: () => ({ json: repos }) },
    {
      method: 'PATCH',
      path: '/api/repos/:id/git-credential',
      respond: async (_request, params) => ({ json: makeRepo({ id: Number(params.id) }) }),
    },
  ]
  const result = renderWithProviders(<GitSettings />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes,
  })
  await screen.findByLabelText('Name', { selector: 'input#git-name' })
  return { ...result, settings }
}

function defaultIdentityNameInput() {
  return screen.getByLabelText('Name', { selector: 'input#git-name' })
}

function savedIdentityNameInput(index = 0) {
  return screen.getByLabelText('Name', { selector: `input#git-identity-${index}-name` })
}

function patchBodies(fetchFake: ReturnType<typeof renderWithProviders>['fetchFake']) {
  return fetchFake.findRequests('PATCH', '/api/settings').map((request) => request.body)
}

describe('GitSettings draft preservation', () => {
  it('keeps default identity edits when a saved identity is removed', async () => {
    const user = userEvent.setup()
    await renderGitSettings({
      preferences: {
        gitIdentity: { name: 'Old Name', email: 'old@example.com' },
        gitIdentities: [{ id: 'a', name: 'Alpha', email: 'alpha@example.com' }],
      },
    })

    const nameInput = defaultIdentityNameInput()
    await user.clear(nameInput)
    await user.type(nameInput, 'New Name')
    expect(nameInput).toHaveValue('New Name')

    await user.click(screen.getByTitle('Delete'))

    await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeInTheDocument())
    expect(defaultIdentityNameInput()).toHaveValue('New Name')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('keeps saved identity drafts when a credential is saved', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderGitSettings()

    await user.click(screen.getAllByRole('button', { name: 'Add' })[1])
    const identityNameInput = screen.getByLabelText('Name', { selector: 'input#git-identity-0-name' })
    await user.type(identityNameInput, 'Draft Person')

    await user.click(screen.getAllByRole('button', { name: 'Add' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Add Git Credential' })
    await user.type(within(dialog).getByLabelText('Name *'), 'Work')
    await user.type(within(dialog).getByLabelText('Access Token *'), 'tok')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Credential saved')).toBeInTheDocument()
    expect(patchBodies(fetchFake)).toHaveLength(1)
    expect(savedIdentityNameInput()).toHaveValue('Draft Person')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('keeps saved identity drafts when a credential is deleted', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderGitSettings({
      preferences: {
        gitCredentials: [{ id: 'cred-1', name: 'Work', host: 'github.com', type: 'pat', token: 'tok' }],
      },
    })

    await user.click(screen.getAllByRole('button', { name: 'Add' })[1])
    const identityNameInput = screen.getByLabelText('Name', { selector: 'input#git-identity-0-name' })
    await user.type(identityNameInput, 'Draft Person')

    await user.click(screen.getAllByTitle('Delete')[0])

    expect(await screen.findByText('Credential deleted')).toBeInTheDocument()
    expect(patchBodies(fetchFake)).toHaveLength(1)
    expect(savedIdentityNameInput()).toHaveValue('Draft Person')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('removes a saved identity without touching repositories', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderGitSettings({
      preferences: {
        gitIdentities: [{ id: 'a', name: 'Alpha', email: 'alpha@example.com' }],
      },
      repos: [makeRepo({ id: 1 })],
    })

    await user.click(screen.getByTitle('Delete'))

    await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeInTheDocument())
    expect(fetchFake.findRequests('GET', '/api/repos')).toHaveLength(1)
    expect(fetchFake.findRequests('PATCH', '/api/repos/:id/git-credential')).toHaveLength(0)
    expect(patchBodies(fetchFake)).toHaveLength(0)
  })

  it('saves the default identity and reports success', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderGitSettings()

    await user.type(defaultIdentityNameInput(), 'New Name')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText('Git configuration saved')).toBeInTheDocument()
    expect(patchBodies(fetchFake)).toEqual([
      {
        preferences: {
          gitCredentials: [],
          gitIdentity: { name: 'New Name', email: '' },
          gitIdentities: [],
        },
      },
    ])
  })

  it('blocks saving and shows an inline error for an invalid identity email', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderGitSettings()

    const emailInput = screen.getByLabelText('Email', { selector: 'input#git-email' })
    await user.type(emailInput, 'not-an-email')

    expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(patchBodies(fetchFake)).toHaveLength(0)
    expect(emailInput).toHaveValue('not-an-email')
  })

  it('retains identity drafts when saving fails', async () => {
    const user = userEvent.setup()
    await renderGitSettings({
      patch: () => {
        throw new Error('network down')
      },
    })

    await user.type(defaultIdentityNameInput(), 'Draft Name')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText('Failed to save git configuration')).toBeInTheDocument()
    expect(defaultIdentityNameInput()).toHaveValue('Draft Name')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })
})
