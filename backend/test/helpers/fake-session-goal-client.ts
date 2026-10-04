import type { ModelRef, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../src/services/opencode/client'

export interface FakeSessionGoalTokens {
  input: number
  output: number
  reasoning: number
}

export interface FakeSessionGoalClientOptions {
  tokens?: Record<string, FakeSessionGoalTokens>
  failSessionGet?: boolean
  messages?: Record<string, SessionMessageInfo[]>
  busySessions?: string[]
  auditorReplies?: string[]
  failAuditorCalls?: number
  failSessionPrompt?: boolean
}

export interface FakeSessionGoalPromptCall {
  sessionID: string
  text: string
}

export interface FakeSessionGoalAuditorCall {
  prompt: string
  model: ModelRef | null
}

export interface FakeSessionGoalAuditorDeferral {
  resolve(text: string): void
  reject(error?: unknown): void
}

export interface FakeSessionGoalPromptDeferral {
  resolve(): void
  reject(error?: unknown): void
}

export interface FakeSessionGoalClient {
  client: OpenCodeClient
  promptCalls: FakeSessionGoalPromptCall[]
  auditorCalls: FakeSessionGoalAuditorCall[]
  pendingAuditorCalls: FakeSessionGoalAuditorDeferral[]
  pendingSessionPromptCalls: FakeSessionGoalPromptDeferral[]
  readonly maxConcurrentAuditorCalls: number
  setTokens(sessionId: string, tokens: FakeSessionGoalTokens): void
  setMessages(sessionId: string, messages: SessionMessageInfo[]): void
  setBusy(sessionId: string, busy: boolean): void
  setAuditorReplies(replies: string[]): void
  failNextAuditorCalls(count: number): void
  deferNextAuditorCalls(count: number): void
  deferNextSessionPrompts(count: number): void
  setFailSessionGet(fail: boolean): void
  setFailSessionActive(fail: boolean): void
  setFailMessageList(fail: boolean): void
  setSessionMissing(sessionId: string, missing: boolean): void
}

export function createFakeSessionGoalClient(options: FakeSessionGoalClientOptions = {}): FakeSessionGoalClient {
  const tokens = new Map<string, FakeSessionGoalTokens>(Object.entries(options.tokens ?? {}))
  const messages = new Map<string, SessionMessageInfo[]>(Object.entries(options.messages ?? {}))
  const busySessions = new Set<string>(options.busySessions ?? [])
  const missingSessions = new Set<string>()
  const promptCalls: FakeSessionGoalPromptCall[] = []
  const auditorCalls: FakeSessionGoalAuditorCall[] = []
  const pendingAuditorCalls: FakeSessionGoalAuditorDeferral[] = []
  const pendingSessionPromptCalls: FakeSessionGoalPromptDeferral[] = []
  let auditorReplies = [...(options.auditorReplies ?? [])]
  let auditorFailures = options.failAuditorCalls ?? 0
  let deferAuditorCount = 0
  let deferPromptCount = 0
  let sessionGetFails = options.failSessionGet ?? false
  let sessionActiveFails = false
  let messageListFails = false
  let activeAuditorCalls = 0
  let maxConcurrentAuditorCalls = 0

  const client = {
    api: {
      session: {
        get: async ({ sessionID }: { sessionID: string }) => {
          if (missingSessions.has(sessionID)) {
            throw Object.assign(new Error('Session not found'), { _tag: 'SessionNotFoundError' })
          }
          if (sessionGetFails) {
            throw new Error('upstream unavailable')
          }
          const usage = tokens.get(sessionID) ?? { input: 0, output: 0, reasoning: 0 }
          return {
            tokens: {
              input: usage.input,
              output: usage.output,
              reasoning: usage.reasoning,
              cache: { read: 0, write: 0 },
            },
          }
        },
        active: async () => {
          if (sessionActiveFails) {
            throw new Error('active lookup failed')
          }
          const active: Record<string, { type: 'running' }> = {}
          for (const sessionId of busySessions) {
            active[sessionId] = { type: 'running' }
          }
          return active
        },
        prompt: async (input: { sessionID: string; text: string }) => {
          if (options.failSessionPrompt) {
            throw new Error('prompt rejected')
          }
          promptCalls.push({ sessionID: input.sessionID, text: input.text })
          if (deferPromptCount > 0) {
            deferPromptCount -= 1
            await new Promise<void>((resolve, reject) => {
              pendingSessionPromptCalls.push({ resolve, reject })
            })
          }
          return { id: `inbox_${promptCalls.length}` }
        },
      },
      message: {
        list: async ({ sessionID }: { sessionID: string }) => {
          if (messageListFails) {
            throw new Error('message list failed')
          }
          return {
            data: messages.get(sessionID) ?? [],
            cursor: {},
          }
        },
      },
      generate: {
        text: async (input: { prompt: string; model?: ModelRef | null }) => {
          auditorCalls.push({ prompt: input.prompt, model: input.model ?? null })
          activeAuditorCalls += 1
          maxConcurrentAuditorCalls = Math.max(maxConcurrentAuditorCalls, activeAuditorCalls)
          try {
            if (deferAuditorCount > 0) {
              deferAuditorCount -= 1
              const text = await new Promise<string>((resolve, reject) => {
                pendingAuditorCalls.push({ resolve, reject })
              })
              return { text }
            }
            if (auditorFailures > 0) {
              auditorFailures -= 1
              throw new Error('auditor unavailable')
            }
            const text = auditorReplies.shift() ?? '{"verdict":"continue","reason":"still working"}'
            return { text }
          } finally {
            activeAuditorCalls -= 1
          }
        },
      },
    },
    forwardRaw: async () => new Response(),
  } as unknown as OpenCodeClient

  return {
    client,
    promptCalls,
    auditorCalls,
    pendingAuditorCalls,
    pendingSessionPromptCalls,
    get maxConcurrentAuditorCalls() {
      return maxConcurrentAuditorCalls
    },
    setTokens: (sessionId, next) => {
      tokens.set(sessionId, next)
    },
    setMessages: (sessionId, next) => {
      messages.set(sessionId, next)
    },
    setBusy: (sessionId, next) => {
      if (next) {
        busySessions.add(sessionId)
      } else {
        busySessions.delete(sessionId)
      }
    },
    setAuditorReplies: (replies) => {
      auditorReplies = [...replies]
    },
    failNextAuditorCalls: (count) => {
      auditorFailures = count
    },
    deferNextAuditorCalls: (count) => {
      deferAuditorCount = count
    },
    deferNextSessionPrompts: (count) => {
      deferPromptCount = count
    },
    setFailSessionGet: (fail) => {
      sessionGetFails = fail
    },
    setFailSessionActive: (fail) => {
      sessionActiveFails = fail
    },
    setFailMessageList: (fail) => {
      messageListFails = fail
    },
    setSessionMissing: (sessionId, missing) => {
      if (missing) {
        missingSessions.add(sessionId)
      } else {
        missingSessions.delete(sessionId)
      }
    },
  }
}

export function fakeAssistantMessage(
  text: string,
  options: { error?: string; completed?: boolean } = {},
): SessionMessageInfo {
  return {
    id: 'msg_assistant',
    type: 'assistant',
    time: {
      created: 0,
      ...(options.completed === false ? {} : { completed: 1 }),
    },
    agent: 'build',
    model: { providerID: 'test', id: 'model' },
    content: [{ type: 'text', text }],
    ...(options.error ? { error: { type: 'unknown', message: options.error } } : {}),
  } as unknown as SessionMessageInfo
}
