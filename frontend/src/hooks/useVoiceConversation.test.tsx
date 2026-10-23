import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useReducer, useEffect } from 'react'
import { VOICE_MODE_INSTRUCTION_KEY } from '@opencode-manager/shared/opencode'
import type { SessionMessageAssistant } from '@opencode-manager/shared/opencode'
import type { SttEndOfSpeechReason } from '@/lib/webSpeechRecognizer'
import { useVoiceConversation } from './useVoiceConversation'
import type { UseVoiceConversationInput } from './useVoiceConversation'

interface MockStartOptions {
  endpointing?: { pauseMs: number; noSpeechTimeoutMs: number }
  onEndOfSpeech?: (reason: SttEndOfSpeechReason, finalText: string) => void
}

interface MockSttValues {
  isRecording: boolean
  isProcessing: boolean
  isEndpointing: boolean
  isEnabled: boolean
  isSupported: boolean
  isError: boolean
  error: string | null
  transcript: string
  interimTranscript: string
  state: 'idle' | 'listening' | 'processing' | 'error'
}

const harness = vi.hoisted(() => ({
  useStt: vi.fn(),
  useTts: vi.fn(),
  putSessionInstruction: vi.fn(),
  removeSessionInstruction: vi.fn(),
  listSessionInstructionKeys: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  abortRecording: vi.fn(),
  speakMessage: vi.fn(),
  ttsStop: vi.fn(),
  ttsPause: vi.fn(),
  ttsResume: vi.fn(),
  sendTurn: vi.fn(),
  interrupt: vi.fn(),
  onEditInTextBox: vi.fn(),
}))

vi.mock('@/hooks/useSTT', () => ({ useSTT: harness.useStt }))

vi.mock('@/hooks/useTTS', () => ({ useTTS: harness.useTts }))

vi.mock('@/api/opencode', () => ({
  putSessionInstruction: harness.putSessionInstruction,
  removeSessionInstruction: harness.removeSessionInstruction,
  listSessionInstructionKeys: harness.listSessionInstructionKeys,
}))

const sttListeners = new Set<() => void>()

const sttValue: MockSttValues = {
  isRecording: false,
  isProcessing: false,
  isEndpointing: false,
  isEnabled: true,
  isSupported: true,
  isError: false,
  error: null,
  transcript: '',
  interimTranscript: '',
  state: 'idle',
}

const ttsValue = {
  isEnabled: true,
  isPlaying: false,
  isPaused: false,
  error: null as string | null,
  speakMessage: harness.speakMessage,
  stop: harness.ttsStop,
  pause: harness.ttsPause,
  resume: harness.ttsResume,
}
function useMockStt() {
  const [, forceRender] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    sttListeners.add(forceRender)
    return () => {
      sttListeners.delete(forceRender)
    }
  }, [])
  return {
    ...sttValue,
    startRecording: harness.startRecording,
    stopRecording: harness.stopRecording,
    abortRecording: harness.abortRecording,
  }
}

function updateStt(patch: Partial<MockSttValues>) {
  Object.assign(sttValue, patch)
  act(() => {
    for (const listener of sttListeners) listener()
  })
}

function lastStartOptions(): MockStartOptions {
  const calls = harness.startRecording.mock.calls
  return (calls[calls.length - 1]?.[0] ?? {}) as MockStartOptions
}

async function endOfSpeech(reason: SttEndOfSpeechReason, finalText: string) {
  const options = lastStartOptions()
  await act(async () => {
    options.onEndOfSpeech?.(reason, finalText)
  })
}

function assistantMessage(id: string, text: string): SessionMessageAssistant {
  return {
    id,
    type: 'assistant',
    agent: 'build',
    model: { id: 'claude', providerID: 'anthropic' },
    content: [{ type: 'text', text }],
    time: { created: 1, completed: 2 },
  }
}

function createProps(
  overrides: Partial<UseVoiceConversationInput> = {},
): UseVoiceConversationInput {
  return {
    sessionID: 'ses_1',
    serverId: 'local',
    messages: [],
    pending: [],
    status: 'idle',
    hasPendingApproval: false,
    pauseMs: 1200,
    sendTurn: harness.sendTurn,
    interrupt: harness.interrupt,
    onEditInTextBox: harness.onEditInTextBox,
    ...overrides,
  }
}

