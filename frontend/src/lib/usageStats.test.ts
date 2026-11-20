import { describe, expect, it } from 'vitest'
import type {
  ModelRef,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionStatsModelUsage,
  TokenUsageInfo,
} from '@opencode-manager/shared/opencode'
import {
  filterModelUsage,
  formatTokensPerSecond,
  formatUsd,
  modelUsageKey,
  stepThroughput,
  summarizeSessionSteps,
  sumModelUsage,
  totalTokens,
} from './usageStats'

const MODEL_A: ModelRef = { providerID: 'anthropic', id: 'claude-opus-5-5' }
const MODEL_B: ModelRef = { providerID: 'openai', id: 'gpt-5', variant: 'high' }

function tokens(
  fields: {
    input?: number
    output?: number
    reasoning?: number
    cacheRead?: number
    cacheWrite?: number
  } = {},
): TokenUsageInfo {
  return {
    input: fields.input ?? 0,
    output: fields.output ?? 0,
    reasoning: fields.reasoning ?? 0,
    cache: { read: fields.cacheRead ?? 0, write: fields.cacheWrite ?? 0 },
  }
}

let stepSequence = 0

function step(
  overrides: Partial<Omit<SessionMessageAssistant, 'id' | 'type'>> & {
    time: SessionMessageAssistant['time']
  },
): SessionMessageAssistant {
  stepSequence += 1
  return {
    id: `msg_${stepSequence}`,
    type: 'assistant',
    agent: 'build',
    model: MODEL_A,
    content: [],
    ...overrides,
  }
}

let toolSequence = 0

function completedTool(
  name: string,
  time: { created: number; ran?: number; completed: number },
): SessionMessageAssistantTool {
  toolSequence += 1
  return {
    type: 'tool',
    id: `tool_${toolSequence}`,
    name,
    time,
    state: { status: 'completed', input: {}, content: [{ type: 'text', text: 'ok' }] },
  }
}

function failedTool(name: string, created: number): SessionMessageAssistantTool {
  toolSequence += 1
  return {
    type: 'tool',
    id: `tool_${toolSequence}`,
    name,
    time: { created },
    state: { status: 'error', input: {}, error: { type: 'tool_error', message: 'boom' } },
  }
}

function runningTool(name: string, created: number): SessionMessageAssistantTool {
  toolSequence += 1
  return {
    type: 'tool',
    id: `tool_${toolSequence}`,
    name,
    time: { created },
    state: { status: 'running', input: {}, metadata: {} },
  }
}

const RANGE = { from: 0, to: 5000 }

function sessionSteps(): SessionMessageAssistant[] {
  return [
    step({
      time: { created: 1000, streamed: 3000 },
      model: MODEL_A,
      tokens: tokens({ input: 100, output: 20, reasoning: 5, cacheRead: 10, cacheWrite: 2 }),
      cost: 0.5,
      content: [completedTool('bash', { created: 1000, ran: 1500, completed: 3500 })],
    }),
    step({
      time: { created: 2000, streamed: 4000 },
      model: MODEL_B,
      tokens: tokens({ input: 200, output: 30, reasoning: 10, cacheRead: 20, cacheWrite: 4 }),
      cost: 0.25,
      content: [failedTool('bash', 2000), runningTool('bash', 2500)],
    }),
    step({
      time: { created: 3000, completed: 9000 },
      model: MODEL_A,
      tokens: tokens({ input: 50, output: 10 }),
      cost: 0.05,
      content: [completedTool('read', { created: 3000, completed: 4000 })],
    }),
    step({
      time: { created: 10_000, streamed: 12_000 },
      model: MODEL_B,
      tokens: tokens({ input: 999, output: 999 }),
      cost: 9,
    }),
  ]
}

describe('totalTokens', () => {
  it('sums input, output, reasoning and both cache fields', () => {
    expect(
      totalTokens(
        tokens({ input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 }),
      ),
    ).toBe(15)
  })
})

