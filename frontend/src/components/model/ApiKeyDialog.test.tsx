import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiKeyDialog } from './ApiKeyDialog'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'
import type { Provider } from '@/api/providers'
import type { ProviderAuthMethods } from '@/api/oauth'

function providerFixture(id: string, name: string): Provider {
  return { id, name, models: [] }
}

const azureProvider = providerFixture('azure', 'Azure')
const anthropicProvider = providerFixture('anthropic', 'Anthropic')

const defaultAuthMethods: ProviderAuthMethods = {
  azure: [
    {
      type: 'key',
      label: 'API key',
      form: [
        {
          key: 'resourceName',
          type: 'string',
          title: 'Enter Azure Resource Name',
          placeholder: 'e.g. my-models',
          required: true,
        },
      ],
    },
  ],
  anthropic: [{ type: 'key', label: 'API key' }],
}

interface RenderOptions {
  authMethods?: ProviderAuthMethods
  save?: FetchRoute['respond']
}

function renderDialog(provider: Provider, options: RenderOptions = {}) {
  const onSuccess = vi.fn()
  const result = renderWithProviders(
    <ApiKeyDialog open onOpenChange={vi.fn()} provider={provider} onSuccess={onSuccess} />,
    {
      auth: false,
      theme: false,
      toaster: false,
      fetchRoutes: [
        {
          method: 'GET',
          path: '/api/oauth/auth-methods',
          respond: () => ({ json: { providers: options.authMethods ?? defaultAuthMethods } }),
        },
        {
          method: 'POST',
          path: '/api/providers/:providerId/credentials',
          respond: options.save ?? (() => ({ json: { success: true } })),
        },
      ],
    },
  )
  return { ...result, onSuccess }
}

describe('ApiKeyDialog', () => {
  it('submits the api key alone for key methods without form fields', async () => {
    const user = userEvent.setup()
    const { onSuccess, fetchFake } = renderDialog(anthropicProvider)

    await user.type(await screen.findByLabelText('API Key'), 'sk-ant-test')
    await user.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(fetchFake.lastRequest('POST', '/api/providers/anthropic/credentials')?.body).toEqual({
        apiKey: 'sk-ant-test',
      })
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('renders required key method fields and submits their answers with the api key', async () => {
    const user = userEvent.setup()
    const { onSuccess, fetchFake } = renderDialog(azureProvider)

    await user.type(await screen.findByLabelText('API Key'), 'az-test')
    await user.type(screen.getByLabelText('Enter Azure Resource Name'), 'my-models')
    await user.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(fetchFake.lastRequest('POST', '/api/providers/azure/credentials')?.body).toEqual({
        apiKey: 'az-test',
        answer: { resourceName: 'my-models' },
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
    const { onSuccess } = renderDialog(azureProvider, {
      save: () => ({
        status: 502,
        json: { error: 'Missing required form field: resourceName', code: 'InvalidRequestError' },
      }),
    })

    await user.type(await screen.findByLabelText('API Key'), 'az-test')
    await user.type(screen.getByLabelText('Enter Azure Resource Name'), 'my-models')
    await user.click(screen.getByRole('button', { name: 'Connect' }))

    expect(
      await screen.findByText('The provider rejected the authentication details. Please check them and try again.'),
    ).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('keeps Connect enabled while a conditional required field is hidden and renders external fields', async () => {
    const user = userEvent.setup()
    renderDialog(azureProvider, {
      authMethods: {
        azure: [
          {
            type: 'key',
            label: 'API key',
            form: [
              {
                key: 'deploymentType',
                type: 'string',
                title: 'Deployment',
                required: true,
                default: 'github.com',
                options: [
                  { value: 'github.com', label: 'GitHub.com' },
                  { value: 'enterprise', label: 'GitHub Enterprise' },
                ],
              },
              {
                key: 'enterpriseUrl',
                type: 'string',
                title: 'Enterprise URL',
                required: true,
                when: [{ key: 'deploymentType', op: 'eq', value: 'enterprise' }],
              },
              {
                key: 'docs',
                type: 'external',
                url: 'https://example.com/docs',
                title: 'Read the docs',
              },
            ],
          },
        ],
      },
    })

    await user.type(await screen.findByLabelText('API Key'), 'az-test')

    expect(screen.queryByLabelText('Enterprise URL')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()

    const link = screen.getByRole('link', { name: /Read the docs/ })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
