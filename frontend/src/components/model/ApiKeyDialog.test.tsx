import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiKeyDialog } from './ApiKeyDialog'
import { providerCredentialsApi } from '@/api/providers'
import { oauthApi } from '@/api/oauth'
import { FetchError } from '@/api/fetchWrapper'
import type { ProviderWithModels } from '@/api/providers'

vi.mock('@/api/providers', () => ({
  providerCredentialsApi: {
    set: vi.fn(),
  },
}))

vi.mock('@/api/oauth', () => ({
  oauthApi: {
    getAuthMethods: vi.fn(),
  },
}))

function providerFixture(id: string, name: string, env: string[]): ProviderWithModels {
  return { id, name, env, models: [], source: 'builtin', isConnected: false }
}

const azureProvider = providerFixture('azure', 'Azure', ['AZURE_API_KEY'])
const anthropicProvider = providerFixture('anthropic', 'Anthropic', ['ANTHROPIC_API_KEY'])

function renderDialog(provider: ProviderWithModels, onSuccess = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiKeyDialog open onOpenChange={vi.fn()} provider={provider} onSuccess={onSuccess} />
    </QueryClientProvider>,
  )
  return { onSuccess }
}

describe('ApiKeyDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(providerCredentialsApi.set).mockResolvedValue(undefined)
    vi.mocked(oauthApi.getAuthMethods).mockResolvedValue({
      azure: [
        {
          id: 'key',
          type: 'key',
          label: 'API key',
          fields: [
            {
              type: 'text',
              key: 'resourceName',
              message: 'Enter Azure Resource Name',
              placeholder: 'e.g. my-models',
              required: true,
            },
          ],
        },
      ],
      anthropic: [{ id: 'key', type: 'key', label: 'API key' }],
    })
  })

  it('submits the api key alone for key methods without form fields', async () => {
    const user = userEvent.setup()
    const { onSuccess } = renderDialog(anthropicProvider)

    await user.type(await screen.findByLabelText('API Key'), 'sk-ant-test')
    await user.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(providerCredentialsApi.set).toHaveBeenCalledWith('anthropic', 'sk-ant-test', undefined)
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('renders required key method fields and submits their answers with the api key', async () => {
    const user = userEvent.setup()
    const { onSuccess } = renderDialog(azureProvider)

    await user.type(await screen.findByLabelText('API Key'), 'az-test')
    await user.type(screen.getByLabelText('Enter Azure Resource Name'), 'my-models')
    await user.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(providerCredentialsApi.set).toHaveBeenCalledWith('azure', 'az-test', {
        resourceName: 'my-models',
      })
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('keeps Connect disabled until the required key method field is filled', async () => {
    const user = userEvent.setup()
    renderDialog(azureProvider)

    await user.type(await screen.findByLabelText('API Key'), 'az-test')

    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()

    await user.type(screen.getByLabelText('Enter Azure Resource Name'), 'my-models')

    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  })

  it('shows the upstream validation failure without reporting success', async () => {
    const user = userEvent.setup()
    vi.mocked(providerCredentialsApi.set).mockRejectedValue(
      new FetchError('Missing required form field: resourceName', 502, 'InvalidRequestError'),
    )
    const { onSuccess } = renderDialog(azureProvider)

    await user.type(await screen.findByLabelText('API Key'), 'az-test')
    await user.type(screen.getByLabelText('Enter Azure Resource Name'), 'my-models')
    await user.click(screen.getByRole('button', { name: 'Connect' }))

    expect(
      await screen.findByText('The provider rejected the authentication details. Please check them and try again.'),
    ).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