describe('modelUsageKey', () => {
  it('formats provider and model id', () => {
    expect(modelUsageKey(MODEL_A)).toBe('anthropic/claude-opus-5-5')
  })

  it('includes the variant suffix when present', () => {
    expect(modelUsageKey(MODEL_B)).toBe('openai/gpt-5#high')
  })
})

describe('formatUsd', () => {
  it('shows four fraction digits below one dollar', () => {
    expect(formatUsd(0.0123)).toBe('$0.0123')
  })

  it('shows two fraction digits from one dollar', () => {
    expect(formatUsd(1.5)).toBe('$1.50')
  })

  it('shows a four digit zero for no spend', () => {
    expect(formatUsd(0)).toBe('$0.0000')
  })
})

describe('formatTokensPerSecond', () => {
  it('shows a dash when the rate is unknown', () => {
    expect(formatTokensPerSecond(null)).toBe('—')
  })

  it('shows one fraction digit with a unit', () => {
    expect(formatTokensPerSecond(42.14)).toBe('42.1 tok/s')
  })
})

describe('stepThroughput', () => {
  it('measures output and reasoning tokens over the streamed span', () => {
    const measured = step({
      time: { created: 1000, streamed: 3000 },
      tokens: tokens({ output: 40, reasoning: 2 }),
    })
    expect(stepThroughput(measured)).toEqual({ tokens: 42, seconds: 2 })
  })

  it('ignores the completed time when streamed is missing', () => {
    const measured = step({
      time: { created: 1000, completed: 5000 },
      tokens: tokens({ output: 40 }),
    })
    expect(stepThroughput(measured)).toBeNull()
  })

  it('returns null when streaming did not advance past creation', () => {
    const measured = step({
      time: { created: 1000, streamed: 1000 },
      tokens: tokens({ output: 40 }),
    })
    expect(stepThroughput(measured)).toBeNull()
  })

  it('returns null when the step has no tokens', () => {
    const measured = step({ time: { created: 1000, streamed: 3000 } })
    expect(stepThroughput(measured)).toBeNull()
  })
})

