import { describe, expect, it } from 'vitest'
import type {
  SessionMessageAssistant,
  SessionMessageInfo,
  VoiceConversationEvent,
  VoiceConversationLabelInput,
  VoiceConversationState,
  VoicePhase,
  VoiceSessionStatus,
} from '@opencode-manager/shared/opencode'
import {
  DEFAULT_VOICE_PAUSE_MS,
  INITIAL_VOICE_CONVERSATION_STATE,
  VOICE_NO_SPEECH_TIMEOUT_MS,
  VOICE_PAUSE_OPTIONS_MS,
  findNextUnspokenMessage,
  formatVoicePauseMs,
  hasIncompleteAssistant,
  hasSpokenMessage,
  isVoicePauseOption,
  isVoiceTurnComplete,
  listUnspokenMessages,
  normalizeVoicePauseMs,
  parseVoicePauseMs,
  reduceVoiceConversation,
  voiceConversationHint,
  voiceConversationLabel,
} from '@opencode-manager/shared/opencode'

function assistant(
  id: string,
  created: number,
  completed?: number,
  texts: readonly string[] = ['Done'],
): SessionMessageAssistant {
  return {
    id,
    type: 'assistant',
    agent: 'build',
    model: { id: 'claude', providerID: 'anthropic' },
    content: texts.map((text) => ({ type: 'text' as const, text })),
    time: { created, ...(completed === undefined ? {} : { completed }) },
  }
}

function narration(
  id: string,
  created: number,
  completed: number,
  text: string,
): SessionMessageAssistant {
  return {
    ...assistant(id, created, completed, [text]),
    content: [
      { type: 'text', text },
      {
        type: 'tool',
        id: 'tool-1',
        name: 'read',
        state: { status: 'streaming', input: '' },
        time: { created },
      },
    ],
  }
}

function user(id: string, text: string, created = 0): SessionMessageInfo {
  return { id, type: 'user', text, time: { created } }
}

function conversation(overrides: Partial<VoiceConversationState> = {}): VoiceConversationState {
  return { ...INITIAL_VOICE_CONVERSATION_STATE, ...overrides }
}

function labelInput(
  overrides: Partial<VoiceConversationLabelInput> = {},
): VoiceConversationLabelInput {
  return {
    phase: 'off',
    pauseReason: null,
    pendingApproval: false,
    isEndpointing: false,
    isPlaybackPaused: false,
    sessionBusy: false,
    ...overrides,
  }
}

