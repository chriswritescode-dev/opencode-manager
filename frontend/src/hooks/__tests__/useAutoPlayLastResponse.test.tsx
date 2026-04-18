import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { MessageWithParts } from '../../api/types'
import type { TTSConfig } from '@opencode-manager/shared'

const mocks = vi.hoisted(() => ({
  useTTS: vi.fn(),
  useSettings: vi.fn(),
}))

vi.mock('../useTTS', () => ({
  useTTS: mocks.useTTS,
}))

vi.mock('../useSettings', () => ({
  useSettings: mocks.useSettings,
}))

interface MockTTSReturn {
  speak: ReturnType<typeof vi.fn>
  speakMessage: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  isEnabled: boolean
  isPlaying: boolean
  isLoading: boolean
  originalText: string | null
  activeMessageId: string | null
}

import { useAutoPlayLastResponse } from '../useAutoPlayLastResponse'

const createMessage = (id: string, completed?: number): MessageWithParts => ({
  info: {
    id,
    sessionID: 'test-session',
    role: 'assistant',
    time: {
      created: Date.now(),
      ...(completed ? { completed } : {}),
    },
    parentID: 'parent-1',
    modelID: 'gpt-4',
    providerID: 'openai',
    mode: 'build',
    agent: 'default',
    path: {
      cwd: '/test',
      root: '/test',
    },
    cost: 0.01,
    tokens: {
      input: 100,
      output: 50,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  },
  parts: [
    {
      id: 'part-1',
      sessionID: 'test-session',
      messageID: id,
      type: 'text',
      text: 'Test message text',
      time: {
        start: Date.now(),
        end: Date.now() + 100,
      },
    },
  ],
})

describe('useAutoPlayLastResponse', () => {
  const mockSpeak = vi.fn()
  const mockSpeakMessage = vi.fn()
  const mockStop = vi.fn()
  const mockUpdateSettings = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSpeak.mockClear()
    mockSpeakMessage.mockClear()
    mockStop.mockClear()
    mockUpdateSettings.mockClear()
  })

  const setup = (options: {
    ttsEnabled?: boolean
    autoPlay?: boolean
  } = {}) => {
    const mockTTS: MockTTSReturn = {
      speak: mockSpeak,
      speakMessage: mockSpeakMessage,
      stop: mockStop,
      isEnabled: options.ttsEnabled ?? true,
      isPlaying: false,
      isLoading: false,
      originalText: null,
      activeMessageId: null,
    }
    mocks.useTTS.mockReturnValue(mockTTS)

    mocks.useSettings.mockReturnValue({
      preferences: {
        tts: {
          enabled: options.ttsEnabled ?? true,
          autoPlay: options.autoPlay ?? true,
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

  it('does NOT call speakMessage when tts.enabled is false', () => {
    setup({ ttsEnabled: false, autoPlay: true })

    const message = createMessage('1', Date.now())
    renderHook(() =>
      useAutoPlayLastResponse({
        sessionId: 'test-session',
        lastAssistantMessage: message,
        lastAssistantText: 'Test text',
        hasActiveStream: false,
      })
    )

    expect(mockSpeakMessage).not.toHaveBeenCalled()
  })

  it('does NOT call speakMessage when tts.autoPlay is false', () => {
    setup({ ttsEnabled: true, autoPlay: false })

    const message = createMessage('1', Date.now())
    renderHook(() =>
      useAutoPlayLastResponse({
        sessionId: 'test-session',
        lastAssistantMessage: message,
        lastAssistantText: 'Test text',
        hasActiveStream: false,
      })
    )

    expect(mockSpeakMessage).not.toHaveBeenCalled()
  })

  it('does NOT call speakMessage on mount when last message was already time.completed', () => {
    setup()

    const message = createMessage('1', Date.now() - 1000)
    renderHook(() =>
      useAutoPlayLastResponse({
        sessionId: 'test-session',
        lastAssistantMessage: message,
        lastAssistantText: 'Test text',
        hasActiveStream: false,
      })
    )

    expect(mockSpeakMessage).not.toHaveBeenCalled()
  })

  it('CALLS speakMessage exactly once when lastAssistantMessage transitions from incomplete to completed', () => {
    setup()

    const incompleteMessage = createMessage('1')
    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'test-session',
          lastAssistantMessage: incompleteMessage,
          lastAssistantText: 'Test text',
          hasActiveStream: false,
        },
      }
    )

    expect(mockSpeakMessage).not.toHaveBeenCalled()

    const completedMessage = createMessage('1', Date.now())
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: completedMessage,
      lastAssistantText: 'Test text',
      hasActiveStream: false,
    })

    expect(mockSpeakMessage).toHaveBeenCalledTimes(1)
    expect(mockSpeakMessage).toHaveBeenCalledWith('1', 'Test text')
  })

  it('does NOT call speakMessage twice for the same message id across multiple rerenders', () => {
    setup()

    const message = createMessage('1', Date.now())
    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'test-session',
          lastAssistantMessage: message,
          lastAssistantText: 'Test text',
          hasActiveStream: false,
        },
      }
    )

    expect(mockSpeakMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: message,
      lastAssistantText: 'Test text',
      hasActiveStream: false,
    })

    expect(mockSpeakMessage).not.toHaveBeenCalled()
  })

  it('CALLS speakMessage for a subsequent new message id after the baseline', () => {
    setup()

    const firstMessage = createMessage('1', Date.now() - 2000)
    
    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'test-session',
          lastAssistantMessage: firstMessage,
          lastAssistantText: 'First text',
          hasActiveStream: false,
        },
      }
    )

    expect(mockSpeakMessage).not.toHaveBeenCalled()

    const secondMessage = createMessage('2', Date.now())
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: secondMessage,
      lastAssistantText: 'Second text',
      hasActiveStream: false,
    })

    expect(mockSpeakMessage).toHaveBeenCalledTimes(1)
    expect(mockSpeakMessage).toHaveBeenCalledWith('2', 'Second text')
  })

  it('resets baseline when sessionId changes', () => {
    setup()

    const message1 = createMessage('1', Date.now() - 2000)
    
    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'session-1',
          lastAssistantMessage: message1,
          lastAssistantText: 'Session 1 text',
          hasActiveStream: false,
        },
      }
    )

    expect(mockSpeakMessage).not.toHaveBeenCalled()

    const message2 = createMessage('1', Date.now())
    rerender({
      sessionId: 'session-2',
      lastAssistantMessage: message2,
      lastAssistantText: 'Session 2 text',
      hasActiveStream: false,
    })

    expect(mockSpeakMessage).toHaveBeenCalledTimes(1)
    expect(mockSpeakMessage).toHaveBeenCalledWith('1', 'Session 2 text')
  })

  it('does NOT call speakMessage when hasActiveStream is true', () => {
    setup()

    const message = createMessage('1', Date.now())
    renderHook(() =>
      useAutoPlayLastResponse({
        sessionId: 'test-session',
        lastAssistantMessage: message,
        lastAssistantText: 'Test text',
        hasActiveStream: true,
      })
    )

    expect(mockSpeakMessage).not.toHaveBeenCalled()
  })

  it('does NOT call speakMessage when lastAssistantText is empty', () => {
    setup()

    const message = createMessage('1', Date.now())
    renderHook(() =>
      useAutoPlayLastResponse({
        sessionId: 'test-session',
        lastAssistantMessage: message,
        lastAssistantText: '',
        hasActiveStream: false,
      })
    )

    expect(mockSpeakMessage).not.toHaveBeenCalled()
  })

  it('does NOT call speakMessage when lastAssistantText is whitespace only', () => {
    setup()

    const message = createMessage('1', Date.now())
    renderHook(() =>
      useAutoPlayLastResponse({
        sessionId: 'test-session',
        lastAssistantMessage: message,
        lastAssistantText: '   ',
        hasActiveStream: false,
      })
    )

    expect(mockSpeakMessage).not.toHaveBeenCalled()
  })
})
