import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { IntegrationInfo, IntegrationMethod } from '@/api/oauth'
import { ProviderSettings } from './ProviderSettings'
import { renderWithProviders } from '@/test/render'
import { installPointerCapture } from '@/test/browserFakes'
import type { FetchRoute } from '@/test/fetchFake'

const oauthMethod: IntegrationMethod = { id: 'oauth', type: 'oauth', label: 'OAuth' }
const keyMethod: IntegrationMethod = { type: 'key', label: 'API key' }
const commandMethod: IntegrationMethod = { id: 'command', type: 'command', label: 'Command', command: ['example-command'] }
const envMethod: IntegrationMethod = { type: 'env', names: ['ENV_ONLY_API_KEY'] }

interface ProviderSpec {
  id: string
  name: string
  modelCount?: number
  integrationID?: string
}

function catalogProvider(spec: ProviderSpec) {
  return {
    id: spec.id,
    name: spec.name,
    activation: 'enabled',
    integrationID: spec.integrationID,
  }
}

function rawModel(providerID: string, index: number) {
  return {
    id: `model-${index}`,
    modelID: `model-${index}`,
    name: `model-${index}`,
    providerID,
    capabilities: { tools: true, input: ['text'], output: ['text'] },
    variants: [],
    enabled: true,
    status: 'active',
    limit: { context: 200000, output: 64000 },
    time: { released: 1 },
    cost: [{ input: 3, output: 15 }],
  }
}

function integration(
  id: string,
  name: string,
  methods: IntegrationMethod[],
  options: { connected?: boolean, connectionMethod?: 'key' | 'oauth', source?: string } = {},
): IntegrationInfo {
  const fixture: IntegrationInfo = {
    id,
    name,
    methods,
    connections: options.connected
      ? [{ type: 'credential', id: `cred_${id}`, label: name, method: options.connectionMethod ?? 'key' }]
      : [],
  }
  return options.source === undefined ? fixture : { ...fixture, metadata: { source: options.source } }
}

interface ProviderRenderOptions {
  providers: ProviderSpec[]
  integrations: IntegrationInfo[]
  integrationsStatus?: number
}

function renderProviderSettings(options: ProviderRenderOptions) {
  installPointerCapture()
  const providerData = options.providers.map(catalogProvider)
  const modelData = options.providers.flatMap((spec) =>
    Array.from({ length: spec.modelCount ?? 0 }, (_, index) => rawModel(spec.id, index)),
  )
  const fetchRoutes: FetchRoute[] = [
    { method: 'GET', path: '/api/opencode/api/provider', respond: () => ({ json: { data: providerData } }) },
    { method: 'GET', path: '/api/opencode/api/model', respond: () => ({ json: { data: modelData } }) },
    {
      method: 'GET',
      path: '/api/opencode/api/integration',
      respond: () => options.integrationsStatus
        ? { status: options.integrationsStatus, json: { error: 'Server unavailable' } }
        : { json: { data: options.integrations } },
    },
    {
      method: 'GET',
      path: '/api/oauth/auth-methods',
      respond: () => ({
        json: {
          providers: {
            together: [keyMethod],
            openai: [keyMethod],
            openrouter: [keyMethod],
            anthropic: [oauthMethod, keyMethod],
          },
        },
      }),
    },
    {
      method: 'POST',
      path: '/api/oauth/:providerId/oauth/authorize',
      respond: () => ({
        json: {
          attemptID: 'attempt-1',
          url: 'https://provider.example.com/oauth',
          instructions: 'Enter code: ABCD-1234',
          mode: 'auto',
        },
      }),
    },
    {
      method: 'GET',
      path: '/api/oauth/:providerId/oauth/:attemptId',
      respond: () => ({ json: { status: 'pending' } }),
    },
    {
      method: 'DELETE',
      path: '/api/providers/:providerId/credentials',
      respond: () => ({ json: { success: true } }),
    },
  ]
  return renderWithProviders(<ProviderSettings />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes,
  })
}

const standardProviders: ProviderSpec[] = [
  { id: 'anthropic', name: 'Anthropic', modelCount: 2 },
  { id: 'google', name: 'Google', modelCount: 3 },
  { id: 'openai', name: 'OpenAI', modelCount: 1 },
  { id: 'together', name: 'Together AI', modelCount: 4 },
]

const standardIntegrations: IntegrationInfo[] = [
  integration('anthropic', 'Anthropic', [oauthMethod], { connected: true, connectionMethod: 'oauth' }),
  integration('google', 'Google', [oauthMethod]),
  integration('openai', 'OpenAI', [keyMethod], { connected: true }),
  integration('together', 'Together AI', [keyMethod]),
]

