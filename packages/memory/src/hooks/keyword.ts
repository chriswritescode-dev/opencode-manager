import type { Logger } from '../types'

export interface KeywordHooks {
  onMessage: (input: unknown, output: unknown) => Promise<void>
  isActivated: (sessionId: string) => boolean
  getMode: (sessionId: string) => string | undefined
}

interface TextPart {
  type: 'text'
  text: string
  synthetic?: boolean
  ignored?: boolean
}

interface ChatMessageInput {
  sessionID?: string
  agent?: string
  messageID?: string
}

interface ChatMessageOutput {
  message?: { id?: string; role: string; sessionID?: string }
  parts?: Array<TextPart>
}

interface ActivationState {
  activated: boolean
  mode?: string
}

const KEYWORD_PATTERNS = [
  /remember\s+(this|that)/i,
  /recall/i,
  /what\s+do\s+you\s+know\s+about/i,
  /project\s+memory/i,
  /do\s+you\s+remember/i,
  /stored\s+memory/i,
  /from\s+memory/i,
]

export const ACTIVATION_CONTEXT = `## Project Memory Available

This project has a memory system that stores architectural decisions, conventions, and patterns. You have access to:
- memory-read: Search and retrieve project memories
- memory-write: Store new project memories as suggestions
- memory-delete: Delete a memory by ID

Memory scopes: convention, decision, context

When relevant, use these tools to provide context from the project's knowledge base.`

const MODE_PATTERNS: Record<string, RegExp[]> = {
  creative: [
    /brainstorm/i,
    /be\s+creative/i,
    /explore\s+options/i,
    /generate\s+ideas/i,
  ],
  deepThink: [
    /think\s+hard/i,
    /think\s+deeply/i,
    /analyze\s+carefully/i,
    /think\s+through/i,
  ],
  thorough: [
    /go\s+deep/i,
    /be\s+thorough/i,
    /take\s+your\s+time/i,
  ],
}

export function createKeywordHooks(logger: Logger): KeywordHooks {
  const sessionStateMap = new Map<string, ActivationState>()

  return {
    async onMessage(input, output) {
      const chatInput = input as ChatMessageInput
      const chatOutput = output as ChatMessageOutput

      const sessionId = chatInput.sessionID
      if (!sessionId) return

      const existingState = sessionStateMap.get(sessionId)
      if (existingState?.activated && existingState.mode) return

      const parts = chatOutput.parts ?? []
      const textParts = parts.filter((p): p is TextPart => {
        if (p.type !== 'text') return false
        return typeof p.text === 'string' && p.text.length > 0
      })
      const userContent = textParts.map(p => p.text).join(' ')

      if (!userContent) return

      const hasKeyword = KEYWORD_PATTERNS.some((pattern) => pattern.test(userContent))
      const matchedModeEntry = Object.entries(MODE_PATTERNS).find(([, patterns]) =>
        patterns.some((pattern) => pattern.test(userContent))
      )
      const matchedMode = matchedModeEntry?.[0]

      if (!hasKeyword && !matchedMode) return

      const state = sessionStateMap.get(sessionId) ?? { activated: false }

      if (hasKeyword && !state.activated) {
        logger.log(`Keyword match detected in session ${sessionId}, setting activation flag`)
        state.activated = true
      }

      if (matchedMode && !state.mode) {
        logger.log(`Mode pattern detected in session ${sessionId}: ${matchedMode}`)
        state.mode = matchedMode
      }

      sessionStateMap.set(sessionId, state)
    },

    isActivated(sessionId: string): boolean {
      return sessionStateMap.get(sessionId)?.activated ?? false
    },

    getMode(sessionId: string): string | undefined {
      return sessionStateMap.get(sessionId)?.mode
    },
  }
}
