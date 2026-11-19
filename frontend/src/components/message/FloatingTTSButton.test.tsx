import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { TTSConfig } from '@opencode-manager/shared'
import { FloatingTTSButton } from './FloatingTTSButton'
import { renderWithProviders } from '@/test/render'
import { installSpeechSynthesis } from '@/test/browserFakes'
import { makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import { DEFAULT_TTS_CONFIG } from '@opencode-manager/shared/schemas'

const TEST_MESSAGE_ID = 'test-message-1'
const TEST_CONTENT = 'Test content'

const speech = installSpeechSynthesis(['Test Voice'])
const UtteranceConstructor = globalThis.SpeechSynthesisUtterance

interface TtsFixture {
  enabled?: boolean
  autoPlay?: boolean
  provider?: TTSConfig['provider']
  apiKey?: string
}

function makeTtsConfig(overrides: TtsFixture = {}): TTSConfig {
  return {
    ...DEFAULT_TTS_CONFIG,
    enabled: true,
    provider: 'builtin',
    voice: 'Test Voice',
    apiKey: 'test-key',
    ...overrides,
  }
}

async function renderButton(options: {
  tts?: TtsFixture
  content?: string
  isScrolledUp?: boolean
  messageId?: string
  onSpeakVisible?: () => void
  extraRouteBody?: 'pending'
} = {}) {
  const tts = makeTtsConfig(options.tts)
  const settings = makeSettingsResponse({ preferences: makeUserPreferences({ tts }) })
  const result = renderWithProviders(
    <FloatingTTSButton
      messageId={options.messageId ?? TEST_MESSAGE_ID}
      content={options.content ?? TEST_CONTENT}
      isScrolledUp={options.isScrolledUp ?? false}
      onSpeakVisible={options.onSpeakVisible ?? vi.fn()}
    />,
    {
      tts: true,
      fetchRoutes: [
        { method: 'GET', path: '/api/settings', respond: () => ({ json: settings }) },
        {
          method: 'PATCH',
          path: '/api/settings',
          respond: () => ({ json: makeSettingsResponse({ preferences: makeUserPreferences({ tts }) }) }),
        },
        {
          method: 'POST',
          path: '/api/tts/synthesize',
          respond: () => (options.extraRouteBody === 'pending' ? new Promise(() => {}) : { blob: new Blob(['audio']) }),
        },
      ],
    },
  )
  await waitFor(() => expect(result.queryClient.getQueryData(['settings', 'default'])).toBeDefined())
  return { ...result, tts }
}


async function renderTwoButtons(options: { scrolledUpFirst: boolean, onSpeakVisible?: () => void }) {
  const tts = makeTtsConfig()
  const settings = makeSettingsResponse({ preferences: makeUserPreferences({ tts }) })
  const result = renderWithProviders(
    <div>
      <FloatingTTSButton
        messageId={TEST_MESSAGE_ID}
        content={TEST_CONTENT}
        isScrolledUp={options.scrolledUpFirst}
        onSpeakVisible={options.onSpeakVisible ?? vi.fn()}
      />
      <FloatingTTSButton messageId="other-message-id" content="Other reply" isScrolledUp={false} onSpeakVisible={vi.fn()} />
    </div>,
    {
      tts: true,
      fetchRoutes: [
        { method: 'GET', path: '/api/settings', respond: () => ({ json: settings }) },
      ],
    },
  )
  await waitFor(() => expect(result.queryClient.getQueryData(['settings', 'default'])).toBeDefined())
  return result
}

async function press(button: HTMLElement): Promise<void> {
  fireEvent.pointerDown(button)
  await act(async () => {
    fireEvent.pointerUp(button)
  })
}

async function longPress(button: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(button)
    await new Promise((resolve) => {
      setTimeout(resolve, 600)
    })
    fireEvent.pointerUp(button)
  })
}

