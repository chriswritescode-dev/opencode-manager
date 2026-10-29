import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProviderSettings } from './ProviderSettings'
import { getProviders, providerCredentialsApi } from '@/api/providers'
import { oauthApi } from '@/api/oauth'
import type { Provider } from '@/api/providers'
import type { IntegrationInfo, IntegrationMethod, OAuthAuthorizeResponse } from '@/api/oauth'
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
    getIntegrations: vi.fn(),
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
    onSuccess: (response: OAuthAuthorizeResponse, methodID: string) => void
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

function providerFixture(id: string, name: string, modelCount: number, integrationID?: string): Provider {
  return {
    id,
    integrationID,
    name,
    models: Array.from({ length: modelCount }, (_, index) => ({
      id: `model-${index}`,
      name: `model-${index}`,
      released: 0,
      free: false,
    })),
  }
}

const oauthProviderWithKey = providerFixture('anthropic', 'Anthropic', 2)
const oauthProviderWithoutKey = providerFixture('google', 'Google', 3)
const apiKeyProviderWithKey = providerFixture('openai', 'OpenAI', 1)
const apiKeyProviderWithoutKey = providerFixture('together', 'Together AI', 4)

const oauthMethod: IntegrationMethod = { id: 'oauth', type: 'oauth', label: 'OAuth' }
const keyMethod: IntegrationMethod = { type: 'key', label: 'API key' }
const commandMethod: IntegrationMethod = {
  id: 'command',
  type: 'command',
  label: 'Command',
  command: ['example-command'],
}
const envMethod: IntegrationMethod = { type: 'env', names: ['ENV_ONLY_API_KEY'] }

function integrationFixture(
  id: string,
  name: string,
  methods: IntegrationMethod[],
  connected = false,
  connectionMethod: 'key' | 'oauth' = 'key',
): IntegrationInfo {
  return {
    id,
    name,
    methods,
    connections: connected
      ? [{ type: 'credential', id: `cred_${id}`, label: name, method: connectionMethod }]
      : [],
  }
}

