import { vi } from 'vitest'
import type {
  OpenCodeApi,
  SessionMessageAssistant,
  SessionMessageInfo,
  SkillInfo,
} from '@opencode-manager/shared/opencode'

export interface ScheduleApiState {
  sessionID: string
  messages: SessionMessageInfo[]
  active: Record<string, { type: 'running' }>
  skills: SkillInfo[]
  createError?: Error
  promptError?: Error
  interruptError?: Error
  messageError?: Error
  activeError?: Error
  skillError?: Error
}

export interface ScheduleApiStub {
  api: OpenCodeApi
  state: ScheduleApiState
}

export function createStubScheduleApi(state: Partial<ScheduleApiState> = {}): ScheduleApiStub {
  const resolved: ScheduleApiState = {
    sessionID: 'ses-run-1',
    messages: [],
    active: {},
    skills: [],
    ...state,
  }

  const session = {
    create: vi.fn(async () => {
      if (resolved.createError) throw resolved.createError
      return { id: resolved.sessionID }
    }),
    prompt: vi.fn(async () => {
      if (resolved.promptError) throw resolved.promptError
      return {}
    }),
    interrupt: vi.fn(async () => {
      if (resolved.interruptError) throw resolved.interruptError
      return { interrupted: true }
    }),
    active: vi.fn(async () => {
      if (resolved.activeError) throw resolved.activeError
      return resolved.active
    }),
  }

  const api = {
    session,
    message: {
      list: vi.fn(async () => {
        if (resolved.messageError) throw resolved.messageError
        return { data: resolved.messages, cursor: {} }
      }),
    },
    skill: {
      list: vi.fn(async () => {
        if (resolved.skillError) throw resolved.skillError
        return { location: { directory: '' }, data: resolved.skills }
      }),
    },
  }

  return { api: api as unknown as OpenCodeApi, state: resolved }
}

let messageSequence = 0

export function assistantMessage(
  text: string,
  options: { completed?: boolean; error?: string; content?: SessionMessageAssistant['content'] } = {},
): SessionMessageInfo {
  messageSequence += 1
  const created = Date.now()

  return {
    id: `msg_assistant_${messageSequence}`,
    type: 'assistant',
    agent: 'build',
    model: { id: 'gpt-5', providerID: 'openai' },
    time: { created, ...(options.completed ? { completed: created } : {}) },
    content: options.content ?? [{ type: 'text', text }],
    ...(options.error ? { error: { type: 'ProviderError', message: options.error } } : {}),
  } as SessionMessageInfo
}

export function skill(id: string): SkillInfo {
  return { id, name: id, path: `/skills/${id}/SKILL.md`, content: '' }
}