describe('reduceVoiceConversation', () => {
  describe('start', () => {
    it('enters working and records busy when the session is already working', () => {
      expect(
        reduceVoiceConversation(conversation(), { type: 'start', busy: true, baselineId: 'b1' }),
      ).toEqual({
        phase: 'working',
        pauseReason: null,
        error: null,
        sawBusy: true,
        baselineId: 'b1',
      })
    })

    it('enters listening and clears stale turn data when the session is idle', () => {
      expect(
        reduceVoiceConversation(conversation({ error: 'old', baselineId: 'old' }), {
          type: 'start',
          busy: false,
          baselineId: 'b1',
        }),
      ).toEqual({
        phase: 'listening',
        pauseReason: null,
        error: null,
        sawBusy: false,
        baselineId: null,
      })
    })

    it.each<VoicePhase>(['listening', 'sending', 'working', 'speaking', 'recording', 'paused'])(
      'is ignored from %s',
      (phase) => {
        const state = conversation({ phase })
        expect(
          reduceVoiceConversation(state, { type: 'start', busy: false, baselineId: 'b1' }),
        ).toBe(state)
      },
    )
  })

  describe('transcript', () => {
    it('moves to sending when the transcript has content', () => {
      const state = conversation({ phase: 'listening' })
      expect(reduceVoiceConversation(state, { type: 'transcript', text: 'hello there' })).toEqual({
        ...state,
        phase: 'sending',
      })
    })

    it('pauses as no-speech when the transcript is only whitespace', () => {
      const state = conversation({ phase: 'listening' })
      expect(reduceVoiceConversation(state, { type: 'transcript', text: '   ' })).toEqual({
        ...state,
        phase: 'paused',
        pauseReason: 'no-speech',
      })
    })
  })

  describe('turn-sent', () => {
    it('enters working with the new baseline and clears the busy marker', () => {
      const state = conversation({ phase: 'sending', sawBusy: true, baselineId: 'old' })
      expect(reduceVoiceConversation(state, { type: 'turn-sent', baselineId: 'b2' })).toEqual({
        ...state,
        phase: 'working',
        sawBusy: false,
        baselineId: 'b2',
      })
    })
  })

  describe('turn-started', () => {
    it('enters working with the new baseline when a queued prompt starts a turn', () => {
      const state = conversation({ phase: 'listening' })
      expect(reduceVoiceConversation(state, { type: 'turn-started', baselineId: 'b3' })).toEqual({
        ...state,
        phase: 'working',
        sawBusy: true,
        baselineId: 'b3',
      })
    })
  })

  describe('send-failed', () => {
    it('pauses with the failure message', () => {
      const state = conversation({ phase: 'sending' })
      expect(
        reduceVoiceConversation(state, { type: 'send-failed', message: 'network down' }),
      ).toEqual({
        ...state,
        phase: 'paused',
        pauseReason: 'error',
        error: 'network down',
      })
    })

    it('pauses with the failure message when the sent turn never arrives', () => {
      const state = conversation({ phase: 'working', baselineId: 'b2' })
      expect(
        reduceVoiceConversation(state, { type: 'send-failed', message: 'not delivered' }),
      ).toEqual({
        ...state,
        phase: 'paused',
        pauseReason: 'error',
        error: 'not delivered',
      })
    })
  })

  describe('status', () => {
    it('records the first busy report after a turn is sent', () => {
      const state = conversation({ phase: 'working', baselineId: 'b2' })
      expect(reduceVoiceConversation(state, { type: 'status', busy: true })).toEqual({
        ...state,
        sawBusy: true,
      })
    })

    it('ignores a repeated busy report', () => {
      const state = conversation({ phase: 'working', sawBusy: true })
      expect(reduceVoiceConversation(state, { type: 'status', busy: true })).toBe(state)
    })

    it('ignores an idle report', () => {
      const state = conversation({ phase: 'working' })
      expect(reduceVoiceConversation(state, { type: 'status', busy: false })).toBe(state)
    })
  })

  describe('speak-start', () => {
    it('enters speaking from working', () => {
      const state = conversation({ phase: 'working', baselineId: 'b2', sawBusy: true })
      expect(reduceVoiceConversation(state, { type: 'speak-start' })).toEqual({
        ...state,
        phase: 'speaking',
      })
    })
  })

  describe('speech-ended', () => {
    it('returns to working so the next message can be scheduled', () => {
      const state = conversation({ phase: 'speaking', baselineId: 'b2' })
      expect(reduceVoiceConversation(state, { type: 'speech-ended' })).toEqual({
        ...state,
        phase: 'working',
      })
    })
  })

  describe('skip', () => {
    it('returns to listening when the reply is skipped', () => {
      const state = conversation({ phase: 'speaking' })
      expect(reduceVoiceConversation(state, { type: 'skip' })).toEqual({
        ...state,
        phase: 'listening',
      })
    })
  })

  describe('record', () => {
    it('enters recording from working without moving the baseline', () => {
      const state = conversation({ phase: 'working', baselineId: 'b2', sawBusy: true })
      expect(reduceVoiceConversation(state, { type: 'record' })).toEqual({
        ...state,
        phase: 'recording',
        baselineId: 'b2',
      })
    })

    it('enters recording from speaking', () => {
      const state = conversation({ phase: 'speaking', baselineId: 'b2' })
      expect(reduceVoiceConversation(state, { type: 'record' })).toEqual({
        ...state,
        phase: 'recording',
        baselineId: 'b2',
      })
    })
  })

  describe('record-ended', () => {
    it('returns to working so the queued turn and pending replies continue', () => {
      const state = conversation({ phase: 'recording', baselineId: 'b2', sawBusy: true })
      expect(reduceVoiceConversation(state, { type: 'record-ended' })).toEqual({
        ...state,
        phase: 'working',
        baselineId: 'b2',
      })
    })
  })

  describe('turn-complete', () => {
    it('returns to listening when the turn finished', () => {
      const state = conversation({ phase: 'working', baselineId: 'b2', sawBusy: true })
      expect(reduceVoiceConversation(state, { type: 'turn-complete' })).toEqual({
        ...state,
        phase: 'listening',
      })
    })
  })

  describe('no-speech', () => {
    it('pauses as no-speech from listening', () => {
      const state = conversation({ phase: 'listening' })
      expect(reduceVoiceConversation(state, { type: 'no-speech' })).toEqual({
        ...state,
        phase: 'paused',
        pauseReason: 'no-speech',
      })
    })
  })

  describe('pause', () => {
    it.each<VoicePhase>(['listening', 'sending', 'working', 'speaking', 'recording'])(
      'pauses from %s with the given reason',
      (phase) => {
        const state = conversation({ phase })
        expect(reduceVoiceConversation(state, { type: 'pause', reason: 'background' })).toEqual({
          ...state,
          phase: 'paused',
          pauseReason: 'background',
        })
      },
    )
  })

  describe('resume', () => {
    it('enters working and clears the pause when the session is busy', () => {
      const state = conversation({ phase: 'paused', pauseReason: 'user', error: 'boom' })
      expect(
        reduceVoiceConversation(state, { type: 'resume', busy: true, baselineId: 'b3' }),
      ).toEqual({
        ...state,
        phase: 'working',
        sawBusy: true,
        baselineId: 'b3',
        pauseReason: null,
        error: null,
      })
    })

    it('enters listening and clears the pause when the session is idle', () => {
      const state = conversation({
        phase: 'paused',
        pauseReason: 'error',
        error: 'boom',
        baselineId: 'b3',
      })
      expect(
        reduceVoiceConversation(state, { type: 'resume', busy: false, baselineId: 'b4' }),
      ).toEqual({
        ...state,
        phase: 'listening',
        sawBusy: false,
        baselineId: null,
        pauseReason: null,
        error: null,
      })
    })
  })

  describe('resume-speech', () => {
    it('returns to speaking and clears the pause when a held reading continues', () => {
      const state = conversation({
        phase: 'paused',
        pauseReason: 'background',
        error: 'boom',
        baselineId: 'b3',
      })
      expect(reduceVoiceConversation(state, { type: 'resume-speech' })).toEqual({
        ...state,
        phase: 'speaking',
        pauseReason: null,
        error: null,
      })
    })
  })

  describe('error', () => {
    it.each<VoicePhase>(['listening', 'sending', 'working', 'speaking', 'recording', 'paused'])(
      'pauses with the failure message from %s',
      (phase) => {
        const state = conversation({ phase })
        expect(
          reduceVoiceConversation(state, { type: 'error', message: 'mic unavailable' }),
        ).toEqual({
          ...state,
          phase: 'paused',
          pauseReason: 'error',
          error: 'mic unavailable',
        })
      },
    )

    it('is ignored while voice mode is off', () => {
      const state = conversation()
      expect(reduceVoiceConversation(state, { type: 'error', message: 'mic unavailable' })).toBe(
        state,
      )
    })
  })

  describe('exit', () => {
    it.each<VoicePhase>([
      'off',
      'listening',
      'sending',
      'working',
      'speaking',
      'recording',
      'paused',
    ])('resets to the initial state from %s', (phase) => {
      const state = conversation({ phase, pauseReason: 'error', error: 'boom', sawBusy: true })
      const next = reduceVoiceConversation(state, { type: 'exit' })
      expect(next).toBe(INITIAL_VOICE_CONVERSATION_STATE)
      expect(next.phase).toBe('off')
    })
  })

  it.each<[string, VoiceConversationState, VoiceConversationEvent]>([
    ['transcript while off', conversation(), { type: 'transcript', text: 'hi' }],
    [
      'transcript while working',
      conversation({ phase: 'working' }),
      { type: 'transcript', text: 'hi' },
    ],
    [
      'turn-sent while listening',
      conversation({ phase: 'listening' }),
      { type: 'turn-sent', baselineId: null },
    ],
    [
      'turn-started while working',
      conversation({ phase: 'working' }),
      { type: 'turn-started', baselineId: 'b2' },
    ],
    ['status while listening', conversation({ phase: 'listening' }), { type: 'status', busy: true }],
    ['speak-start while listening', conversation({ phase: 'listening' }), { type: 'speak-start' }],
    ['speak-start while speaking', conversation({ phase: 'speaking' }), { type: 'speak-start' }],
    ['speech-ended while working', conversation({ phase: 'working' }), { type: 'speech-ended' }],
    ['skip while working', conversation({ phase: 'working' }), { type: 'skip' }],
    ['record while listening', conversation({ phase: 'listening' }), { type: 'record' }],
    ['record-ended while working', conversation({ phase: 'working' }), { type: 'record-ended' }],
    ['turn-complete while speaking', conversation({ phase: 'speaking' }), { type: 'turn-complete' }],
    ['no-speech while sending', conversation({ phase: 'sending' }), { type: 'no-speech' }],
    ['no-speech while recording', conversation({ phase: 'recording' }), { type: 'no-speech' }],
    ['pause while off', conversation(), { type: 'pause', reason: 'user' }],
    [
      'pause while paused',
      conversation({ phase: 'paused', pauseReason: 'user' }),
      { type: 'pause', reason: 'background' },
    ],
    [
      'resume while listening',
      conversation({ phase: 'listening' }),
      { type: 'resume', busy: false, baselineId: null },
    ],
    ['resume-speech while listening', conversation({ phase: 'listening' }), { type: 'resume-speech' }],
    ['resume-speech while speaking', conversation({ phase: 'speaking' }), { type: 'resume-speech' }],
  ])('ignores %s and returns the same state object', (_description, state, event) => {
    expect(reduceVoiceConversation(state, event)).toBe(state)
  })
})

