import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { SecretsManager } from './SecretsManager'
import type { SecretScope } from '@/api/secrets'

const mocks = vi.hoisted(() => ({
  listSecrets: vi.fn(),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
  copyTextToClipboard: vi.fn(),
  showToast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/api/secrets', () => ({
  listSecrets: mocks.listSecrets,
  setSecret: mocks.setSecret,
  deleteSecret: mocks.deleteSecret,
}))

vi.mock('@/lib/clipboard', () => ({ copyTextToClipboard: mocks.copyTextToClipboard }))

vi.mock('@/lib/toast', () => ({ showToast: mocks.showToast }))

const repoScope: SecretScope = { scope: 'repo', repoId: 7 }

function renderManager(scope: SecretScope = repoScope) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(<SecretsManager scope={scope} />, { wrapper })
}

describe('SecretsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setSecret.mockResolvedValue(undefined)
    mocks.deleteSecret.mockResolvedValue(undefined)
    mocks.copyTextToClipboard.mockResolvedValue(true)
  })

  it('renders secret names without ever rendering secret values', async () => {
    mocks.listSecrets.mockResolvedValue({
      items: [{ name: 'OPENAI_API_KEY', environment: null, updatedAt: Date.now(), value: 'sk-super-secret' }],
    })

    renderManager()

    expect(await screen.findByText('OPENAI_API_KEY')).toBeInTheDocument()
    expect(screen.queryByText(/sk-super-secret/)).not.toBeInTheDocument()
  })

  it('renders variable values', async () => {
    const user = userEvent.setup()
    mocks.listSecrets.mockImplementation((_scope: SecretScope, kind: string) =>
      Promise.resolve(
        kind === 'variable'
          ? { items: [{ name: 'BASE_URL', environment: null, updatedAt: Date.now(), value: 'https://example.com' }] }
          : { items: [] },
      ),
    )

    renderManager()
    await user.click(screen.getByRole('tab', { name: 'Variables' }))

    expect(await screen.findByText('BASE_URL')).toBeInTheDocument()
    expect(screen.getByText(/https:\/\/example\.com/)).toBeInTheDocument()
  })

  it('upper-cases the name and saves a secret', async () => {
    const user = userEvent.setup()
    mocks.listSecrets.mockResolvedValue({ items: [] })

    renderManager()
    await user.click(await screen.findByRole('button', { name: /Add secret/i }))

    const nameInput = screen.getByLabelText('Secret name')
    await user.type(nameInput, 'my_key')
    expect(nameInput).toHaveValue('MY_KEY')

    await user.type(screen.getByLabelText('Secret value'), 's3cret')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mocks.setSecret).toHaveBeenCalledWith(repoScope, 'secret', 'MY_KEY', { value: 's3cret' }),
    )
  })

  it('saves a multi-line secret value through the textarea', async () => {
    const user = userEvent.setup()
    mocks.listSecrets.mockResolvedValue({ items: [] })

    renderManager()
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
      expect(mocks.setSecret).toHaveBeenCalledWith(repoScope, 'secret', 'PRIVATE_KEY', { value: pem }),
    )
  })

  it('sends the lower-cased environment for repo scope', async () => {
    const user = userEvent.setup()
    mocks.listSecrets.mockResolvedValue({ items: [] })

    renderManager()
    await user.click(await screen.findByRole('button', { name: /Add secret/i }))
    await user.type(screen.getByLabelText('Secret name'), 'API_URL')
    await user.type(screen.getByLabelText('Environment (optional)'), 'E2E')
    await user.type(screen.getByLabelText('Secret value'), 'value')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mocks.setSecret).toHaveBeenCalledWith(repoScope, 'secret', 'API_URL', {
        value: 'value',
        environment: 'e2e',
      }),
    )
  })

  it('omits the environment field for global scope', async () => {
    const user = userEvent.setup()
    mocks.listSecrets.mockResolvedValue({ items: [] })

    renderManager({ scope: 'global' })
    await user.click(await screen.findByRole('button', { name: /Add secret/i }))

    expect(screen.queryByLabelText('Environment (optional)')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Secret name'), 'TOKEN')
    await user.type(screen.getByLabelText('Secret value'), 'value')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mocks.setSecret).toHaveBeenCalledWith({ scope: 'global' }, 'secret', 'TOKEN', { value: 'value' }),
    )
  })

  it('updates an existing secret without letting the name change', async () => {
    const user = userEvent.setup()
    mocks.listSecrets.mockResolvedValue({
      items: [{ name: 'FOO', environment: 'e2e', updatedAt: Date.now() }],
    })

    renderManager()
    await user.click(await screen.findByRole('button', { name: 'Update FOO' }))

    expect(screen.getByLabelText('Secret name')).toBeDisabled()

    await user.type(screen.getByLabelText('Secret value'), 'new-value')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mocks.setSecret).toHaveBeenCalledWith(repoScope, 'secret', 'FOO', {
        value: 'new-value',
        environment: 'e2e',
      }),
    )
  })

  it('removes a secret after confirmation', async () => {
    const user = userEvent.setup()
    mocks.listSecrets.mockResolvedValue({
      items: [{ name: 'FOO', environment: null, updatedAt: Date.now() }],
    })

    renderManager()
    await user.click(await screen.findByRole('button', { name: 'Remove FOO' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mocks.deleteSecret).toHaveBeenCalledWith(repoScope, 'secret', 'FOO', undefined))
  })

  it('copies the secret reference text', async () => {
    const user = userEvent.setup()
    mocks.listSecrets.mockResolvedValue({
      items: [{ name: 'FOO', environment: null, updatedAt: Date.now() }],
    })

    renderManager()
    await user.click(await screen.findByRole('button', { name: 'Copy reference for FOO' }))

    expect(mocks.copyTextToClipboard).toHaveBeenCalledWith('${{ secrets.FOO }}')
  })

  it('copies the variable reference text', async () => {
    const user = userEvent.setup()
    mocks.listSecrets.mockImplementation((_scope: SecretScope, kind: string) =>
      Promise.resolve(
        kind === 'variable'
          ? { items: [{ name: 'BASE_URL', environment: null, updatedAt: Date.now(), value: 'x' }] }
          : { items: [] },
      ),
    )

    renderManager()
    await user.click(screen.getByRole('tab', { name: 'Variables' }))
    await user.click(await screen.findByRole('button', { name: 'Copy reference for BASE_URL' }))

    expect(mocks.copyTextToClipboard).toHaveBeenCalledWith('${{ vars.BASE_URL }}')
  })

  it('shows a validation error and does not call the API for an invalid name', async () => {
    const user = userEvent.setup()
    mocks.listSecrets.mockResolvedValue({ items: [] })

    renderManager()
    await user.click(await screen.findByRole('button', { name: /Add secret/i }))
    await user.type(screen.getByLabelText('Secret name'), 'BAD-NAME')
    await user.type(screen.getByLabelText('Secret value'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/letters, numbers, and underscores/i)
    expect(mocks.setSecret).not.toHaveBeenCalled()
  })

  it('shows the server error from a failed save', async () => {
    const user = userEvent.setup()
    mocks.listSecrets.mockResolvedValue({ items: [] })
    mocks.setSecret.mockRejectedValue(new Error('Name is reserved for Manager or the runtime'))

    renderManager()
    await user.click(await screen.findByRole('button', { name: /Add secret/i }))
    await user.type(screen.getByLabelText('Secret name'), 'PATH')
    await user.type(screen.getByLabelText('Secret value'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Name is reserved for Manager or the runtime')
  })
})