describe('FloatingTTSButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('speechSynthesis', speech)
    vi.stubGlobal('SpeechSynthesisUtterance', UtteranceConstructor)
    speech.spoken.length = 0
    speech.cancel.mockClear()
  })

  it.each(['', '   '])('keeps the pill for %j content when autoplay is enabled', async (content) => {
    await renderButton({ content, tts: { autoPlay: true } })

    expect(await screen.findByRole('button', { name: /hold to toggle auto-play/i })).toBeInTheDocument()
  })

  it('speaks the latest reply on tap when idle', async () => {
    const onSpeakVisible = vi.fn()
    await renderButton({ onSpeakVisible })

    const button = await screen.findByRole('button', { name: /play latest reply/i })
    await press(button)

    await waitFor(() => expect(speech.spoken.map((entry) => entry.text)).toContain(TEST_CONTENT))
    expect(onSpeakVisible).not.toHaveBeenCalled()
  })

  it('stops playback on tap when this message is playing', async () => {
    await renderButton()

    await press(await screen.findByRole('button', { name: /play latest reply/i }))
    const stopButton = await screen.findByRole('button', { name: /stop playback/i })
    await press(stopButton)

    expect(speech.cancel).toHaveBeenCalled()
  })

  it('shows stop for a message that is not the active playback and stops it on tap', async () => {
    await renderTwoButtons({ scrolledUpFirst: false })

    const thisButton = screen.getAllByRole('button', { name: /play latest reply/i })[0]
    const otherButton = screen.getAllByRole('button', { name: /play latest reply/i })[1]
    await press(otherButton)
    await waitFor(() => expect(speech.spoken.length).toBe(1))

    expect(thisButton).toHaveAccessibleName(/stop playback/i)
    await press(thisButton)

    expect(speech.cancel).toHaveBeenCalled()
    expect(speech.spoken.map((entry) => entry.text)).toEqual(['Other reply'])
  })

  it('enables autoplay on long press and announces it', async () => {
    const { fetchFake } = await renderButton({ tts: { autoPlay: false } })

    const button = await screen.findByRole('button', { name: /play latest reply/i })
    await longPress(button)

    expect(fetchFake.lastRequest('PATCH', '/api/settings')?.body).toMatchObject({
      preferences: { tts: { autoPlay: true, enabled: true, provider: 'builtin', voice: 'Test Voice' } },
    })
    expect(await screen.findByText('Auto-play enabled')).toBeInTheDocument()
    expect(speech.spoken).toHaveLength(0)
  })

  it('disables autoplay on long press and announces it', async () => {
    const { fetchFake } = await renderButton({ tts: { autoPlay: true } })

    const button = await screen.findByRole('button', { name: /auto-play enabled/i })
    await longPress(button)

    expect(fetchFake.lastRequest('PATCH', '/api/settings')?.body).toMatchObject({
      preferences: { tts: { autoPlay: false } },
    })
    expect(await screen.findByText('Auto-play disabled')).toBeInTheDocument()
  })

  it.each(['pointer up', 'pointer leave'])('does not speak after a long press that ends with %s', async (ending) => {
    await renderButton()

    const button = await screen.findByRole('button', { name: /play latest reply/i })
    await act(async () => {
      fireEvent.pointerDown(button)
      await new Promise((resolve) => {
        setTimeout(resolve, 600)
      })
      fireEvent[ending === 'pointer up' ? 'pointerUp' : 'pointerLeave'](button)
    })

    expect(speech.spoken).toHaveLength(0)
  })

  it('exposes the gesture hint in the aria-label for accessibility', async () => {
    await renderButton()

    const button = await screen.findByRole('button', { name: /hold to toggle auto-play/i })
    expect(button).toBeInTheDocument()
  })

  it('shows the stop icon while this message is playing', async () => {
    await renderButton({ tts: { autoPlay: true } })

    await press(await screen.findByRole('button', { name: /play latest reply/i }))

    const button = await screen.findByRole('button', { name: /stop playback/i })
    expect(button).toHaveClass('bg-destructive')
    expect(button).toHaveClass('rounded-lg')
    expect(button).not.toHaveClass('rounded-full')
    expect(screen.queryByText('Stop')).not.toBeInTheDocument()
  })

  it('shows the same stop icon while the reply is still loading', async () => {
    await renderButton({ tts: { provider: 'external' }, extraRouteBody: 'pending' })

    await press(await screen.findByRole('button', { name: /play latest reply/i }))

    expect(await screen.findByRole('button', { name: /stop playback/i })).toHaveClass('bg-destructive')
  })

  it('shows the autoplay color when autoplay is enabled', async () => {
    await renderButton({ tts: { autoPlay: true } })

    const button = await screen.findByRole('button', { name: /auto-play enabled/i })

    expect(button).toHaveClass('bg-primary')
    expect(button).toHaveClass('rounded-lg')
    expect(screen.queryByText('Play')).not.toBeInTheDocument()
    expect(screen.queryByText('Auto')).not.toBeInTheDocument()
  })

  it('uses the default play color when autoplay is disabled', async () => {
    await renderButton({ tts: { autoPlay: false } })

    const button = await screen.findByRole('button', { name: /play latest reply/i })

    expect(button).toHaveClass('from-warning')
    expect(button).not.toHaveClass('bg-primary')
    expect(screen.queryByText('Play')).not.toBeInTheDocument()
  })

  it('reads the visible replies on tap when scrolled up and idle', async () => {
    const onSpeakVisible = vi.fn()
    await renderButton({ isScrolledUp: true, onSpeakVisible })

    await press(await screen.findByRole('button', { name: /read visible replies/i }))

    expect(onSpeakVisible).toHaveBeenCalledTimes(1)
    expect(speech.spoken).toHaveLength(0)
  })

  it('stops playback on tap when scrolled up while another reply plays', async () => {
    const onSpeakVisible = vi.fn()
    await renderTwoButtons({ scrolledUpFirst: true, onSpeakVisible })

    const scrolledUpButton = screen.getByRole('button', { name: /read visible replies/i })
    const otherButton = screen.getByRole('button', { name: /play latest reply/i })
    await press(otherButton)
    await waitFor(() => expect(speech.spoken.length).toBe(1))

    await press(scrolledUpButton)

    expect(speech.cancel).toHaveBeenCalled()
    expect(onSpeakVisible).not.toHaveBeenCalled()
  })
})