describe('listUnspokenMessages', () => {
  it('lists every completed text message after the baseline, oldest first', () => {
    const messages = [
      user('u1', 'first', 1),
      assistant('a1', 2, 3, ['First answer']),
      user('u2', 'second', 4),
      assistant('a2', 5, 6, ['Second answer']),
      assistant('a3', 7, 8, ['Third answer']),
    ]

    expect(listUnspokenMessages(messages, 'a1', new Set())).toEqual([
      { id: 'a2', text: 'Second answer' },
      { id: 'a3', text: 'Third answer' },
    ])
  })

  it('keeps reading past a user message so replies to queued prompts are spoken', () => {
    const messages = [
      user('u1', 'first', 1),
      assistant('a1', 2, 3, ['First answer']),
      user('u2', 'queued prompt', 4),
      assistant('a2', 5, 6, ['Reply to the queued prompt']),
    ]

    expect(listUnspokenMessages(messages, 'a1', new Set())).toEqual([
      { id: 'a2', text: 'Reply to the queued prompt' },
    ])
  })

  it('reads narration that a tool step ended', () => {
    const messages = [
      user('u1', 'fix it', 1),
      narration('a1', 2, 3, 'Looking at the file'),
      assistant('a2', 4, 5, ['All fixed']),
    ]

    expect(listUnspokenMessages(messages, null, new Set())).toEqual([
      { id: 'a1', text: 'Looking at the file' },
      { id: 'a2', text: 'All fixed' },
    ])
  })

  it('skips messages that were already spoken', () => {
    const messages = [
      user('u1', 'first', 1),
      assistant('a1', 2, 3, ['First answer']),
      assistant('a2', 4, 5, ['Second answer']),
    ]

    expect(listUnspokenMessages(messages, 'u1', new Set(['a1']))).toEqual([
      { id: 'a2', text: 'Second answer' },
    ])
  })

  it('skips messages that have not completed', () => {
    const messages = [user('u1', 'hi', 1), assistant('a1', 2, undefined, ['Still streaming'])]

    expect(listUnspokenMessages(messages, null, new Set())).toEqual([])
  })

  it('skips completed messages without text', () => {
    const reasoningOnly: SessionMessageAssistant = {
      ...assistant('a1', 2, 3),
      content: [{ type: 'reasoning', text: 'thinking it through' }],
    }
    const messages = [user('u1', 'hi', 1), reasoningOnly, assistant('a2', 4, 5, ['Spoken'])]

    expect(listUnspokenMessages(messages, null, new Set())).toEqual([{ id: 'a2', text: 'Spoken' }])
  })

  it('excludes an inline think block from the spoken text', () => {
    const messages = [
      user('u1', 'hi', 1),
      assistant('a1', 2, 3, ['The answer is ready <think>hidden reasoning</think> and verified']),
    ]

    expect(listUnspokenMessages(messages, null, new Set())).toEqual([
      { id: 'a1', text: 'The answer is ready and verified' },
    ])
  })

  it('skips a completed reply that only contains a think block', () => {
    const messages = [
      user('u1', 'hi', 1),
      assistant('a1', 2, 3, ['<think>hidden reasoning</think>']),
      assistant('a2', 4, 5, ['Spoken']),
    ]

    expect(listUnspokenMessages(messages, null, new Set())).toEqual([{ id: 'a2', text: 'Spoken' }])
  })

  it('considers the whole transcript when the baseline is null', () => {
    const messages = [user('u1', 'only turn', 1), assistant('a1', 2, 3, ['The answer'])]

    expect(listUnspokenMessages(messages, null, new Set())).toEqual([
      { id: 'a1', text: 'The answer' },
    ])
  })

  it('considers the whole transcript when the baseline is unknown', () => {
    const messages = [user('u1', 'only turn', 1), assistant('a1', 2, 3, ['The answer'])]

    expect(listUnspokenMessages(messages, 'missing', new Set())).toEqual([
      { id: 'a1', text: 'The answer' },
    ])
  })

  it('returns nothing when the baseline is the newest message', () => {
    const messages = [user('u1', 'first', 1), assistant('a1', 2, 3, ['First answer'])]

    expect(listUnspokenMessages(messages, 'a1', new Set())).toEqual([])
  })
})

