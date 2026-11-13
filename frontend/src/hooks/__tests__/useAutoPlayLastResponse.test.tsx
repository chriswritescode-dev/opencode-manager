import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { act } from '@testing-library/react'
import type { SessionMessageAssistant } from '@opencode-manager/shared/opencode'
import type { UserPreferences } from '@/api/types/settings'
import { TTSContext, type TTSContextValue } from '@/contexts/tts-context'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import {
  getAssistantText,
  getLatestPlayableAssistantMessage,
  useAutoPlayLastResponse,
} from '../useAutoPlayLastResponse'

interface HookParams {
  sessionId: string
  lastAssistantMessage: SessionMessageAssistant | undefined
  lastAssistantText: string
  enabled?: boolean
}

interface TtsSetupOptions {
  ttsEnabled?: boolean
  autoPlay?: boolean
}

interface TtsSetup {
  tts: TTSContextValue
  preferences: UserPreferences
}

const createMessage = (
  id: string,
  completed?: number,
  text = 'Test message text',
  finish?: SessionMessageAssistant['finish'],
): SessionMessageAssistant => {
  const message: SessionMessageAssistant = {
    id,
    type: 'assistant',
    agent: 'default',
    model: { providerID: 'openai', id: 'gpt-4' },
    time: { created: Date.now() },
    content: [{ type: 'text', text }],
  }
  if (completed) message.time.completed = completed
  if (finish) message.finish = finish
  return message
}

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

function HookProbe(params: HookParams) {
  useAutoPlayLastResponse(params)
  return null
}

function makeTts(options: TtsSetupOptions = {}): TTSContextValue {
  return {
    speak: vi.fn(async () => true),
    speakWithConfig: vi.fn(async () => true),
    speakMessage: vi.fn(async () => true),
    queueMessage: vi.fn(),
    unlock: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    state: 'idle',
    error: null,
    currentText: null,
    originalText: null,
    activeMessageId: null,
    isEnabled: options.ttsEnabled ?? true,
    isPlaying: false,
    isLoading: false,
    isIdle: true,
    isPaused: false,
  }
}

function setup(options: TtsSetupOptions = {}): TtsSetup {
  return {
    tts: makeTts(options),
    preferences: makeUserPreferences({
      tts: {
        enabled: options.ttsEnabled ?? true,
        autoPlay: options.autoPlay ?? true,
        provider: 'external',
        endpoint: 'https://api.openai.com',
        apiKey: 'test-key',
        voice: 'alloy',
        model: 'tts-1',
        speed: 1.0,
      },
    }),
  }
}

interface AutoPlayHarness {
  rerender: (props: HookParams) => void
}

interface PropsControl {
  update: (props: HookParams) => void
}

function renderAutoPlay(initialProps: HookParams, { tts, preferences }: TtsSetup): AutoPlayHarness {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(['settings', 'default'], makeSettingsResponse({ preferences }))
  const control: PropsControl = { update: () => undefined }

  function Harness() {
    const [props, setProps] = useState(initialProps)
    control.update = setProps
    return (
      <TTSContext.Provider value={tts}>
        <HookProbe {...props} />
      </TTSContext.Provider>
    )
  }

  renderWithProviders(<Harness />, {
    auth: false,
    theme: false,
    toaster: false,
    queryClient,
    fetchRoutes: [
      {
        method: 'GET',
        path: '/api/settings',
        respond: () => ({ json: makeSettingsResponse({ preferences }) }),
      },
    ],
  })
  return {
    rerender: (props: HookParams) => {
      act(() => {
        control.update(props)
      })
    },
  }
}