describe('summarizeSessionSteps', () => {
  it('totals steps, cost and every token field', () => {
    const summary = summarizeSessionSteps(sessionSteps(), { range: RANGE, models: [] })
    expect(summary.steps).toBe(3)
    expect(summary.cost).toBeCloseTo(0.8)
    expect(summary.tokens).toEqual(
      tokens({ input: 350, output: 60, reasoning: 15, cacheRead: 30, cacheWrite: 6 }),
    )
  })

  it('excludes steps outside the range', () => {
    const all = summarizeSessionSteps(sessionSteps(), { range: {}, models: [] })
    const ranged = summarizeSessionSteps(sessionSteps(), { range: RANGE, models: [] })
    expect(all.steps).toBe(4)
    expect(ranged.steps).toBe(3)
    expect(ranged.cost).toBeCloseTo(0.8)
  })

  it('keeps every available model while filtering to the selected one', () => {
    const summary = summarizeSessionSteps(sessionSteps(), {
      range: RANGE,
      models: [modelUsageKey(MODEL_B)],
    })
    expect(summary.steps).toBe(1)
    expect(summary.cost).toBeCloseTo(0.25)
    expect(summary.models).toHaveLength(1)
    expect(summary.models[0].model).toEqual(MODEL_B)
    expect(summary.models[0].tokens).toEqual(
      tokens({ input: 200, output: 30, reasoning: 10, cacheRead: 20, cacheWrite: 4 }),
    )
    expect(summary.availableModels).toEqual(['anthropic/claude-opus-5-5', 'openai/gpt-5#high'])
  })

  it('groups models by key and sorts them by cost, then steps', () => {
    const summary = summarizeSessionSteps(sessionSteps(), { range: RANGE, models: [] })
    expect(summary.models.map((entry) => modelUsageKey(entry.model))).toEqual([
      'anthropic/claude-opus-5-5',
      'openai/gpt-5#high',
    ])
    expect(summary.models[0].steps).toBe(2)
    expect(summary.models[0].cost).toBeCloseTo(0.55)
    expect(summary.models[1].steps).toBe(1)

    const tiedCost = [
      step({ time: { created: 1000 }, model: MODEL_A, cost: 0.75, tokens: tokens({ input: 1 }) }),
      step({ time: { created: 1000 }, model: MODEL_B, cost: 0.25, tokens: tokens({ input: 1 }) }),
      step({ time: { created: 1000 }, model: MODEL_B, cost: 0.25, tokens: tokens({ input: 1 }) }),
      step({ time: { created: 1000 }, model: MODEL_B, cost: 0.25, tokens: tokens({ input: 1 }) }),
    ]
    const bySteps = summarizeSessionSteps(tiedCost, { range: {}, models: [] })
    expect(bySteps.models.map((entry) => modelUsageKey(entry.model))).toEqual([
      'openai/gpt-5#high',
      'anthropic/claude-opus-5-5',
    ])
  })

  it('weights tokens per second over steps that streamed, ignoring completed-only spans', () => {
    const summary = summarizeSessionSteps(sessionSteps(), { range: RANGE, models: [] })
    expect(summary.averageTokensPerSecond).toBeCloseTo(16.25)

    const withoutThroughput = summarizeSessionSteps(
      [step({ time: { created: 1000, completed: 11_000 }, tokens: tokens({ output: 10 }) })],
      { range: {}, models: [] },
    )
    expect(withoutThroughput.averageTokensPerSecond).toBeNull()
  })

  it('counts tool outcomes and takes the median duration', () => {
    const summary = summarizeSessionSteps(sessionSteps(), { range: RANGE, models: [] })
    expect(summary.tools).toEqual([
      { name: 'bash', calls: 3, succeeded: 1, failed: 1, unfinished: 1, durationP50: 2000 },
      { name: 'read', calls: 1, succeeded: 1, failed: 0, unfinished: 0, durationP50: 1000 },
    ])
  })

  it('averages the two middle tool durations for an even count', () => {
    const summary = summarizeSessionSteps(
      [
        step({
          time: { created: 1000 },
          content: [
            completedTool('bash', { created: 0, completed: 1000 }),
            completedTool('bash', { created: 0, completed: 3000 }),
          ],
        }),
      ],
      { range: {}, models: [] },
    )
    expect(summary.tools).toEqual([
      { name: 'bash', calls: 2, succeeded: 2, failed: 0, unfinished: 0, durationP50: 2000 },
    ])
  })
})

const modelUsage: SessionStatsModelUsage[] = [
  {
    model: MODEL_A,
    steps: 2,
    tokens: tokens({ input: 10, output: 5, reasoning: 1, cacheRead: 2, cacheWrite: 1 }),
    cost: 0.5,
  },
  {
    model: MODEL_B,
    steps: 1,
    tokens: tokens({ input: 3, output: 2, reasoning: 0, cacheRead: 1, cacheWrite: 0 }),
    cost: 0.25,
  },
]

describe('sumModelUsage', () => {
  it('sums steps, cost and every token field', () => {
    expect(sumModelUsage(modelUsage)).toEqual({
      steps: 3,
      tokens: tokens({ input: 13, output: 7, reasoning: 1, cacheRead: 3, cacheWrite: 1 }),
      cost: 0.75,
    })
  })

  it('returns zeroed totals for no models', () => {
    expect(sumModelUsage([])).toEqual({ steps: 0, tokens: tokens(), cost: 0 })
  })
})

describe('filterModelUsage', () => {
  it('treats an empty selection as every model', () => {
    expect(filterModelUsage(modelUsage, [])).toEqual(sumModelUsage(modelUsage))
  })

  it('keeps only the selected model keys', () => {
    expect(filterModelUsage(modelUsage, [modelUsageKey(MODEL_B)])).toEqual({
      steps: 1,
      tokens: tokens({ input: 3, output: 2, reasoning: 0, cacheRead: 1, cacheWrite: 0 }),
      cost: 0.25,
    })
  })
})