describe('findNextUnspokenMessage', () => {
  it('returns the oldest unspoken message', () => {
    const messages = [
      user('u1', 'first', 1),
      assistant('a1', 2, 3, ['First answer']),
      assistant('a2', 4, 5, ['Second answer']),
    ]

    expect(findNextUnspokenMessage(messages, 'u1', new Set())).toEqual({
      id: 'a1',
      text: 'First answer',
    })
    expect(findNextUnspokenMessage(messages, 'u1', new Set(['a1']))).toEqual({
      id: 'a2',
      text: 'Second answer',
    })
  })

  it('returns null when nothing is left to read', () => {
    const messages = [user('u1', 'first', 1), assistant('a1', 2, 3, ['First answer'])]

    expect(findNextUnspokenMessage(messages, 'u1', new Set(['a1']))).toBeNull()
  })
})

describe('hasSpokenMessage', () => {
  it('reports a spoken message after the baseline', () => {
    const messages = [
      user('u1', 'first', 1),
      assistant('a1', 2, 3, ['First answer']),
      assistant('a2', 4, 5, ['Second answer']),
    ]

    expect(hasSpokenMessage(messages, 'a1', new Set(['a2']))).toBe(true)
  })

  it('ignores messages spoken in an earlier turn', () => {
    const messages = [
      user('u1', 'first', 1),
      assistant('a1', 2, 3, ['First answer']),
      user('u2', 'second', 4),
    ]

    expect(hasSpokenMessage(messages, 'a1', new Set(['a1']))).toBe(false)
  })

  it('reports nothing spoken when no id was recorded', () => {
    const messages = [user('u1', 'first', 1), assistant('a1', 2, 3, ['First answer'])]

    expect(hasSpokenMessage(messages, 'u1', new Set())).toBe(false)
  })
})