function mockProviderData() {
  vi.mocked(getProviders).mockResolvedValue({
    providers: [
      oauthProviderWithKey,
      oauthProviderWithoutKey,
      apiKeyProviderWithKey,
      apiKeyProviderWithoutKey,
    ],
    models: [],
  })
  vi.mocked(oauthApi.getIntegrations).mockResolvedValue([
    integrationFixture('anthropic', 'Anthropic', [oauthMethod], true),
    integrationFixture('google', 'Google', [oauthMethod]),
    integrationFixture('openai', 'OpenAI', [keyMethod], true),
    integrationFixture('together', 'Together AI', [keyMethod]),
  ])
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
    vi.mocked(getProviders).mockResolvedValue({ providers: [], models: [] })
    vi.mocked(oauthApi.getIntegrations).mockResolvedValue([
      integrationFixture('openai', 'OpenAI', [keyMethod]),
      integrationFixture('together', 'Together AI', [keyMethod]),
    ])
    renderSettings()

    await screen.findByText('No OAuth-capable providers available.')

    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
  })

  it('lists an unconfigured provider when the active catalog has no providers', async () => {
    vi.mocked(getProviders).mockResolvedValue({ providers: [], models: [] })
    vi.mocked(oauthApi.getIntegrations).mockResolvedValue([
      integrationFixture('openrouter', 'OpenRouter', [keyMethod]),
    ])
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('OpenRouter')
    expect(screen.getByRole('button', { name: /Available Providers/ })).toHaveTextContent('1')

    await user.type(screen.getByPlaceholderText('Search providers...'), 'openrouter')
    expect(screen.getByText('OpenRouter')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add Key' }))
    expect(screen.getByTestId('api-key-dialog')).toHaveTextContent('OpenRouter')
  })

  it('uses integration IDs for provider entries when catalog IDs differ', async () => {
    vi.mocked(getProviders).mockResolvedValue({
      providers: [providerFixture('catalog-anthropic', 'Anthropic Catalog', 2, 'anthropic')],
      models: [],
    })
    vi.mocked(oauthApi.getIntegrations).mockResolvedValue([
      integrationFixture('anthropic', 'Anthropic Integration', [oauthMethod], true),
    ])
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Anthropic Integration')
    expect(screen.getByText('2 models')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(screen.getByTestId('oauth-authorize-dialog')).toHaveTextContent('anthropic')
    expect(screen.queryByText('catalog-anthropic')).not.toBeInTheDocument()
  })

  it('groups catalog providers that share an integration and combines their models', async () => {
    vi.mocked(getProviders).mockResolvedValue({
      providers: [
        providerFixture('catalog-one', 'Catalog One', 2, 'shared-integration'),
        providerFixture('catalog-two', 'Catalog Two', 3, 'shared-integration'),
      ],
      models: [],
    })
    vi.mocked(oauthApi.getIntegrations).mockResolvedValue([
      integrationFixture('shared-integration', 'Shared Integration', [oauthMethod]),
    ])
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Shared Integration')

    expect(screen.getAllByText('Shared Integration')).toHaveLength(1)
    expect(screen.getByText('5 models')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(screen.getByTestId('oauth-authorize-dialog')).toHaveTextContent('shared-integration')
  })

  it('offers an API-key action for mixed-method integrations even when connected with OAuth', async () => {
    vi.mocked(getProviders).mockResolvedValue({
      providers: [providerFixture('anthropic', 'Anthropic', 2)],
      models: [],
    })
    vi.mocked(oauthApi.getIntegrations).mockResolvedValue([
      integrationFixture('anthropic', 'Anthropic', [oauthMethod, keyMethod], true, 'oauth'),
    ])
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Anthropic')
    const row = screen.getByText('Anthropic').closest('.py-3') as HTMLElement

    expect(within(row).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Add API key for Anthropic' })).toBeInTheDocument()

    await user.click(within(row).getByRole('button', { name: 'Add API key for Anthropic' }))
    expect(screen.getByTestId('api-key-dialog')).toHaveAttribute('data-mode', 'add')
  })

  it('labels an existing API key action as Add API key without changing its handling', async () => {
    vi.mocked(getProviders).mockResolvedValue({
      providers: [providerFixture('anthropic', 'Anthropic', 2)],
      models: [],
    })
    vi.mocked(oauthApi.getIntegrations).mockResolvedValue([
      integrationFixture('anthropic', 'Anthropic', [oauthMethod, keyMethod], true, 'key'),
    ])
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Anthropic')
    const row = screen.getByText('Anthropic').closest('.py-3') as HTMLElement

    const addKeyButton = within(row).getByRole('button', { name: 'Add API key for Anthropic' })
    expect(addKeyButton).toHaveTextContent('Add API key')

    await user.click(addKeyButton)
    expect(screen.getByTestId('api-key-dialog')).toHaveAttribute('data-mode', 'edit')
  })

  it('lists OAuth integrations that are not in the active catalog', async () => {
    vi.mocked(getProviders).mockResolvedValue({ providers: [], models: [] })
    vi.mocked(oauthApi.getIntegrations).mockResolvedValue([
      integrationFixture('github-copilot', 'GitHub Copilot', [oauthMethod]),
    ])
    renderSettings()

    await screen.findByText('GitHub Copilot')
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('does not list integration-only entries without OAuth or API-key methods', async () => {
    vi.mocked(getProviders).mockResolvedValue({ providers: [], models: [] })
    vi.mocked(oauthApi.getIntegrations).mockResolvedValue([
      integrationFixture('command-only', 'Command Only', [commandMethod]),
      integrationFixture('env-only', 'Environment Only', [envMethod]),
    ])
    renderSettings()

    await screen.findByText('No OAuth-capable providers available.')

    expect(screen.queryByText('Command Only')).not.toBeInTheDocument()
    expect(screen.queryByText('Environment Only')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Available Providers/ })).toHaveTextContent('0')
  })

  it('keeps connected non-key providers visible without exposing API-key edit actions', async () => {
    vi.mocked(getProviders).mockResolvedValue({
      providers: [
        providerFixture('command-only', 'Command Only', 1),
        providerFixture('command-connected', 'Connected Command Only', 1),
        providerFixture('env-only', 'Environment Only', 1),
        providerFixture('empty-methods', 'No Auth Methods', 1),
      ],
      models: [],
    })
    vi.mocked(oauthApi.getIntegrations).mockResolvedValue([
      integrationFixture('command-only', 'Command Only', [commandMethod]),
      integrationFixture('command-connected', 'Connected Command Only', [commandMethod], true),
      integrationFixture('env-only', 'Environment Only', [envMethod]),
      integrationFixture('empty-methods', 'No Auth Methods', []),
    ])
    const user = userEvent.setup()
    renderSettings()

    expect(await screen.findByRole('button', { name: /Available Providers/ })).toHaveTextContent('0')
    expect(screen.getByText('No available providers.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Key' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Connected/ }))
    const connectedCard = screen.getByText('Connected Command Only').closest('.bg-card') as HTMLElement
    expect(within(connectedCard).getByRole('button', { name: 'Remove credentials for Connected Command Only' })).toBeInTheDocument()
    expect(within(connectedCard).queryByRole('button', { name: 'Edit API key for Connected Command Only' })).not.toBeInTheDocument()
  })

  it('shows an integration-list error instead of guessing connection status', async () => {
    vi.mocked(oauthApi.getIntegrations).mockRejectedValue(new Error('Server unavailable'))
    renderSettings()

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load provider integrations.')
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
    expect(screen.queryByText('No OAuth-capable providers available.')).not.toBeInTheDocument()
  })
})
