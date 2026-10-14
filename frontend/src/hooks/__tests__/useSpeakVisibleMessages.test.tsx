import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { RefObject } from 'react'
import type { SessionMessageAssistant, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import type { TTSState } from '@/hooks/useTTS'

const mocks = vi.hoisted(() => ({
  useTTS: vi.fn(),
  showToastError: vi.fn(),
}))

vi.mock('@/hooks/useTTS', () => ({
  useTTS: mocks.useTTS,
}))

vi.mock('@/lib/toast', () => ({
  showToast: { error: mocks.showToastError },
}))

import { useSpeakVisibleMessages } from '../useSpeakVisibleMessages'

interface MockTTSReturn {
  speak: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  isEnabled: boolean
  isPlaying: boolean
  isLoading: boolean
  state: TTSState
  error: string | null
  activeMessageId: string | null
}

const rect = (top: number, bottom: number): DOMRect => ({
  top,
  bottom,
  left: 0,
  right: 100,
  width: 100,
  height: bottom - top,
  x: 0,
  y: top,
  toJSON: () => ({}),
} as DOMRect)

const buildContainer = (messageId: string): HTMLDivElement => {
  const container = document.createElement('div')
  container.getBoundingClientRect = () => rect(0, 100)
  const element = document.createElement('div')
  element.dataset.messageId = messageId
  element.getBoundingClientRect = () => rect(10, 30)
  container.appendChild(element)
  return container
}

const assistantMessage = (id: string, text: string): SessionMessageAssistant => ({
  id,
  type: 'assistant',
  agent: 'test-agent',
  model: { providerID: 'test-provider', id: 'test-model' },
  content: [{ type: 'text', text }],
  time: { created: 1, completed: 2 },
})

describe('useSpeakVisibleMessages', () => {
  const mockSpeak = vi.fn()
  const mockStop = vi.fn()

  const setupTTS = (overrides: Partial<MockTTSReturn> = {}) => {
    const value: MockTTSReturn = {
      speak: mockSpeak,
      stop: mockStop,
      isEnabled: true,
      isPlaying: false,
      isLoading: false,
      state: 'idle',
      error: null,
      activeMessageId: null,
      ...overrides,
    }
    mocks.useTTS.mockReturnValue(value)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSpeak.mockResolvedValue(true)
  })

  it('stops playback while playing', () => {
    setupTTS({ isPlaying: true })
    const containerRef: RefObject<HTMLElement | null> = { current: null }

    const { result } = renderHook(() =>
      useSpeakVisibleMessages(containerRef, [], 0)
    )

    result.current()

    expect(mockStop).toHaveBeenCalledTimes(1)
    expect(mockSpeak).not.toHaveBeenCalled()
  })

  it('speaks the visible assistant texts joined by a blank line', () => {
    setupTTS()
    const container = buildContainer('a1')
    const containerRef: RefObject<HTMLElement | null> = { current: container }
    const messages: SessionMessageInfo[] = [assistantMessage('a1', 'hello world')]

    const { result } = renderHook(() =>
      useSpeakVisibleMessages(containerRef, messages, 0)
    )

    result.current()

    expect(mockSpeak).toHaveBeenCalledTimes(1)
    expect(mockSpeak).toHaveBeenCalledWith('hello world')
  })

  it('does nothing when TTS is disabled', () => {
    setupTTS({ isEnabled: false })
    const container = buildContainer('a1')
    const containerRef: RefObject<HTMLElement | null> = { current: container }
    const messages: SessionMessageInfo[] = [assistantMessage('a1', 'hello world')]

    const { result } = renderHook(() =>
      useSpeakVisibleMessages(containerRef, messages, 0)
    )

    result.current()

    expect(mockSpeak).not.toHaveBeenCalled()
  })

  it('shows an error toast once after shortcut-started playback fails', () => {
    setupTTS()
    const container = buildContainer('a1')
    const containerRef: RefObject<HTMLElement | null> = { current: container }
    const messages: SessionMessageInfo[] = [assistantMessage('a1', 'hello world')]

    const { result, rerender } = renderHook(() =>
      useSpeakVisibleMessages(containerRef, messages, 0)
    )

    result.current()
    expect(mockSpeak).toHaveBeenCalledTimes(1)

    setupTTS({ state: 'error', error: 'network failure' })
    rerender()

    expect(mocks.showToastError).toHaveBeenCalledTimes(1)
    expect(mocks.showToastError).toHaveBeenCalledWith('network failure')

    setupTTS({ state: 'error', error: 'another failure' })
    rerender()

    expect(mocks.showToastError).toHaveBeenCalledTimes(1)
  })

  it('does not toast when shortcut-started playback returns to idle', () => {
    setupTTS()
    const container = buildContainer('a1')
    const containerRef: RefObject<HTMLElement | null> = { current: container }
    const messages: SessionMessageInfo[] = [assistantMessage('a1', 'hello world')]

    const { result, rerender } = renderHook(() =>
      useSpeakVisibleMessages(containerRef, messages, 0)
    )

    result.current()

    setupTTS({ state: 'playing' })
    rerender()

    setupTTS({ state: 'idle' })
    rerender()

    setupTTS({ state: 'error', error: 'late failure' })
    rerender()

    expect(mocks.showToastError).not.toHaveBeenCalled()
  })

  it('does not toast when playback becomes message-attributed', () => {
    setupTTS()
    const container = buildContainer('a1')
    const containerRef: RefObject<HTMLElement | null> = { current: container }
    const messages: SessionMessageInfo[] = [assistantMessage('a1', 'hello world')]

    const { result, rerender } = renderHook(() =>
      useSpeakVisibleMessages(containerRef, messages, 0)
    )

    result.current()

    setupTTS({ state: 'playing', activeMessageId: 'a1' })
    rerender()

    setupTTS({ state: 'error', error: 'late failure', activeMessageId: 'a1' })
    rerender()

    expect(mocks.showToastError).not.toHaveBeenCalled()
  })
})