describe('useVoiceConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(sttValue, {
      isRecording: false,
      isProcessing: false,
      isEndpointing: false,
      isEnabled: true,
      isSupported: true,
      isError: false,
      error: null,
      transcript: '',
      interimTranscript: '',
      state: 'idle',
    } satisfies MockSttValues)
    Object.assign(ttsValue, {
      isEnabled: true,
      isPlaying: false,
      isPaused: false,
      error: null,
    })
    sttListeners.clear()
    harness.useStt.mockImplementation(useMockStt)
    harness.useTts.mockImplementation(() => ttsValue)
    harness.putSessionInstruction.mockResolvedValue(undefined)
    harness.removeSessionInstruction.mockResolvedValue(undefined)
    harness.listSessionInstructionKeys.mockResolvedValue([])
    harness.sendTurn.mockResolvedValue(undefined)
    harness.interrupt.mockResolvedValue(undefined)
  })

  it('starts listening and opens capture with the pause budget when idle', async () => {
    const { result } = renderHook((props: UseVoiceConversationInput) => useVoiceConversation(props), {
      initialProps: createProps(),
    })

    act(() => result.current.start())

    await waitFor(() => expect(result.current.phase).toBe('listening'))
    expect(result.current.isActive).toBe(true)
    expect(result.current.label).toBe('Listening')
    expect(harness.startRecording).toHaveBeenCalledTimes(1)
    expect(lastStartOptions().endpointing).toEqual({ pauseMs: 1200, noSpeechTimeoutMs: 10_000 })
    expect(harness.putSessionInstruction).toHaveBeenCalledWith(
      'ses_1',
      VOICE_MODE_INSTRUCTION_KEY,
      expect.any(String),
      'local',
    )
  })

  it('sends a finished utterance and works on the reply', async () => {
    const { result } = renderHook((props: UseVoiceConversationInput) => useVoiceConversation(props), {
      initialProps: createProps(),
    })

    act(() => result.current.start())
    await waitFor(() => expect(result.current.phase).toBe('listening'))

    await endOfSpeech('pause', 'hello there')

    await waitFor(() => expect(result.current.phase).toBe('working'))
    expect(harness.sendTurn).toHaveBeenCalledWith('hello there', { busy: false })
    expect(result.current.label).toBe('Working')
  })

  it('reads a completed reply and listens again once it ends', async () => {
    const { result, rerender } = renderHook(
      (props: UseVoiceConversationInput) => useVoiceConversation(props),
      { initialProps: createProps() },
    )

    act(() => result.current.start())
    await waitFor(() => expect(result.current.phase).toBe('listening'))
    await endOfSpeech('pause', 'hello there')
    await waitFor(() => expect(result.current.phase).toBe('working'))

    rerender(createProps({ messages: [assistantMessage('msg_1', 'Done')] }))

    await waitFor(() => expect(result.current.phase).toBe('speaking'))
    expect(harness.speakMessage).toHaveBeenCalledWith('msg_1', 'Done', expect.any(Object))
    expect(result.current.label).toBe('Speaking')
    expect(result.current.canStopAgent).toBe(false)

    const options = harness.speakMessage.mock.calls[0]?.[2] as { onEnd: () => void }
    act(() => options.onEnd())

    await waitFor(() => expect(result.current.phase).toBe('listening'))
    expect(harness.startRecording).toHaveBeenCalledTimes(2)
    expect(result.current.label).toBe('Listening')
  })

  it('marks replies as heard without speaking when text-to-speech is disabled', async () => {
    ttsValue.isEnabled = false
    const { result, rerender } = renderHook(
      (props: UseVoiceConversationInput) => useVoiceConversation(props),
      { initialProps: createProps() },
    )

    act(() => result.current.start())
    await waitFor(() => expect(result.current.phase).toBe('listening'))
    await endOfSpeech('pause', 'hello there')
    await waitFor(() => expect(result.current.phase).toBe('working'))

    rerender(createProps({ messages: [assistantMessage('msg_1', 'Done')] }))

    await waitFor(() => expect(result.current.phase).toBe('listening'))
    expect(harness.speakMessage).not.toHaveBeenCalled()
    expect(harness.startRecording).toHaveBeenCalledTimes(2)
  })

  it('records a message while the agent works and sends it as busy', async () => {
    const { result } = renderHook((props: UseVoiceConversationInput) => useVoiceConversation(props), {
      initialProps: createProps({ status: 'busy' }),
    })

    act(() => result.current.start())
    await waitFor(() => expect(result.current.phase).toBe('working'))
    expect(result.current.orbLabel).toBe('Add a message')

    act(() => result.current.tapOrb())
    await waitFor(() => expect(result.current.phase).toBe('recording'))
    expect(harness.startRecording).toHaveBeenCalledTimes(1)
    expect(result.current.label).toBe('Adding to queue')

    await endOfSpeech('pause', 'also check the tests')

    await waitFor(() => expect(result.current.phase).toBe('working'))
    expect(harness.sendTurn).toHaveBeenCalledWith('also check the tests', { busy: true })
  })

  it('pauses and resumes a reading that is held mid-reply', async () => {
    ttsValue.isPlaying = true
    const { result, rerender } = renderHook(
      (props: UseVoiceConversationInput) => useVoiceConversation(props),
      { initialProps: createProps() },
    )

    act(() => result.current.start())
    await waitFor(() => expect(result.current.phase).toBe('listening'))
    await endOfSpeech('pause', 'hello there')
    await waitFor(() => expect(result.current.phase).toBe('working'))
    rerender(createProps({ messages: [assistantMessage('msg_1', 'Done')] }))
    await waitFor(() => expect(result.current.phase).toBe('speaking'))

    act(() => result.current.pause())

    expect(harness.ttsPause).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('paused')
    expect(result.current.hasHeldReading).toBe(true)
    expect(result.current.orbLabel).toBe('Continue reading')
    expect(result.current.hint).toBe('Tap to continue')

    ttsValue.isPaused = true
    act(() => result.current.resume())

    expect(harness.ttsResume).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('speaking')
    expect(result.current.hasHeldReading).toBe(false)
  })

  it('removes the session instruction on exit', async () => {
    const { result } = renderHook((props: UseVoiceConversationInput) => useVoiceConversation(props), {
      initialProps: createProps(),
    })

    act(() => result.current.start())
    await waitFor(() => expect(result.current.phase).toBe('listening'))

    act(() => result.current.exit())

    expect(result.current.phase).toBe('off')
    expect(result.current.isActive).toBe(false)
    await waitFor(() =>
      expect(harness.removeSessionInstruction).toHaveBeenCalledWith(
        'ses_1',
        VOICE_MODE_INSTRUCTION_KEY,
        'local',
      ),
    )
  })

  it('hands the live transcript to the composer when editing in the text box', async () => {
    const { result } = renderHook((props: UseVoiceConversationInput) => useVoiceConversation(props), {
      initialProps: createProps(),
    })

    act(() => result.current.start())
    await waitFor(() => expect(result.current.phase).toBe('listening'))

    updateStt({ transcript: 'edit this turn' })

    expect(result.current.liveTranscript).toBe('edit this turn')
    expect(result.current.canEditInTextBox).toBe(true)

    act(() => result.current.editInTextBox())

    await waitFor(() => expect(harness.onEditInTextBox).toHaveBeenCalledWith('edit this turn'))
    expect(result.current.phase).toBe('off')
  })

  it('ignores speech-to-text placeholders in the live transcript', async () => {
    const { result } = renderHook((props: UseVoiceConversationInput) => useVoiceConversation(props), {
      initialProps: createProps(),
    })

    act(() => result.current.start())
    await waitFor(() => expect(result.current.phase).toBe('listening'))

    updateStt({ isRecording: true, interimTranscript: 'Recording...' })

    expect(result.current.liveTranscript).toBe('')
    expect(result.current.canEditInTextBox).toBe(false)
  })

  it('pauses without a message when the turn produces no speech', async () => {
    const { result } = renderHook((props: UseVoiceConversationInput) => useVoiceConversation(props), {
      initialProps: createProps(),
    })

    act(() => result.current.start())
    await waitFor(() => expect(result.current.phase).toBe('listening'))

    await endOfSpeech('no-speech', '')

    expect(harness.abortRecording).toHaveBeenCalled()
    expect(harness.sendTurn).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('paused')
    expect(result.current.label).toBe("Didn't catch that")
    expect(result.current.hint).toBe('Tap to talk')
    expect(result.current.orbLabel).toBe('Resume voice conversation')
  })
})