describe('hasIncompleteAssistant', () => {
  it('reports a message that is still streaming after the baseline', () => {
    const messages = [
      user('u1', 'fix it', 1),
      assistant('a1', 2, 3, ['Earlier answer']),
      assistant('a2', 4, undefined, ['Still streaming']),
    ]

    expect(hasIncompleteAssistant(messages, null)).toBe(true)
  })

  it('reports no incomplete message once every reply settled', () => {
    const messages = [
      user('u1', 'fix it', 1),
      assistant('a1', 2, 3, ['Earlier answer']),
      assistant('a2', 4, 5, ['All fixed']),
    ]

    expect(hasIncompleteAssistant(messages, null)).toBe(false)
  })

  it('ignores incomplete messages at or before the baseline', () => {
    const messages = [
      user('u1', 'first', 1),
      assistant('a1', 2, undefined, ['Still streaming']),
      user('u2', 'second', 3),
    ]

    expect(hasIncompleteAssistant(messages, 'a1')).toBe(false)
  })
})

describe('isVoiceTurnComplete', () => {
  it.each<[string, VoiceSessionStatus, boolean, boolean, boolean, boolean, boolean]>([
    ['idle after being seen busy', 'idle', true, false, false, false, true],
    ['idle after reading a reply', 'idle', false, true, false, false, true],
    ['idle without activity', 'idle', false, false, false, false, false],
    ['retry with a busy report', 'retry', true, false, false, false, false],
    ['idle with a queued prompt pending', 'idle', true, true, true, false, false],
    ['idle with a message still streaming', 'idle', true, true, false, true, false],
  ])('%s', (_description, status, sawBusy, spoke, hasPendingPrompts, hasIncomplete, expected) => {
    expect(isVoiceTurnComplete({ status, sawBusy, spoke, hasPendingPrompts, hasIncomplete })).toBe(
      expected,
    )
  })
})

