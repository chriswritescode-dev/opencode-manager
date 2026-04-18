import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FloatingTTSButton } from './FloatingTTSButton'
import type { TTSConfig } from '@opencode-manager/shared'

const mocks = vi.hoisted(() => ({
  useTTS: vi.fn(),
  useSettings: vi.fn(),
  showToastInfo: vi.fn(),
}))

vi.mock('@/hooks/useTTS', () => ({
  useTTS: mocks.useTTS,
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    info: mocks.showToastInfo,
  },
}))

interface MockTTSReturn {
  speakMessage: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  activeMessageId: string | null
  isPlaying: boolean
  isLoading: boolean
  isEnabled: boolean
}

describe('FloatingTTSButton', () => {
  const mockSpeakMessage = vi.fn()
  const mockStop = vi.fn()
  const mockUpdateSettings = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSpeakMessage.mockClear()
    mockStop.mockClear()
    mockUpdateSettings.mockClear()
    mocks.showToastInfo.mockClear()
  })

  const setup = (options: {
    ttsEnabled?: boolean
    autoPlay?: boolean
    activeMessageId?: string | null
    isPlaying?: boolean
    isLoading?: boolean
  } = {}) => {
    const mockTTS: MockTTSReturn = {
      speakMessage: mockSpeakMessage,
      stop: mockStop,
      activeMessageId: options.activeMessageId ?? null,
      isPlaying: options.isPlaying ?? false,
      isLoading: options.isLoading ?? false,
      isEnabled: options.ttsEnabled ?? true,
    }
    mocks.useTTS.mockReturnValue(mockTTS)

    mocks.useSettings.mockReturnValue({
      preferences: {
        tts: {
          enabled: options.ttsEnabled ?? true,
          autoPlay: options.autoPlay ?? false,
          provider: 'external',
          endpoint: 'https://api.openai.com',
          apiKey: 'test-key',
          voice: 'alloy',
          model: 'tts-1',
          speed: 1.0,
        } as TTSConfig,
      },
      updateSettings: mockUpdateSettings,
    })
  }

  const TEST_MESSAGE_ID = 'test-message-1'
  const TEST_CONTENT = 'Test content'

  it('renders pill when content is empty but autoplay is enabled', () => {
    setup({ autoPlay: true })
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content="" />)
    expect(screen.getByRole('button', { name: /hold to toggle auto-play/i })).toBeInTheDocument()
  })

  it('renders pill when content is whitespace but autoplay is enabled', () => {
    setup({ autoPlay: true })
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content="   " />)
    expect(screen.getByRole('button', { name: /hold to toggle auto-play/i })).toBeInTheDocument()
  })

  it('calls speakMessage on tap when idle', () => {
    setup()
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content={TEST_CONTENT} />)

    const button = screen.getByRole('button', { name: /play latest reply/i })
    fireEvent.pointerDown(button)
    act(() => {
      fireEvent.pointerUp(button)
    })

    expect(mockSpeakMessage).toHaveBeenCalledTimes(1)
    expect(mockSpeakMessage).toHaveBeenCalledWith(TEST_MESSAGE_ID, TEST_CONTENT)
  })

  it('calls stop on tap when this message is active', () => {
    setup({ activeMessageId: TEST_MESSAGE_ID, isPlaying: true })
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content={TEST_CONTENT} />)

    const button = screen.getByRole('button', { name: /stop playback/i })
    fireEvent.pointerDown(button)
    act(() => {
      fireEvent.pointerUp(button)
    })

    expect(mockStop).toHaveBeenCalledTimes(1)
    expect(mockSpeakMessage).not.toHaveBeenCalled()
  })

  it('calls stop when any playback is active, even for a different messageId (stream conflict fix)', () => {
    setup({ activeMessageId: 'other-message-id', isPlaying: true })
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content={TEST_CONTENT} />)

    const button = screen.getByRole('button', { name: /stop playback/i })
    fireEvent.pointerDown(button)
    act(() => {
      fireEvent.pointerUp(button)
    })

    expect(mockStop).toHaveBeenCalledTimes(1)
    expect(mockSpeakMessage).not.toHaveBeenCalled()
  })

  it('toggles autoplay on long press', async () => {
    vi.useFakeTimers()
    setup({ autoPlay: false })
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content={TEST_CONTENT} />)

    const button = screen.getByRole('button', { name: /play latest reply/i })
    await act(async () => {
      fireEvent.pointerDown(button)
      await vi.advanceTimersByTimeAsync(500)
      fireEvent.pointerUp(button)
    })

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      tts: {
        autoPlay: true,
        enabled: true,
        provider: 'external',
        endpoint: 'https://api.openai.com',
        apiKey: 'test-key',
        voice: 'alloy',
        model: 'tts-1',
        speed: 1.0,
      },
    })
    expect(mocks.showToastInfo).toHaveBeenCalledWith('Auto-play enabled', {
      id: 'tts-autoplay-toggle',
      duration: 1800,
    })

    vi.useRealTimers()
  })

  it('shows a toast when long press disables autoplay', async () => {
    vi.useFakeTimers()
    setup({ autoPlay: true })
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content={TEST_CONTENT} />)

    const button = screen.getByRole('button', { name: /auto-play enabled/i })
    await act(async () => {
      fireEvent.pointerDown(button)
      await vi.advanceTimersByTimeAsync(500)
      fireEvent.pointerUp(button)
    })

    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ tts: expect.objectContaining({ autoPlay: false }) })
    )
    expect(mocks.showToastInfo).toHaveBeenCalledWith('Auto-play disabled', {
      id: 'tts-autoplay-toggle',
      duration: 1800,
    })

    vi.useRealTimers()
  })

  it('does not call speakMessage after long press (race guard)', async () => {
    vi.useFakeTimers()
    setup()
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content={TEST_CONTENT} />)

    const button = screen.getByRole('button', { name: /play latest reply/i })
    await act(async () => {
      fireEvent.pointerDown(button)
      await vi.advanceTimersByTimeAsync(500)
      fireEvent.pointerUp(button)
    })

    expect(mockSpeakMessage).not.toHaveBeenCalled()
    expect(mockStop).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not call speakMessage if pointer leaves before release after long press fires', async () => {
    vi.useFakeTimers()
    setup()
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content={TEST_CONTENT} />)

    const button = screen.getByRole('button', { name: /play latest reply/i })
    await act(async () => {
      fireEvent.pointerDown(button)
      await vi.advanceTimersByTimeAsync(500)
      fireEvent.pointerLeave(button)
    })

    expect(mockSpeakMessage).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('exposes the gesture hint in the aria-label for accessibility', () => {
    setup()
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content={TEST_CONTENT} />)

    const button = screen.getByRole('button', { name: /hold to toggle auto-play/i })
    expect(button).toBeInTheDocument()
  })

  it('shows stop icon when this message is playing', () => {
    setup({ autoPlay: true, activeMessageId: TEST_MESSAGE_ID, isPlaying: true })
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content={TEST_CONTENT} />)

    const button = screen.getByRole('button', { name: /stop playback/i })

    expect(button).toHaveClass('from-red-600')
    expect(button).toHaveClass('rounded-lg')
    expect(button).not.toHaveClass('rounded-full')
    expect(button).not.toHaveClass('hidden')
    expect(screen.queryByText('Stop')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Autoplay enabled')).not.toBeInTheDocument()
  })

  it('shows the same stop icon while this message is loading', () => {
    setup({ activeMessageId: TEST_MESSAGE_ID, isLoading: true })
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content={TEST_CONTENT} />)

    expect(screen.getByRole('button', { name: /stop playback/i })).toHaveClass('from-red-600')
  })

  it('shows autoplay state with button color when autoPlay is enabled', () => {
    setup({ autoPlay: true })
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content={TEST_CONTENT} />)

    const button = screen.getByRole('button', { name: /auto-play enabled/i })

    expect(button).toHaveClass('from-blue-500')
    expect(button).toHaveClass('rounded-lg')
    expect(screen.queryByText('Play')).not.toBeInTheDocument()
    expect(screen.queryByText('Auto')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Autoplay enabled')).not.toBeInTheDocument()
  })

  it('uses the default play color when autoPlay is disabled', () => {
    setup({ autoPlay: false })
    render(<FloatingTTSButton messageId={TEST_MESSAGE_ID} content={TEST_CONTENT} />)

    const button = screen.getByRole('button', { name: /play latest reply/i })

    expect(button).toHaveClass('from-amber-500')
    expect(button).not.toHaveClass('from-blue-500')
    expect(screen.queryByText('Play')).not.toBeInTheDocument()
  })
})