describe('useAutoPlayLastResponse', () => {
  it('does NOT queueMessage when tts.enabled is false', () => {
    const tts = setup({ ttsEnabled: false, autoPlay: true })

    renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: createMessage('1', Date.now()),
        lastAssistantText: 'Test text',
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()
  })

  it('does NOT queueMessage when tts.autoPlay is false', () => {
    const tts = setup({ ttsEnabled: true, autoPlay: false })

    renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: createMessage('1', Date.now()),
        lastAssistantText: 'Test text',
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()
  })

  it('does NOT queueMessage while auto-play is disabled', () => {
    const tts = setup()

    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: createMessage('1'),
        lastAssistantText: 'Test text',
        enabled: false,
      },
      tts,
    )

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1', Date.now()),
      lastAssistantText: 'Test text',
      enabled: false,
    })

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()
  })

  it('does NOT queue a reply that completed while voice mode owned playback when enabled turns back on', () => {
    const tts = setup()

    const baselineMessage = createMessage('0', Date.now())
    const streamingMessage = createMessage('1')
    const completedMessage = createMessage('1', Date.now())
    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: baselineMessage,
        lastAssistantText: 'Earlier reply',
        enabled: true,
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: streamingMessage,
      lastAssistantText: 'Read by voice mode',
      enabled: false,
    })

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: completedMessage,
      lastAssistantText: 'Read by voice mode',
      enabled: false,
    })

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: completedMessage,
      lastAssistantText: 'Read by voice mode',
      enabled: true,
    })

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()
  })

  it('queues a reply that was still streaming when voice mode handed playback back, once it completes', () => {
    const tts = setup()

    const streamingMessage = createMessage('1')
    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: streamingMessage,
        lastAssistantText: 'Test text',
        enabled: false,
      },
      tts,
    )

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: streamingMessage,
      lastAssistantText: 'Test text',
      enabled: true,
    })

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1', Date.now()),
      lastAssistantText: 'Test text',
      enabled: true,
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(1)
    expect(tts.tts.queueMessage).toHaveBeenCalledWith('1', 'Test text')
  })

  it('queues a reply with its inline think block stripped', () => {
    const tts = setup()

    const streamingMessage = createMessage('1', undefined, 'The answer is ready <think>hidden reasoning</think> and verified')
    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: streamingMessage,
        lastAssistantText: getAssistantText(streamingMessage),
      },
      tts,
    )

    const completedMessage = createMessage('1', Date.now(), 'The answer is ready <think>hidden reasoning</think> and verified')
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: completedMessage,
      lastAssistantText: getAssistantText(completedMessage),
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(1)
    expect(tts.tts.queueMessage).toHaveBeenCalledWith('1', 'The answer is ready and verified')
  })

  it('does NOT call queueMessage on mount when last message was already time.completed', () => {
    const tts = setup()

    renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: createMessage('1', Date.now() - 1000),
        lastAssistantText: 'Test text',
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()
  })

  it('CALLS queueMessage exactly once when lastAssistantMessage transitions from incomplete to completed', () => {
    const tts = setup()

    const incompleteMessage = createMessage('1')
    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: incompleteMessage,
        lastAssistantText: 'Test text',
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    const completedMessage = createMessage('1', Date.now())
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: completedMessage,
      lastAssistantText: 'Test text',
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(1)
    expect(tts.tts.queueMessage).toHaveBeenCalledWith('1', 'Test text')
  })

  it('queues a completed tool-calls step narration and then the following final response for a session with a baseline', () => {
    const tts = setup()

    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: createMessage('0', Date.now()),
        lastAssistantText: 'Baseline text',
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1'),
      lastAssistantText: 'Narration',
    })

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1', Date.now(), 'Narration', 'tool-calls'),
      lastAssistantText: 'Narration',
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(1)
    expect(tts.tts.queueMessage).toHaveBeenNthCalledWith(1, '1', 'Narration')

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('2'),
      lastAssistantText: 'Final',
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(1)

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('2', Date.now(), 'Final', 'stop'),
      lastAssistantText: 'Final',
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(2)
    expect(tts.tts.queueMessage).toHaveBeenNthCalledWith(1, '1', 'Narration')
    expect(tts.tts.queueMessage).toHaveBeenNthCalledWith(2, '2', 'Final')
  })

  it('queues a completed tool-calls step narration and then the following final response for a fresh session', () => {
    const tts = setup()

    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: undefined,
        lastAssistantText: '',
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1'),
      lastAssistantText: 'Narration',
    })

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1', Date.now(), 'Narration', 'tool-calls'),
      lastAssistantText: 'Narration',
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(1)
    expect(tts.tts.queueMessage).toHaveBeenNthCalledWith(1, '1', 'Narration')

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('2', Date.now(), 'Final', 'stop'),
      lastAssistantText: 'Final',
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(2)
    expect(tts.tts.queueMessage).toHaveBeenNthCalledWith(1, '1', 'Narration')
    expect(tts.tts.queueMessage).toHaveBeenNthCalledWith(2, '2', 'Final')
  })

  it('does NOT call queueMessage when unattributed playback is active, and does not speak it after playback ends', () => {
    const tts = setup()

    const incompleteMessage = createMessage('1')
    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: incompleteMessage,
        lastAssistantText: 'Test text',
      },
      tts,
    )

    tts.tts.isPlaying = true
    tts.tts.activeMessageId = null

    const completedMessage = createMessage('1', Date.now())
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: completedMessage,
      lastAssistantText: 'Test text',
    })

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    tts.tts.isPlaying = false
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: completedMessage,
      lastAssistantText: 'Test text',
    })

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()
  })

  it('CALLS queueMessage when a message-attributed playback is active', () => {
    const tts = setup()

    const incompleteMessage = createMessage('1')
    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: incompleteMessage,
        lastAssistantText: 'Test text',
      },
      tts,
    )

    tts.tts.isPlaying = true
    tts.tts.activeMessageId = 'other-message'

    const completedMessage = createMessage('1', Date.now())
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: completedMessage,
      lastAssistantText: 'Test text',
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(1)
    expect(tts.tts.queueMessage).toHaveBeenCalledWith('1', 'Test text')
  })

  it('does NOT call queueMessage twice for the same message id across multiple rerenders', () => {
    const tts = setup()

    const message = createMessage('1', Date.now())
    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: message,
        lastAssistantText: 'Test text',
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: message,
      lastAssistantText: 'Test text',
    })

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()
  })

  it('CALLS queueMessage for a subsequent new message id after the baseline', () => {
    const tts = setup()

    const firstMessage = createMessage('1', Date.now() - 2000)

    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: firstMessage,
        lastAssistantText: 'First text',
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    const secondMessage = createMessage('2', Date.now())
    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: secondMessage,
      lastAssistantText: 'Second text',
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(1)
    expect(tts.tts.queueMessage).toHaveBeenCalledWith('2', 'Second text')
  })

  it('resets baseline when sessionId changes', () => {
    const tts = setup()

    const message1 = createMessage('1', Date.now() - 2000)

    const { rerender } = renderAutoPlay(
      {
        sessionId: 'session-1',
        lastAssistantMessage: message1,
        lastAssistantText: 'Session 1 text',
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    const message2 = createMessage('1', Date.now())
    rerender({
      sessionId: 'session-2',
      lastAssistantMessage: message2,
      lastAssistantText: 'Session 2 text',
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(1)
    expect(tts.tts.queueMessage).toHaveBeenCalledWith('1', 'Session 2 text')
  })

  it('CALLS queueMessage once for the first reply in a fresh session when it starts empty then streams to completion', () => {
    const tts = setup()

    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: undefined,
        lastAssistantText: '',
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1'),
      lastAssistantText: 'Test text',
    })

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1', Date.now()),
      lastAssistantText: 'Test text',
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(1)
    expect(tts.tts.queueMessage).toHaveBeenCalledWith('1', 'Test text')
  })

  it('CALLS queueMessage once when mounting on a completed message without text and then completing a new reply', () => {
    const tts = setup()

    const { rerender } = renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: createAssistantMessageWithoutText('0'),
        lastAssistantText: '',
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1'),
      lastAssistantText: 'Reply',
    })

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()

    rerender({
      sessionId: 'test-session',
      lastAssistantMessage: createMessage('1', Date.now()),
      lastAssistantText: 'Reply',
    })

    expect(tts.tts.queueMessage).toHaveBeenCalledTimes(1)
    expect(tts.tts.queueMessage).toHaveBeenCalledWith('1', 'Reply')
  })

  it.each(['', '   '])('does NOT call queueMessage when lastAssistantText is %j', (lastAssistantText) => {
    const tts = setup()

    renderAutoPlay(
      {
        sessionId: 'test-session',
        lastAssistantMessage: createMessage('1', Date.now()),
        lastAssistantText,
      },
      tts,
    )

    expect(tts.tts.queueMessage).not.toHaveBeenCalled()
  })
})

describe('getLatestPlayableAssistantMessage', () => {
  it('falls back to the previous assistant message when the latest assistant message has no text', () => {
    const playableMessage = createMessage('1', Date.now())
    const erroredMessage = createAssistantMessageWithoutText('2')

    const result = getLatestPlayableAssistantMessage([playableMessage, erroredMessage])

    expect(result?.messageId).toBe('1')
    expect(result?.text).toBe('Test message text')
  })

  it('returns undefined when no assistant message has playable text', () => {
    const result = getLatestPlayableAssistantMessage([createAssistantMessageWithoutText('1')])

    expect(result).toBeUndefined()
  })
})
