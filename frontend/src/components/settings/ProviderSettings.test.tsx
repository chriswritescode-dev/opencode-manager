import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProviderSettings } from './ProviderSettings'
import { getProviders, providerCredentialsApi } from '@/api/providers'
import { oauthApi } from '@/api/oauth'
import type { Provider, Model } from '@/api/providers'
import type { OAuthAuthorizeResponse } from '@/api/oauth'
import type { ReactNode } from 'react'

vi.mock('@/api/providers', () => ({
  getProviders: vi.fn(),
  providerCredentialsApi: {
    list: vi.fn(),
    getStatus: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/api/oauth', () => ({
  oauthApi: {
    getAuthMethods: vi.fn(),
    authorize: vi.fn(),
    callback: vi.fn(),
  },
}))

vi.mock('./OAuthAuthorizeDialog', () => ({
  OAuthAuthorizeDialog: ({
    open,
    providerId,
  }: {
    open: boolean
    providerId: string
    providerName: string
    methods: unknown[]
    onOpenChange: (open: boolean) => void
    onSuccess: (response: OAuthAuthorizeResponse, methodIndex: number) => void
  }) => (open ? <div data-testid="oauth-authorize-dialog">{providerId}</div> : null),
}))

vi.mock('./OAuthCallbackDialog', () => ({
  OAuthCallbackDialog: ({
    open,
    providerId,
  }: {
    open: boolean
    providerId: string
    providerName: string
    authResponse: OAuthAuthorizeResponse
    methodIndex: number
    onOpenChange: (open: boolean) => void
    onSuccess: () => void
  }) => (open ? <div data-testid="oauth-callback-dialog">{providerId}</div> : null),
}))

vi.mock('@/components/model/ApiKeyDialog', () => ({
  ApiKeyDialog: ({
    open,
    mode,
    provider,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    provider: { id: string; name: string; models: { id: string; name: string }[] }
    onSuccess: () => void
    mode: 'add' | 'edit'
  }) => (open ? <div data-testid="api-key-dialog" data-mode={mode}>{provider.name}</div> : null),
}))

vi.mock('@/components/ui/delete-dialog', () => ({
  DeleteDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
    onCancel: () => void
    title: string
    description: ReactNode
    isDeleting: boolean
  }) => (open ? <button onClick={onConfirm}>Confirm delete</button> : null),
}))

function providerFixture(id: string, name: string, modelCount: number): Provider {
  return {
    id,
    name,
    env: [],
    models: Object.fromEntries(
      Array.from({ length: modelCount }, (_, index) => [`model-${index}`, {} as Model]),
    ),
  }
}

const oauthProviderWithKey = providerFixture('anthropic', 'Anthropic', 2)
const oauthProviderWithoutKey = providerFixture('google', 'Google', 3)
const apiKeyProviderWithKey = providerFixture('openai', 'OpenAI', 1)
const apiKeyProviderWithoutKey = providerFixture('together', 'Together AI', 4)

function mockProviderData() {
  vi.mocked(getProviders).mockResolvedValue({
    providers: [
      oauthProviderWithKey,
      oauthProviderWithoutKey,
      apiKeyProviderWithKey,
      apiKeyProviderWithoutKey,
    ],
    connected: [],
    default: {},
  })
  vi.mocked(providerCredentialsApi.list).mockResolvedValue(['anthropic', 'openai'])
  vi.mocked(oauthApi.getAuthMethods).mockResolvedValue({
    anthropic: [{ type: 'oauth', label: 'OAuth' }],
    google: [{ type: 'oauth', label: 'OAuth' }],
  })
}

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProviderSettings />
    </QueryClientProvider>,
  )
}