describe('voiceConversationLabel', () => {
  it.each<[string, Partial<VoiceConversationLabelInput>, string]>([
    ['listening while recording', { phase: 'listening' }, 'Listening'],
    ['listening while finalizing', { phase: 'listening', isEndpointing: true }, 'Listening'],
    ['sending', { phase: 'sending' }, 'Sending…'],
    ['working', { phase: 'working' }, 'Working'],
    [
      'working with a pending approval',
      { phase: 'working', pendingApproval: true },
      'Needs your approval',
    ],
    ['speaking while the session is idle', { phase: 'speaking' }, 'Speaking'],
    ['speaking while the session is busy', { phase: 'speaking', sessionBusy: true }, 'Speaking'],
    ['recording a queued message', { phase: 'recording' }, 'Adding to queue'],
    ['paused after silence', { phase: 'paused', pauseReason: 'no-speech' }, "Didn't catch that"],
    ['paused after a failure', { phase: 'paused', pauseReason: 'error' }, 'Something went wrong'],
    ['paused by the user', { phase: 'paused', pauseReason: 'user' }, 'Paused'],
    [
      'paused by the user while a reply is held',
      { phase: 'paused', pauseReason: 'user', isPlaybackPaused: true },
      'Paused',
    ],
    [
      'paused by the background while a reply is held',
      { phase: 'paused', pauseReason: 'background', isPlaybackPaused: true },
      'Paused',
    ],
    [
      'paused after silence while a reply is held',
      { phase: 'paused', pauseReason: 'no-speech', isPlaybackPaused: true },
      "Didn't catch that",
    ],
    [
      'paused after a failure while a reply is held',
      { phase: 'paused', pauseReason: 'error', isPlaybackPaused: true },
      'Something went wrong',
    ],
    ['paused without a reason', { phase: 'paused' }, 'Paused'],
    ['off', { phase: 'off' }, ''],
  ])('labels %s', (_description, overrides, expected) => {
    expect(voiceConversationLabel(labelInput(overrides))).toBe(expected)
  })
})

