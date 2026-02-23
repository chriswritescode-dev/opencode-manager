import type { KeywordHooks } from './keyword'

export interface ParamsHooks {
  onParams: (input: unknown, output: unknown) => Promise<void>
}

interface ChatParamsInput {
  sessionID?: string
  agent: string
}

interface ChatParamsOutput {
  temperature?: number
  topP?: number
  topK?: number
  options?: Record<string, any>
}

type ModeConfig = {
  temperature?: number
  maxSteps?: number
  thinkingBudgetTokens?: number
}

const MODE_CONFIGS: Record<string, ModeConfig> = {
  creative: {
    temperature: 0.8,
  },
  deepThink: {
    thinkingBudgetTokens: 32000,
  },
  thorough: {
    maxSteps: 50,
  },
}

export function createParamsHooks(keywordHooks: KeywordHooks): ParamsHooks {
  return {
    async onParams(input, output) {
      const paramsInput = input as ChatParamsInput
      const paramsOutput = output as ChatParamsOutput

      const sessionId = paramsInput.sessionID
      if (!sessionId) return

      const mode = keywordHooks.getMode(sessionId)
      if (!mode) return

      const config = MODE_CONFIGS[mode]
      if (!config) return

      if (config.temperature !== undefined) {
        paramsOutput.temperature = config.temperature
      }

      if (config.maxSteps !== undefined) {
        if (!paramsOutput.options) {
          paramsOutput.options = {}
        }
        paramsOutput.options.maxSteps = config.maxSteps
      }

      if (config.thinkingBudgetTokens !== undefined) {
        if (!paramsOutput.options) {
          paramsOutput.options = {}
        }
        paramsOutput.options.thinking = {
          budgetTokens: config.thinkingBudgetTokens,
        }
      }
    },
  }
}