describe('ProviderSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderData()
  })

  it('lays out OAuth and API key columns in a container-query grid that splits at 1000px of content width', async () => {
    const { container } = renderSettings()

    await screen.findByText('Anthropic')

    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveClass('@container', 'w-full', 'max-w-7xl')

    const layout = root.firstElementChild as HTMLElement
    expect(layout).toHaveClass('grid', '@min-[1000px]:grid-cols-2', '@min-[1000px]:items-start')

    const [oauthColumn, apiKeysColumn] = Array.from(layout.children) as HTMLElement[]
    expect(oauthColumn).toHaveClass('min-w-0')
    expect(within(oauthColumn).getByRole('heading', { name: 'OAuth Providers' })).toBeInTheDocument()
    expect(apiKeysColumn).toHaveClass('min-w-0')
    expect(within(apiKeysColumn).getByRole('heading', { name: 'API Keys' })).toBeInTheDocument()
  })

  it('renders OAuth providers as compact divider rows with the name, model count, status, and actions', async () => {
    const { container } = renderSettings()

    await screen.findByText('Anthropic')

    const rows = container.querySelector('.divide-y') as HTMLElement
    expect(rows).toHaveClass('divide-border')

    const connectedRow = screen.getByText('Anthropic').closest('.py-3') as HTMLElement
    expect(connectedRow).toHaveClass('flex-wrap')
    expect(within(connectedRow).getByText('2 models')).toBeInTheDocument()
    expect(within(connectedRow).getByText('Connected')).toBeInTheDocument()
    expect(within(connectedRow).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
    expect(within(connectedRow).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()

    const disconnectedRow = screen.getByText('Google').closest('.py-3') as HTMLElement
    expect(within(disconnectedRow).getByText('3 models')).toBeInTheDocument()
    expect(within(disconnectedRow).getByText('Not Connected')).toBeInTheDocument()
    expect(within(disconnectedRow).getByRole('button', { name: 'Connect' })).toBeInTheDocument()
    expect(within(disconnectedRow).queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
  })

  it('expands Available Providers by default so the search is visible immediately', async () => {
    renderSettings()

    await screen.findByText('Together AI')

    expect(screen.getByPlaceholderText('Search providers...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Available Providers/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Connected/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps the Connected disclosure collapsed and labels its icon-only key actions', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Anthropic')

    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Connected/ }))

    const connectedCard = screen.getByText('OpenAI').closest('.bg-card') as HTMLElement
    expect(within(connectedCard).getByRole('button', { name: 'Edit API key for OpenAI' })).toBeInTheDocument()
    expect(within(connectedCard).getByRole('button', { name: 'Remove credentials for OpenAI' })).toBeInTheDocument()
  })

  it('filters the available provider search list and gives it the taller scroll area', async () => {
    const user = userEvent.setup()
    const { container } = renderSettings()

    await screen.findByText('Together AI')

    const list = container.querySelector('.max-h-96') as HTMLElement
    expect(list).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Search providers...'), 'together')

    expect(screen.getByText('Together AI')).toBeInTheDocument()
    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument()
  })

  it('opens the OAuth authorize dialog when Connect is chosen', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Google')

    await user.click(screen.getByRole('button', { name: 'Connect' }))

    expect(screen.getByTestId('oauth-authorize-dialog')).toHaveTextContent('google')
  })

  it('opens the API key dialog in add mode from the available list', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Together AI')

    await user.click(screen.getByRole('button', { name: 'Add Key' }))

    const dialog = screen.getByTestId('api-key-dialog')
    expect(dialog).toHaveAttribute('data-mode', 'add')
    expect(dialog).toHaveTextContent('Together AI')
  })

  it('opens the API key dialog in edit mode from the connected list', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Anthropic')

    await user.click(screen.getByRole('button', { name: /Connected/ }))
    await user.click(screen.getByRole('button', { name: 'Edit API key for OpenAI' }))

    const dialog = screen.getByTestId('api-key-dialog')
    expect(dialog).toHaveAttribute('data-mode', 'edit')
    expect(dialog).toHaveTextContent('OpenAI')
  })

  it('removes credentials through the confirm dialog', async () => {
    const user = userEvent.setup()
    vi.mocked(providerCredentialsApi.delete).mockResolvedValue(undefined)
    renderSettings()

    await screen.findByText('Anthropic')

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => {
      expect(providerCredentialsApi.delete).toHaveBeenCalledWith('anthropic')
    })
  })

  it('shows the empty state when no OAuth-capable providers exist', async () => {
    vi.mocked(oauthApi.getAuthMethods).mockResolvedValue({})
    renderSettings()

    await screen.findByText('No OAuth-capable providers available.')

    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
  })
})