function renderStandard() {
  return renderProviderSettings({ providers: standardProviders, integrations: standardIntegrations })
}

function rowFor(providerName: string): HTMLElement {
  const row = screen.getByText(providerName).closest('.py-3')
  if (!(row instanceof HTMLElement)) throw new Error(`No provider row for ${providerName}`)
  return row
}

function cardFor(providerName: string): HTMLElement {
  const card = screen.getByText(providerName).closest('.bg-card')
  if (!(card instanceof HTMLElement)) throw new Error(`No provider card for ${providerName}`)
  return card
}

describe('ProviderSettings', () => {
  it('lays out OAuth and API key columns in a container-query grid that splits at 1000px of content width', async () => {
    renderStandard()

    const oauthHeading = await screen.findByRole('heading', { name: 'OAuth Providers' })
    const apiKeysHeading = screen.getByRole('heading', { name: 'API Keys' })
    const oauthColumn = oauthHeading.closest('div.min-w-0')
    const apiKeysColumn = apiKeysHeading.closest('div.min-w-0')

    expect(oauthColumn).toHaveClass('min-w-0')
    expect(apiKeysColumn).toHaveClass('min-w-0')
    expect(oauthColumn?.parentElement).toBe(apiKeysColumn?.parentElement)
    expect(oauthColumn?.parentElement).toHaveClass('grid', '@min-[1000px]:grid-cols-2', '@min-[1000px]:items-start')
    expect(oauthColumn?.parentElement?.parentElement).toHaveClass('@container', 'w-full', 'max-w-7xl')
  })

  it('renders OAuth providers as rows with the name, model count, status, and actions', async () => {
    renderStandard()

    await screen.findByText('Anthropic')
    const connectedRow = rowFor('Anthropic')
    expect(connectedRow).toHaveClass('flex-wrap')
    expect(within(connectedRow).getByText('2 models')).toBeInTheDocument()
    expect(within(connectedRow).getByText('Connected')).toBeInTheDocument()
    expect(within(connectedRow).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
    expect(within(connectedRow).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()

    const disconnectedRow = rowFor('Google')
    expect(within(disconnectedRow).getByText('3 models')).toBeInTheDocument()
    expect(within(disconnectedRow).getByText('Not Connected')).toBeInTheDocument()
    expect(within(disconnectedRow).getByRole('button', { name: 'Connect' })).toBeInTheDocument()
    expect(within(disconnectedRow).queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
  })

  it('expands Available Providers by default and keeps Connected collapsed', async () => {
    renderStandard()

    await screen.findByText('Together AI')

    expect(screen.getByPlaceholderText('Search providers...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Available Providers/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Connected/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('labels the icon-only key actions of a connected provider', async () => {
    const user = userEvent.setup()
    renderStandard()

    await screen.findByText('Anthropic')
    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Connected/ }))

    const connectedCard = cardFor('OpenAI')
    expect(within(connectedCard).getByRole('button', { name: 'Edit API key for OpenAI' })).toBeInTheDocument()
    expect(within(connectedCard).getByRole('button', { name: 'Remove credentials for OpenAI' })).toBeInTheDocument()
  })

  it('filters the available provider search list', async () => {
    const user = userEvent.setup()
    renderStandard()

    await screen.findByText('Together AI')

    await user.type(screen.getByPlaceholderText('Search providers...'), 'together')

    expect(screen.getByText('Together AI')).toBeInTheDocument()
    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument()
  })

  it('starts OAuth authorization when Connect is chosen', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderStandard()

    await screen.findByText('Google')
    await user.click(screen.getByRole('button', { name: 'Connect' }))

    expect(await screen.findByRole('heading', { name: 'Complete Google Authentication' })).toBeInTheDocument()
    expect(fetchFake.lastRequest('POST', '/api/oauth/google/oauth/authorize')?.body).toEqual({ methodID: 'oauth' })
  })

  it('opens the API key dialog in add mode from the available list', async () => {
    const user = userEvent.setup()
    renderStandard()

    await screen.findByText('Together AI')
    await user.click(screen.getByRole('button', { name: 'Add Key' }))

    expect(await screen.findByRole('heading', { name: 'Connect Together AI' })).toBeInTheDocument()
  })

  it('opens the API key dialog in edit mode from the connected list', async () => {
    const user = userEvent.setup()
    renderStandard()

    await screen.findByText('Anthropic')
    await user.click(screen.getByRole('button', { name: /Connected/ }))
    await user.click(screen.getByRole('button', { name: 'Edit API key for OpenAI' }))

    expect(await screen.findByRole('heading', { name: 'Update OpenAI API Key' })).toBeInTheDocument()
  })

  it('removes credentials through the confirm dialog', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderStandard()

    await screen.findByText('Anthropic')
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))

    expect(await screen.findByRole('heading', { name: 'Remove Credentials' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(fetchFake.findRequests('DELETE', '/api/providers/anthropic/credentials')).toHaveLength(1)
  })

  it('shows the empty state when no OAuth-capable providers exist', async () => {
    renderProviderSettings({
      providers: [],
      integrations: [
        integration('openai', 'OpenAI', [keyMethod]),
        integration('together', 'Together AI', [keyMethod]),
      ],
    })

    expect(await screen.findByText('No OAuth-capable providers available.')).toBeInTheDocument()
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
  })

  it('lists an unconfigured provider when the active catalog has no providers', async () => {
    const user = userEvent.setup()
    renderProviderSettings({
      providers: [],
      integrations: [integration('openrouter', 'OpenRouter', [keyMethod])],
    })

    await screen.findByText('OpenRouter')
    expect(screen.getByRole('button', { name: /Available Providers/ })).toHaveTextContent('1')

    await user.type(screen.getByPlaceholderText('Search providers...'), 'openrouter')
    expect(screen.getByText('OpenRouter')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add Key' }))
    expect(await screen.findByRole('heading', { name: 'Connect OpenRouter' })).toBeInTheDocument()
  })

  it('uses integration IDs and names for provider entries when catalog IDs differ', async () => {
    const user = userEvent.setup()
    renderProviderSettings({
      providers: [{ id: 'catalog-anthropic', name: 'Anthropic Catalog', modelCount: 2, integrationID: 'anthropic' }],
      integrations: [integration('anthropic', 'Anthropic Integration', [oauthMethod], { connected: true })],
    })

    await screen.findByText('Anthropic Integration')
    const row = rowFor('Anthropic Integration')
    expect(within(row).getByText('2 models')).toBeInTheDocument()
    expect(within(row).getByText('Connected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(await screen.findByRole('heading', { name: 'Complete Anthropic Integration Authentication' })).toBeInTheDocument()
    expect(screen.queryByText('Anthropic Catalog')).not.toBeInTheDocument()
  })

  it('groups catalog providers that share an integration and combines their models', async () => {
    const user = userEvent.setup()
    renderProviderSettings({
      providers: [
        { id: 'catalog-one', name: 'Catalog One', modelCount: 2, integrationID: 'shared-integration' },
        { id: 'catalog-two', name: 'Catalog Two', modelCount: 3, integrationID: 'shared-integration' },
      ],
      integrations: [integration('shared-integration', 'Shared Integration', [oauthMethod])],
    })

    await screen.findByText('Shared Integration')

    expect(screen.getAllByText('Shared Integration')).toHaveLength(1)
    expect(screen.getByText('5 models')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByRole('heading', { name: 'Complete Shared Integration Authentication' })).toBeInTheDocument()
  })

  it('offers an API-key action for mixed-method integrations connected with OAuth', async () => {
    const user = userEvent.setup()
    renderProviderSettings({
      providers: [{ id: 'anthropic', name: 'Anthropic', modelCount: 2 }],
      integrations: [integration('anthropic', 'Anthropic', [oauthMethod, keyMethod], { connected: true, connectionMethod: 'oauth' })],
    })

    await screen.findByText('Anthropic')
    const row = rowFor('Anthropic')
    expect(within(row).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Add API key for Anthropic' })).toBeInTheDocument()

    await user.click(within(row).getByRole('button', { name: 'Add API key for Anthropic' }))
    expect(await screen.findByRole('heading', { name: 'Connect Anthropic' })).toBeInTheDocument()
  })

  it('labels an existing API key action as Edit API key and opens it in edit mode', async () => {
    const user = userEvent.setup()
    renderProviderSettings({
      providers: [{ id: 'anthropic', name: 'Anthropic', modelCount: 2 }],
      integrations: [integration('anthropic', 'Anthropic', [oauthMethod, keyMethod], { connected: true })],
    })

    await screen.findByText('Anthropic')
    const row = rowFor('Anthropic')

    const editKeyButton = within(row).getByRole('button', { name: 'Edit API key for Anthropic' })
    expect(editKeyButton).toHaveTextContent('Edit API key')

    await user.click(editKeyButton)
    expect(await screen.findByRole('heading', { name: 'Update Anthropic API Key' })).toBeInTheDocument()
  })

  it('lists OAuth integrations that are not in the active catalog', async () => {
    renderProviderSettings({
      providers: [],
      integrations: [integration('github-copilot', 'GitHub Copilot', [oauthMethod])],
    })

    expect(await screen.findByText('GitHub Copilot')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('does not list integration-only entries without OAuth or API-key methods', async () => {
    renderProviderSettings({
      providers: [],
      integrations: [
        integration('command-only', 'Command Only', [commandMethod]),
        integration('env-only', 'Environment Only', [envMethod]),
      ],
    })

    expect(await screen.findByText('No OAuth-capable providers available.')).toBeInTheDocument()
    expect(screen.queryByText('Command Only')).not.toBeInTheDocument()
    expect(screen.queryByText('Environment Only')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Available Providers/ })).toHaveTextContent('0')
  })

  it('includes connected integration-only providers in the Connected list', async () => {
    const user = userEvent.setup()
    renderProviderSettings({
      providers: [],
      integrations: [integration('connected-command', 'Connected Command', [commandMethod], { connected: true })],
    })

    await screen.findByText('No OAuth-capable providers available.')
    expect(screen.getByRole('button', { name: /Connected/ })).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: /Connected/ }))
    const connectedCard = cardFor('Connected Command')
    expect(within(connectedCard).getByRole('button', { name: 'Remove credentials for Connected Command' })).toBeInTheDocument()
    expect(within(connectedCard).queryByRole('button', { name: 'Edit API key for Connected Command' })).not.toBeInTheDocument()
  })

  it('keeps connected non-key providers visible without exposing API-key edit actions', async () => {
    const user = userEvent.setup()
    renderProviderSettings({
      providers: [
        { id: 'command-only', name: 'Command Only', modelCount: 1 },
        { id: 'command-connected', name: 'Connected Command Only', modelCount: 1 },
        { id: 'env-only', name: 'Environment Only', modelCount: 1 },
        { id: 'empty-methods', name: 'No Auth Methods', modelCount: 1 },
      ],
      integrations: [
        integration('command-only', 'Command Only', [commandMethod]),
        integration('command-connected', 'Connected Command Only', [commandMethod], { connected: true }),
        integration('env-only', 'Environment Only', [envMethod]),
        integration('empty-methods', 'No Auth Methods', []),
      ],
    })

    expect(await screen.findByRole('button', { name: /Available Providers/ })).toHaveTextContent('0')
    expect(screen.getByText('No available providers.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Key' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Connected/ }))
    const connectedCard = cardFor('Connected Command Only')
    expect(within(connectedCard).getByRole('button', { name: 'Remove credentials for Connected Command Only' })).toBeInTheDocument()
    expect(within(connectedCard).queryByRole('button', { name: 'Edit API key for Connected Command Only' })).not.toBeInTheDocument()
  })

  it('leaves MCP server integrations out of the provider lists', async () => {
    renderProviderSettings({
      providers: [],
      integrations: [
        integration('anthropic', 'Anthropic', [oauthMethod], { connected: true }),
        integration('mcp_figma', 'figma', [oauthMethod], { source: 'mcp' }),
      ],
    })

    await screen.findByText('Anthropic')
    expect(screen.queryByText('figma')).not.toBeInTheDocument()
  })

  it('shows an integration-list error instead of guessing connection status', async () => {
    renderProviderSettings({
      providers: standardProviders,
      integrations: standardIntegrations,
      integrationsStatus: 500,
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load provider integrations.')
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
    expect(screen.queryByText('No OAuth-capable providers available.')).not.toBeInTheDocument()
  })

  it('keeps the loaded providers when an integration refetch fails', async () => {
    installPointerCapture()
    let integrationsFail = false
    const fetchRoutes: FetchRoute[] = [
      {
        method: 'GET',
        path: '/api/opencode/api/provider',
        respond: () => ({ json: { data: [catalogProvider({ id: 'anthropic', name: 'Anthropic' })] } }),
      },
      { method: 'GET', path: '/api/opencode/api/model', respond: () => ({ json: { data: [rawModel('anthropic', 0)] } }) },
      {
        method: 'GET',
        path: '/api/opencode/api/integration',
        respond: () => integrationsFail
          ? { status: 500, json: { error: 'Server unavailable' } }
          : { json: { data: standardIntegrations } },
      },
    ]

    const { queryClient } = renderWithProviders(<ProviderSettings />, {
      auth: false,
      theme: false,
      tts: false,
      fetchRoutes,
    })
    await screen.findByText('Anthropic')

    integrationsFail = true
    await queryClient.refetchQueries({ queryKey: ['provider-integrations'] })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
  })
})
