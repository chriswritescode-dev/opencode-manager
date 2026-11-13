import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SecretEntry } from '@opencode-manager/shared/schemas'
import { SecretsManager } from './SecretsManager'
import type { SecretScope } from '@/api/secrets'
import { renderWithProviders } from '@/test/render'
import { installClipboard } from '@/test/browserFakes'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

interface SecretsFixture {
  secrets?: SecretEntry[]
  variables?: SecretEntry[]
  setResult?: FetchRouteResult
}

const repoScope: SecretScope = { scope: 'repo', repoId: 7 }

function scopeBase(scope: SecretScope): string {
  return scope.scope === 'global' ? '/api' : `/api/repos/${scope.repoId}`
}

function buildRoutes(scope: SecretScope, fixture: SecretsFixture): FetchRoute[] {
  const base = scopeBase(scope)
  return [
    { method: 'GET', path: `${base}/secrets`, respond: () => ({ json: { items: fixture.secrets ?? [] } }) },
    { method: 'GET', path: `${base}/variables`, respond: () => ({ json: { items: fixture.variables ?? [] } }) },
    {
      method: 'PUT',
      path: `${base}/:kind/:name`,
      respond: () => fixture.setResult ?? { status: 204 },
    },
    { method: 'DELETE', path: `${base}/:kind/:name`, respond: () => ({ status: 204 }) },
  ]
}

function renderManager(scope: SecretScope = repoScope, fixture: SecretsFixture = {}) {
  return renderWithProviders(<SecretsManager scope={scope} />, {
    auth: false,
    theme: false,
    fetchRoutes: buildRoutes(scope, fixture),
  })
}

