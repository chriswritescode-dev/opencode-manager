import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TTSSettings } from './TTSSettings'
import { renderWithProviders } from '@/test/render'
import { createSettingsServer } from '@/test/fixtures/settingsServer'
import { installPointerCapture, installSpeechSynthesis } from '@/test/browserFakes'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import type { UserPreferences } from '@/api/types/settings'

const externalTts: NonNullable<UserPreferences['tts']> = {
  enabled: true,
  provider: 'external',
  autoPlay: false,
  endpoint: 'https://api.openai.com',
  apiKey: 'sk-test',
  voice: 'alloy',
  model: 'tts-1',
  speed: 1,
  availableVoices: [],
  availableModels: [],
  lastVoicesFetch: 0,
  lastModelsFetch: 0,
}

interface TtsRenderOptions {
  tts?: Partial<NonNullable<UserPreferences['tts']>>
  clearCache?: () => FetchRouteResult | Promise<FetchRouteResult>
}

function renderTtsSettings(options: TtsRenderOptions = {}) {
  installPointerCapture()
  installSpeechSynthesis(['Alex'])
  const settings = createSettingsServer({ tts: { ...externalTts, ...options.tts } })
  const fetchRoutes: FetchRoute[] = [
    ...settings.routes,
    { method: 'GET', path: '/api/tts/models', respond: () => ({ json: { models: ['tts-1'], cached: false } }) },
    { method: 'GET', path: '/api/tts/voices', respond: () => ({ json: { voices: ['alloy'], cached: false } }) },
    {
      method: 'DELETE',
      path: '/api/tts/cache',
      respond: options.clearCache ?? (() => ({ json: { cleared: 3 } })),
    },
  ]
  const result = renderWithProviders(<TTSSettings />, {
    tts: true,
    fetchRoutes,
  })
  return { ...result, settings }
}

async function findClearCacheButton() {
  return screen.findByRole('button', { name: 'Clear audio cache' })
}

describe('TTSSettings audio cache', () => {
  it('clears the server cache and reports the count', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderTtsSettings()

    await user.click(await findClearCacheButton())

    expect(await screen.findByRole('status')).toHaveTextContent('Cleared 3 cached audio file(s).')
    expect(fetchFake.findRequests('DELETE', '/api/tts/cache')).toHaveLength(1)
  })

  it('disables the button and shows a pending label while clearing', async () => {
    const user = userEvent.setup()
    let resolveClear: (reply: FetchRouteResult) => void = () => {}
    renderTtsSettings({
      clearCache: () => new Promise<FetchRouteResult>((resolve) => {
        resolveClear = resolve
      }),
    })

    await user.click(await findClearCacheButton())

    const pendingButton = screen.getByRole('button', { name: /clearing/i })
    expect(pendingButton).toBeDisabled()

    resolveClear({ json: { cleared: 1 } })
    expect(await screen.findByRole('status')).toHaveTextContent('Cleared 1 cached audio file(s).')
  })

  it('shows an actionable error and allows retrying after a failure', async () => {
    const user = userEvent.setup()
    let attempt = 0
    const { fetchFake } = renderTtsSettings({
      clearCache: () => {
        attempt += 1
        return attempt === 1
          ? { status: 500, json: { error: 'cache unavailable' } }
          : { json: { cleared: 2 } }
      },
    })

    await user.click(await findClearCacheButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not clear cached audio: cache unavailable. Try again.',
    )
    const retryButton = screen.getByRole('button', { name: 'Clear audio cache' })
    expect(retryButton).toBeEnabled()

    await user.click(retryButton)

    expect(await screen.findByRole('status')).toHaveTextContent('Cleared 2 cached audio file(s).')
    expect(fetchFake.findRequests('DELETE', '/api/tts/cache')).toHaveLength(2)
  })

  it.each([
    { label: 'TTS is disabled', tts: { enabled: false } },
    { label: 'the builtin provider is selected', tts: { provider: 'builtin', voice: 'Alex' } },
  ])('keeps the cache button available while $label', async ({ tts }) => {
    renderTtsSettings({ tts })

    expect(await findClearCacheButton()).toBeInTheDocument()
  })

  it('shows the browser voice count for the builtin provider', async () => {
    renderTtsSettings({ tts: { provider: 'builtin', voice: 'Alex' } })

    expect(await screen.findByText('1 voices available in your browser')).toBeInTheDocument()
  })

  it('discovers models and voices only when external TTS is configured', async () => {
    const { fetchFake } = renderTtsSettings()

    await screen.findByText('Available voices (1)')
    expect(fetchFake.findRequests('GET', '/api/tts/models')).toHaveLength(1)
    expect(fetchFake.findRequests('GET', '/api/tts/voices')).toHaveLength(1)
  })

  it.each([
    { label: 'TTS is disabled', tts: { enabled: false } },
    { label: 'the builtin provider is selected', tts: { provider: 'builtin', voice: 'Alex' } },
    { label: 'the API key is missing', tts: { apiKey: '' } },
  ])('skips server discovery while $label', async ({ tts }) => {
    const { fetchFake } = renderTtsSettings({ tts })

    expect(await findClearCacheButton()).toBeInTheDocument()
    expect(fetchFake.findRequests('GET', '/api/tts/models')).toHaveLength(0)
    expect(fetchFake.findRequests('GET', '/api/tts/voices')).toHaveLength(0)
  })
})
