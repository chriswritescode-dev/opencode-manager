import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { SessionMessageAssistant } from '@opencode-manager/shared/opencode'
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
  queueMessage: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  isEnabled: boolean
  isPlaying: boolean
  isLoading: boolean
  originalText: string | null
  activeMessageId: string | null
}

import { getLatestPlayableAssistantMessage, useAutoPlayLastResponse } from '../useAutoPlayLastResponse'

const createMessage = (
  id: string,
  completed?: number,
  text = 'Test message text',
  finish?: SessionMessageAssistant['finish'],
): SessionMessageAssistant => ({
  id,
  type: 'assistant',
  agent: 'default',
  model: { providerID: 'openai', id: 'gpt-4' },
  time: {
    created: Date.now(),
    ...(completed ? { completed } : {}),
  },
  ...(finish ? { finish } : {}),
  content: [{ type: 'text', text }],
})

const createAssistantMessageWithoutText = (id: string): SessionMessageAssistant => ({
  id,
  type: 'assistant',
  agent: 'default',
  model: { providerID: 'openai', id: 'gpt-4' },
  time: { created: Date.now(), completed: Date.now() },
  content: [
    {
      type: 'tool',
      id: 'tool_1',
      name: 'question',
      state: {
        status: 'error',
        input: {},
        error: { type: 'tool.failed', message: 'Question rejected' },
      },
      time: { created: Date.now() },
    },
  ],
})

