import { describe, expect, it } from 'vitest'
import { act, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { WalkthroughSettings } from './WalkthroughSettings'
import { renderWithProviders } from '@/test/render'
import { createSettingsServer } from '@/test/fixtures/settingsServer'
import type { FetchRoute } from '@/test/fetchFake'

const catalogs: FetchRoute[] = [
  {
    method: 'GET',
    path: '/api/opencode/api/provider',
    respond: () => ({ json: { data: [{ id: 'anthropic', name: 'Anthropic', activation: 'enabled' }] } }),
  },
  {
    method: 'GET',
    path: '/api/opencode/api/model',
    respond: () => ({
      json: {
        data: [{
          id: 'claude-sonnet-4',
          modelID: 'claude-sonnet-4',
          name: 'Claude Sonnet 4',
          providerID: 'anthropic',
          capabilities: { tools: true, input: ['text'], output: ['text'] },
          variants: [],
          enabled: true,
          status: 'active',
          limit: { context: 200000, output: 64000 },
          time: { released: 1 },
          cost: [{ input: 3, output: 15 }],
        }],
      },
    }),
  },
  { method: 'GET', path: '/api/opencode/api/model/default', respond: () => ({ json: { data: null } }) },
  { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: {} }) },
  {
    method: 'GET',
    path: '/api/providers/model-state',
    respond: () => ({ json: { favorite: [], recent: [], variant: {} } }),
  },
]

function renderWalkthrough(initial: Parameters<typeof createSettingsServer>[0] = {}) {
  const settings = createSettingsServer(initial)
  const result = renderWithProviders(<WalkthroughSettings />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes: [...settings.routes, ...catalogs],
  })
  return { ...result, settings }
}

async function waitForAutosave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900))
  })
}

async function openModelList() {
  const input = await screen.findByLabelText('Walkthrough model')
  fireEvent.focus(input)
  return screen.findByRole('option', { name: /Claude Sonnet 4/ })
}

describe('WalkthroughSettings', () => {
  it('saves a chosen model after the autosave delay', async () => {
    const { fetchFake } = renderWalkthrough()

    fireEvent.click(await openModelList())
    await waitForAutosave()

    expect(fetchFake.lastRequest('PATCH', '/api/settings')?.body).toEqual({
      preferences: { walkthroughModel: 'anthropic/claude-sonnet-4' },
    })
  })

  it('clears the walkthrough model to an empty string', async () => {
    const { fetchFake } = renderWalkthrough({ walkthroughModel: 'anthropic/claude-sonnet-4' })

    await screen.findByRole('button', { name: 'Clear' })
    await waitForAutosave()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitForAutosave()

    expect(fetchFake.lastRequest('PATCH', '/api/settings')?.body).toEqual({
      preferences: { walkthroughModel: '' },
    })
    expect(screen.getByLabelText('Walkthrough model')).toHaveValue('')
  })

  it('does not save an unchanged stored value', async () => {
    const { fetchFake } = renderWalkthrough({ walkthroughModel: 'anthropic/claude-sonnet-4' })

    await screen.findByLabelText('Walkthrough model')
    await waitForAutosave()

    expect(fetchFake.findRequests('PATCH', '/api/settings')).toHaveLength(0)
  })

  it('does not save when no model is stored and the field is empty', async () => {
    const { fetchFake } = renderWalkthrough()

    await screen.findByLabelText('Walkthrough model')
    await waitForAutosave()

    expect(fetchFake.findRequests('PATCH', '/api/settings')).toHaveLength(0)
  })

  it('does not offer the OpenCode default as a stored value', async () => {
    const settings = createSettingsServer()
    const fetchRoutes: FetchRoute[] = [
      ...settings.routes,
      ...catalogs.filter((route) => route.path !== '/api/opencode/api/model/default'),
      {
        method: 'GET',
        path: '/api/opencode/api/model/default',
        respond: () => ({ json: { data: { providerID: 'anthropic', id: 'claude-sonnet-4' } } }),
      },
    ]
    renderWithProviders(<WalkthroughSettings />, {
      auth: false,
      theme: false,
      tts: false,
      fetchRoutes,
    })

    expect(await screen.findByLabelText('Walkthrough model')).toHaveValue('')
    fireEvent.focus(screen.getByLabelText('Walkthrough model'))

    expect(await screen.findByRole('option', { name: /Claude Sonnet 4/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Default:/ })).not.toBeInTheDocument()
  })
})