describe('voiceConversationHint', () => {
  it.each<[string, Partial<VoiceConversationLabelInput>, string]>([
    ['listening while recording', { phase: 'listening' }, 'Tap to send'],
    ['listening while finalizing', { phase: 'listening', isEndpointing: true }, ''],
    ['sending', { phase: 'sending' }, ''],
    ['working', { phase: 'working' }, 'Tap to add a message'],
    ['working with a pending approval', { phase: 'working', pendingApproval: true }, ''],
    ['speaking while the session is idle', { phase: 'speaking' }, 'Tap to skip'],
    [
      'speaking while the session is busy',
      { phase: 'speaking', sessionBusy: true },
      'Tap to add a message',
    ],
    ['recording a queued message', { phase: 'recording' }, 'Tap to queue'],
    ['paused after silence', { phase: 'paused', pauseReason: 'no-speech' }, 'Tap to talk'],
    ['paused after a failure', { phase: 'paused', pauseReason: 'error' }, 'Tap to retry'],
    ['paused by the user', { phase: 'paused', pauseReason: 'user' }, 'Tap to talk'],
    [
      'paused by the user while a reply is held',
      { phase: 'paused', pauseReason: 'user', isPlaybackPaused: true },
      'Tap to continue',
    ],
    [
      'paused by the background while a reply is held',
      { phase: 'paused', pauseReason: 'background', isPlaybackPaused: true },
      'Tap to continue',
    ],
    [
      'paused after silence while a reply is held',
      { phase: 'paused', pauseReason: 'no-speech', isPlaybackPaused: true },
      'Tap to talk',
    ],
    [
      'paused after a failure while a reply is held',
      { phase: 'paused', pauseReason: 'error', isPlaybackPaused: true },
      'Tap to retry',
    ],
    ['paused without a reason', { phase: 'paused' }, 'Tap to talk'],
    ['off', { phase: 'off' }, ''],
  ])('suggests %s', (_description, overrides, expected) => {
    expect(voiceConversationHint(labelInput(overrides))).toBe(expected)
  })
})

describe('voice pause options', () => {
  it('offers the default as a pickable option', () => {
    expect(VOICE_PAUSE_OPTIONS_MS).toContain(DEFAULT_VOICE_PAUSE_MS)
  })

  it('defaults to 1200', () => {
    expect(DEFAULT_VOICE_PAUSE_MS).toBe(1200)
  })

  it('keeps the no-speech timeout fixed at 10000', () => {
    expect(VOICE_NO_SPEECH_TIMEOUT_MS).toBe(10000)
  })
})

describe('parseVoicePauseMs', () => {
  it('reads a valid stored value', () => {
    expect(parseVoicePauseMs('2000')).toBe(2000)
  })

  it('treats a value outside the options as absent', () => {
    expect(parseVoicePauseMs('999')).toBeUndefined()
  })

  it('treats a non-numeric value as absent', () => {
    expect(parseVoicePauseMs('abc')).toBeUndefined()
  })
})

describe('normalizeVoicePauseMs', () => {
  it('accepts a selectable duration', () => {
    expect(normalizeVoicePauseMs(800)).toBe(800)
  })

  it('rejects a value outside the options instead of clamping it', () => {
    expect(normalizeVoicePauseMs(999)).toBeUndefined()
  })
})

describe('isVoicePauseOption', () => {
  it('reports the selectable durations', () => {
    expect(isVoicePauseOption(1200)).toBe(true)
    expect(isVoicePauseOption(1000)).toBe(false)
  })
})

describe('formatVoicePauseMs', () => {
  it('formats one-decimal seconds with a space before the unit', () => {
    expect(formatVoicePauseMs(800)).toBe('0.8 s')
    expect(formatVoicePauseMs(1200)).toBe('1.2 s')
    expect(formatVoicePauseMs(2000)).toBe('2.0 s')
    expect(formatVoicePauseMs(3000)).toBe('3.0 s')
  })
})