describe('SecretsManager', () => {
  it('renders secret names without ever rendering secret values', async () => {
    renderManager(repoScope, {
      secrets: [{ name: 'OPENAI_API_KEY', environment: null, updatedAt: Date.now(), value: 'sk-super-secret' }],
    })

    expect(await screen.findByText('OPENAI_API_KEY')).toBeInTheDocument()
    expect(screen.queryByText(/sk-super-secret/)).not.toBeInTheDocument()
  })

  it('renders variable values', async () => {
    const user = userEvent.setup()
    renderManager(repoScope, {
      variables: [{ name: 'BASE_URL', environment: null, updatedAt: Date.now(), value: 'https://example.com' }],
    })

    await user.click(screen.getByRole('tab', { name: 'Variables' }))

    expect(await screen.findByText('BASE_URL')).toBeInTheDocument()
    expect(screen.getByText(/https:\/\/example\.com/)).toBeInTheDocument()
  })

  it('upper-cases the name and saves a secret', async () => {
    const user = userEvent.setup()
    const result = renderManager()

    await user.click(await screen.findByRole('button', { name: /Add secret/i }))

    const nameInput = screen.getByLabelText('Secret name')
    await user.type(nameInput, 'my_key')
    expect(nameInput).toHaveValue('MY_KEY')

    await user.type(screen.getByLabelText('Secret value'), 's3cret')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Secret saved')).toBeInTheDocument()
    const put = result.fetchFake.lastRequest('PUT', '/api/repos/7/secrets/:name')
    expect(put?.path).toBe('/api/repos/7/secrets/MY_KEY')
    expect(put?.body).toEqual({ value: 's3cret' })
  })

  it('saves a multi-line secret value through the textarea', async () => {
    const user = userEvent.setup()
    const result = renderManager()

    await user.click(await screen.findByRole('button', { name: /Add secret/i }))
    await user.type(screen.getByLabelText('Secret name'), 'PRIVATE_KEY')

    const valueField = screen.getByLabelText('Secret value')
    expect(valueField.tagName).toBe('TEXTAREA')
    expect(valueField).toHaveAttribute('autocomplete', 'off')
    expect(valueField).toHaveAttribute('spellcheck', 'false')

    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----'
    await user.click(valueField)
    await user.paste(pem)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('PUT', '/api/repos/7/secrets/:name')?.body).toEqual({ value: pem }),
    )
  })

  it('sends the lower-cased environment for repo scope', async () => {
    const user = userEvent.setup()
    const result = renderManager()

    await user.click(await screen.findByRole('button', { name: /Add secret/i }))
    await user.type(screen.getByLabelText('Secret name'), 'API_URL')
    await user.type(screen.getByLabelText('Environment (optional)'), 'E2E')
    await user.type(screen.getByLabelText('Secret value'), 'value')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('PUT', '/api/repos/7/secrets/:name')?.body).toEqual({
        value: 'value',
        environment: 'e2e',
      }),
    )
  })

  it('omits the environment field for global scope', async () => {
    const user = userEvent.setup()
    const result = renderManager({ scope: 'global' })

    await user.click(await screen.findByRole('button', { name: /Add secret/i }))
    expect(screen.queryByLabelText('Environment (optional)')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Secret name'), 'TOKEN')
    await user.type(screen.getByLabelText('Secret value'), 'value')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('PUT', '/api/secrets/:name')?.body).toEqual({ value: 'value' }),
    )
  })

  it('updates an existing secret without letting the name change', async () => {
    const user = userEvent.setup()
    const result = renderManager(repoScope, {
      secrets: [{ name: 'FOO', environment: 'e2e', updatedAt: Date.now() }],
    })

    await user.click(await screen.findByRole('button', { name: 'Update FOO' }))
    expect(screen.getByLabelText('Secret name')).toBeDisabled()

    await user.type(screen.getByLabelText('Secret value'), 'new-value')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('PUT', '/api/repos/7/secrets/:name')?.body).toEqual({
        value: 'new-value',
        environment: 'e2e',
      }),
    )
  })

  it('removes a secret after confirmation', async () => {
    const user = userEvent.setup()
    const result = renderManager(repoScope, {
      secrets: [{ name: 'FOO', environment: null, updatedAt: Date.now() }],
    })

    await user.click(await screen.findByRole('button', { name: 'Remove FOO' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(result.fetchFake.lastRequest('DELETE', '/api/repos/7/secrets/:name')?.path).toBe('/api/repos/7/secrets/FOO'))
    expect(await screen.findByText('Secret removed')).toBeInTheDocument()
  })

  it('copies the secret reference text', async () => {
    const user = userEvent.setup()
    const clipboard = installClipboard()
    renderManager(repoScope, {
      secrets: [{ name: 'FOO', environment: null, updatedAt: Date.now() }],
    })

    await user.click(await screen.findByRole('button', { name: 'Copy reference for FOO' }))

    expect(clipboard.writeText).toHaveBeenCalledWith('${{ secrets.FOO }}')
    expect(await screen.findByText('Reference copied')).toBeInTheDocument()
  })

  it('copies the variable reference text', async () => {
    const user = userEvent.setup()
    const clipboard = installClipboard()
    renderManager(repoScope, {
      variables: [{ name: 'BASE_URL', environment: null, updatedAt: Date.now(), value: 'x' }],
    })

    await user.click(screen.getByRole('tab', { name: 'Variables' }))
    await user.click(await screen.findByRole('button', { name: 'Copy reference for BASE_URL' }))

    expect(clipboard.writeText).toHaveBeenCalledWith('${{ vars.BASE_URL }}')
  })

  it('shows a validation error and does not call the API for an invalid name', async () => {
    const user = userEvent.setup()
    const result = renderManager()

    await user.click(await screen.findByRole('button', { name: /Add secret/i }))
    await user.type(screen.getByLabelText('Secret name'), 'BAD-NAME')
    await user.type(screen.getByLabelText('Secret value'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/letters, numbers, and underscores/i)
    expect(result.fetchFake.findRequests('PUT', '/api/repos/7/secrets/:name')).toHaveLength(0)
  })

  it('shows the server error from a failed save', async () => {
    const user = userEvent.setup()
    renderManager(repoScope, {
      setResult: { status: 500, json: { error: 'Name is reserved for Manager or the runtime' } },
    })

    await user.click(await screen.findByRole('button', { name: /Add secret/i }))
    await user.type(screen.getByLabelText('Secret name'), 'PATH')
    await user.type(screen.getByLabelText('Secret value'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Name is reserved for Manager or the runtime')
  })
})
