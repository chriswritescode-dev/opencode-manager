import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { TTSSettings } from './TTSSettings'
import { useSettings } from '@/hooks/useSettings'
import { useTTS } from '@/hooks/useTTS'
import { useTTSModels, useTTSVoices, useTTSDiscovery } from '@/hooks/useTTSDiscovery'
import { getAvailableVoiceNames, isWebSpeechSupported } from '@/lib/webSpeechSynthesizer'
import { createUseSettingsMock } from '@/test/test-utils'
import type { UserPreferences } from '@/api/types/settings'

vi.mock('@/hooks/useSettings')
vi.mock('@/hooks/useTTS')
vi.mock('@/hooks/useTTSDiscovery')
vi.mock('@/lib/webSpeechSynthesizer')

const fetchMock = vi.fn()

const baseTts: NonNullable<UserPreferences['tts']> = {
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

function buildPreferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    theme: 'dark',
    mode: 'build',
    autoScroll: true,
    expandDiffs: true,
    expandToolCalls: false,
    showReasoning: false,
    simpleChatMode: false,
    keyboardShortcuts: {},
    customCommands: [],
    tts: baseTts,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderTTSSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return render(<TTSSettings />, { wrapper: Wrapper })
}

function mockHooks(preferences: UserPreferences = buildPreferences()) {
  vi.mocked(useSettings).mockReturnValue(createUseSettingsMock({ preferences }))
  vi.mocked(useTTS).mockReturnValue({
    speak: vi.fn(),
    speakWithConfig: vi.fn(),
    speakMessage: vi.fn(),
    stop: vi.fn(),
    state: 'idle',
    error: null,
    currentText: null,
    originalText: null,
    activeMessageId: null,
    isEnabled: true,
    isPlaying: false,
    isLoading: false,
    isIdle: true,
  })
  vi.mocked(useTTSDiscovery).mockReturnValue({
    refreshModels: vi.fn(),
    refreshVoices: vi.fn(),
    refreshAll: vi.fn(),
    invalidateModels: vi.fn(),
    invalidateVoices: vi.fn(),
    invalidateAll: vi.fn(),
  })
  vi.mocked(useTTSModels).mockReturnValue({
    data: undefined,
    isLoading: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useTTSModels>)
  vi.mocked(useTTSVoices).mockReturnValue({
    data: undefined,
    isLoading: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useTTSVoices>)
  vi.mocked(isWebSpeechSupported).mockReturnValue(true)
  vi.mocked(getAvailableVoiceNames).mockResolvedValue(['Alex'])
}

describe('TTSSettings audio cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    mockHooks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears the server cache via DELETE /api/tts/cache and reports the count', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse({ cleared: 3 }))
    renderTTSSettings()

    await user.click(screen.getByRole('button', { name: 'Clear audio cache' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Cleared 3 cached audio file(s).')
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/api/tts/cache')
    expect(options).toMatchObject({ method: 'DELETE' })
  })

  it('disables the button and shows a pending label while clearing', async () => {
    const user = userEvent.setup()
    let resolveResponse: (response: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )
    renderTTSSettings()

    await user.click(screen.getByRole('button', { name: 'Clear audio cache' }))

    const pendingButton = screen.getByRole('button', { name: /clearing/i })
    expect(pendingButton).toBeDisabled()

    resolveResponse(jsonResponse({ cleared: 1 }))
    expect(await screen.findByRole('status')).toHaveTextContent('Cleared 1 cached audio file(s).')
  })

  it('shows an actionable error and allows retrying after a failure', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'cache unavailable' }, 500))
      .mockResolvedValueOnce(jsonResponse({ cleared: 2 }))
    renderTTSSettings()

    await user.click(screen.getByRole('button', { name: 'Clear audio cache' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('cache unavailable')
    const retryButton = screen.getByRole('button', { name: 'Clear audio cache' })
    expect(retryButton).toBeEnabled()

    await user.click(retryButton)

    expect(await screen.findByRole('status')).toHaveTextContent('Cleared 2 cached audio file(s).')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stays available when TTS is disabled or the builtin provider is selected', async () => {
    mockHooks(buildPreferences({ tts: { ...baseTts, enabled: false } }))
    const disabledRender = renderTTSSettings()
    expect(screen.getByRole('button', { name: 'Clear audio cache' })).toBeInTheDocument()
    disabledRender.unmount()

    mockHooks(buildPreferences({ tts: { ...baseTts, provider: 'builtin', voice: 'Alex' } }))
    renderTTSSettings()
    expect(screen.getByRole('button', { name: 'Clear audio cache' })).toBeInTheDocument()
    expect(await screen.findByText('1 voices available in your browser')).toBeInTheDocument()
  })
})