describe('useAutoPlayLastResponse', () => {
  const mockSpeak = vi.fn()
  const mockQueueMessage = vi.fn()
  const mockStop = vi.fn()
  const mockUpdateSettings = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSpeak.mockClear()
    mockQueueMessage.mockClear()
    mockStop.mockClear()
    mockUpdateSettings.mockClear()
  })

  const setup = (options: {
    ttsEnabled?: boolean
    autoPlay?: boolean
  } = {}) => {
    const mockTTS: MockTTSReturn = {
      speak: mockSpeak,
      queueMessage: mockQueueMessage,
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

    return mockTTS
  }

  it('does NOT call queueMessage when tts.enabled is false', () => {
    setup({ ttsEnabled: false, autoPlay: true })

    const message = createMessage('1', Date.now())
    renderHook(() =>
      useAutoPlayLastResponse({
        sessionId: 'test-session',
        lastAssistantMessage: message,
        lastAssistantText: 'Test text',
      })
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()
  })

  it('does NOT call queueMessage when tts.autoPlay is false', () => {
    setup({ ttsEnabled: true, autoPlay: false })

    const message = createMessage('1', Date.now())
    renderHook(() =>
      useAutoPlayLastResponse({
        sessionId: 'test-session',
        lastAssistantMessage: message,
        lastAssistantText: 'Test text',
      })
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()
  })

  it('does NOT call queueMessage on mount when last message was already time.completed', () => {
    setup()

    const message = createMessage('1', Date.now() - 1000)
    renderHook(() =>
      useAutoPlayLastResponse({
        sessionId: 'test-session',
        lastAssistantMessage: message,
        lastAssistantText: 'Test text',
      })
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()
  })

  it('CALLS queueMessage exactly once when lastAssistantMessage transitions from incomplete to completed', () => {
    setup()

    const incompleteMessage = createMessage('1')
    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'test-session',
          lastAssistantMessage: incompleteMessage,
          lastAssistantText: 'Test text',
        },
      }
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()

    const completedMessage = createMessage('1', Date.now())
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: completedMessage,
      lastAssistantText: 'Test text',
    })

    expect(mockQueueMessage).toHaveBeenCalledTimes(1)
    expect(mockQueueMessage).toHaveBeenCalledWith('1', 'Test text')
  })

  it('queues a completed tool-calls step narration and then the following final response for a session with a baseline', () => {
    setup()

    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'test-session',
          lastAssistantMessage: createMessage('0', Date.now()),
          lastAssistantText: 'Baseline text',
        },
      }
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1'),
      lastAssistantText: 'Narration',
    })

    expect(mockQueueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1', Date.now(), 'Narration', 'tool-calls'),
      lastAssistantText: 'Narration',
    })

    expect(mockQueueMessage).toHaveBeenCalledTimes(1)
    expect(mockQueueMessage).toHaveBeenNthCalledWith(1, '1', 'Narration')

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('2'),
      lastAssistantText: 'Final',
    })

    expect(mockQueueMessage).toHaveBeenCalledTimes(1)

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('2', Date.now(), 'Final', 'stop'),
      lastAssistantText: 'Final',
    })

    expect(mockQueueMessage).toHaveBeenCalledTimes(2)
    expect(mockQueueMessage).toHaveBeenNthCalledWith(1, '1', 'Narration')
    expect(mockQueueMessage).toHaveBeenNthCalledWith(2, '2', 'Final')
  })

  it('queues a completed tool-calls step narration and then the following final response for a fresh session', () => {
    setup()

    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'test-session',
          lastAssistantMessage: undefined,
          lastAssistantText: '',
        },
      }
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1'),
      lastAssistantText: 'Narration',
    })

    expect(mockQueueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1', Date.now(), 'Narration', 'tool-calls'),
      lastAssistantText: 'Narration',
    })

    expect(mockQueueMessage).toHaveBeenCalledTimes(1)
    expect(mockQueueMessage).toHaveBeenNthCalledWith(1, '1', 'Narration')

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('2', Date.now(), 'Final', 'stop'),
      lastAssistantText: 'Final',
    })

    expect(mockQueueMessage).toHaveBeenCalledTimes(2)
    expect(mockQueueMessage).toHaveBeenNthCalledWith(1, '1', 'Narration')
    expect(mockQueueMessage).toHaveBeenNthCalledWith(2, '2', 'Final')
  })

  it('does NOT call queueMessage when unattributed playback is active, and does not speak it after playback ends', () => {
    const mockTTS = setup()

    const incompleteMessage = createMessage('1')
    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'test-session',
          lastAssistantMessage: incompleteMessage,
          lastAssistantText: 'Test text',
        },
      }
    )

    mockTTS.isPlaying = true
    mockTTS.activeMessageId = null

    const completedMessage = createMessage('1', Date.now())
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: completedMessage,
      lastAssistantText: 'Test text',
    })

    expect(mockQueueMessage).not.toHaveBeenCalled()

    mockTTS.isPlaying = false
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: completedMessage,
      lastAssistantText: 'Test text',
    })

    expect(mockQueueMessage).not.toHaveBeenCalled()
  })

  it('CALLS queueMessage when a message-attributed playback is active', () => {
    const mockTTS = setup()

    const incompleteMessage = createMessage('1')
    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'test-session',
          lastAssistantMessage: incompleteMessage,
          lastAssistantText: 'Test text',
        },
      }
    )

    mockTTS.isPlaying = true
    mockTTS.activeMessageId = 'other-message'

    const completedMessage = createMessage('1', Date.now())
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: completedMessage,
      lastAssistantText: 'Test text',
    })

    expect(mockQueueMessage).toHaveBeenCalledTimes(1)
    expect(mockQueueMessage).toHaveBeenCalledWith('1', 'Test text')
  })

  it('does NOT call queueMessage twice for the same message id across multiple rerenders', () => {
    setup()

    const message = createMessage('1', Date.now())
    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'test-session',
          lastAssistantMessage: message,
          lastAssistantText: 'Test text',
        },
      }
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: message,
      lastAssistantText: 'Test text',
    })

    expect(mockQueueMessage).not.toHaveBeenCalled()
  })

  it('CALLS queueMessage for a subsequent new message id after the baseline', () => {
    setup()

    const firstMessage = createMessage('1', Date.now() - 2000)
    
    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'test-session',
          lastAssistantMessage: firstMessage,
          lastAssistantText: 'First text',
        },
      }
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()

    const secondMessage = createMessage('2', Date.now())
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: secondMessage,
      lastAssistantText: 'Second text',
    })

    expect(mockQueueMessage).toHaveBeenCalledTimes(1)
    expect(mockQueueMessage).toHaveBeenCalledWith('2', 'Second text')
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
        },
      }
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()

    const message2 = createMessage('1', Date.now())
    rerender({
      sessionId: 'session-2',
      lastAssistantMessage: message2,
      lastAssistantText: 'Session 2 text',
    })

    expect(mockQueueMessage).toHaveBeenCalledTimes(1)
    expect(mockQueueMessage).toHaveBeenCalledWith('1', 'Session 2 text')
  })

  it('CALLS queueMessage once for the first reply in a fresh session when it starts empty then streams to completion', () => {
    setup()

    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'test-session',
          lastAssistantMessage: undefined,
          lastAssistantText: '',
        },
      }
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1'),
      lastAssistantText: 'Test text',
    })

    expect(mockQueueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1', Date.now()),
      lastAssistantText: 'Test text',
    })

    expect(mockQueueMessage).toHaveBeenCalledTimes(1)
    expect(mockQueueMessage).toHaveBeenCalledWith('1', 'Test text')
  })

  it('CALLS queueMessage once when mounting on a completed message without text and then completing a new reply', () => {
    setup()

    const { rerender } = renderHook(
      (props) => useAutoPlayLastResponse(props),
      {
        initialProps: {
          sessionId: 'test-session',
          lastAssistantMessage: createAssistantMessageWithoutText('0'),
          lastAssistantText: '',
        },
      }
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1'),
      lastAssistantText: 'Reply',
    })

    expect(mockQueueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1', Date.now()),
      lastAssistantText: 'Reply',
    })

    expect(mockQueueMessage).toHaveBeenCalledTimes(1)
    expect(mockQueueMessage).toHaveBeenCalledWith('1', 'Reply')
  })

  it('does NOT call queueMessage when lastAssistantText is empty', () => {
    setup()

    const message = createMessage('1', Date.now())
    renderHook(() =>
      useAutoPlayLastResponse({
        sessionId: 'test-session',
        lastAssistantMessage: message,
        lastAssistantText: '',
      })
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()
  })

  it('does NOT call queueMessage when lastAssistantText is whitespace only', () => {
    setup()

    const message = createMessage('1', Date.now())
    renderHook(() =>
      useAutoPlayLastResponse({
        sessionId: 'test-session',
        lastAssistantMessage: message,
        lastAssistantText: '   ',
      })
    )

    expect(mockQueueMessage).not.toHaveBeenCalled()
  })
})

describe('getLatestPlayableAssistantMessage', () => {
  it('falls back to the previous assistant message when the latest assistant message has no text', () => {
    const playableMessage = createMessage('1', Date.now())
    const erroredMessage = createAssistantMessageWithoutText('2')

    const result = getLatestPlayableAssistantMessage([
      playableMessage,
      erroredMessage,
    ])

    expect(result?.messageId).toBe('1')
    expect(result?.text).toBe('Test message text')
  })

  it('returns undefined when no assistant message has playable text', () => {
    const result = getLatestPlayableAssistantMessage([
      createAssistantMessageWithoutText('1'),
    ])

    expect(result).toBeUndefined()
  })
})
