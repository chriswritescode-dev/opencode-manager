import { formatOpenCodeModelRef } from '@opencode-manager/shared/opencode'
import type {
  ModelRef,
  SessionMessageAssistant,
  SessionStatsModelUsage,
  TokenUsageInfo,
} from '@opencode-manager/shared/opencode'
import { isWithinUsageRange } from '@/lib/usageRange'

export interface ModelUsageTotals {
  steps: number
  tokens: TokenUsageInfo
  cost: number
}

export interface StepThroughput {
  tokens: number
  seconds: number
}

export interface SessionUsageSummary {
  steps: number
  cost: number
  tokens: TokenUsageInfo
  averageTokensPerSecond: number | null
  models: Array<{ model: ModelRef; steps: number; tokens: TokenUsageInfo; cost: number }>
  tools: Array<{
    name: string
    calls: number
    succeeded: number
    failed: number
    unfinished: number
    durationP50?: number
  }>
  availableModels: string[]
}

interface ModelUsageGroup {
  model: ModelRef
  steps: number
  tokens: TokenUsageInfo
  cost: number
}

interface ToolUsageGroup {
  name: string
  calls: number
  succeeded: number
  failed: number
  unfinished: number
  durations: number[]
}

function emptyTokens(): TokenUsageInfo {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

function addTokens(target: TokenUsageInfo, tokens: TokenUsageInfo): void {
  target.input += tokens.input
  target.output += tokens.output
  target.reasoning += tokens.reasoning
  target.cache.read += tokens.cache.read
  target.cache.write += tokens.cache.write
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[middle - 1] + sorted[middle]) / 2
  return sorted[middle]
}

export function totalTokens(tokens: TokenUsageInfo): number {
  return (
    tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  )
}

export function modelUsageKey(ref: ModelRef): string {
  return formatOpenCodeModelRef(ref)
}

export function formatUsd(cost: number): string {
  const fractionDigits = cost < 1 ? 4 : 2
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(cost)
}

export function formatTokensPerSecond(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} tok/s`
}

export function stepThroughput(step: SessionMessageAssistant): StepThroughput | null {
  const streamed = step.time.streamed
  if (!step.tokens || streamed === undefined || streamed <= step.time.created) return null
  return {
    tokens: step.tokens.output + step.tokens.reasoning,
    seconds: (streamed - step.time.created) / 1000,
  }
}

export function sumModelUsage(models: SessionStatsModelUsage[]): ModelUsageTotals {
  const tokens = emptyTokens()
  let steps = 0
  let cost = 0
  for (const model of models) {
    steps += model.steps
    cost += model.cost
    addTokens(tokens, model.tokens)
  }
  return { steps, tokens, cost }
}

export function filterModelUsage(
  models: SessionStatsModelUsage[],
  selectedKeys: string[],
): ModelUsageTotals {
  if (selectedKeys.length === 0) return sumModelUsage(models)
  const selected = new Set(selectedKeys)
  return sumModelUsage(models.filter((model) => selected.has(modelUsageKey(model.model))))
}

export function summarizeSessionSteps(
  steps: SessionMessageAssistant[],
  options: { range: { from?: number; to?: number }; models: string[] },
): SessionUsageSummary {
  const inRange = steps.filter((step) => isWithinUsageRange(step.time.created, options.range))
  const availableModels = [...new Set(inRange.map((step) => modelUsageKey(step.model)))].sort()
  const selected = new Set(options.models)
  const filtered =
    selected.size === 0
      ? inRange
      : inRange.filter((step) => selected.has(modelUsageKey(step.model)))

  const tokens = emptyTokens()
  const modelsByKey = new Map<string, ModelUsageGroup>()
  const toolsByName = new Map<string, ToolUsageGroup>()
  let cost = 0
  let throughputTokens = 0
  let throughputSeconds = 0
  let throughputSteps = 0

  for (const step of filtered) {
    cost += step.cost ?? 0
    if (step.tokens) addTokens(tokens, step.tokens)

    const throughput = stepThroughput(step)
    if (throughput) {
      throughputSteps += 1
      throughputTokens += throughput.tokens
      throughputSeconds += throughput.seconds
    }

    const key = modelUsageKey(step.model)
    let modelGroup = modelsByKey.get(key)
    if (!modelGroup) {
      modelGroup = { model: step.model, steps: 0, tokens: emptyTokens(), cost: 0 }
      modelsByKey.set(key, modelGroup)
    }
    modelGroup.steps += 1
    modelGroup.cost += step.cost ?? 0
    if (step.tokens) addTokens(modelGroup.tokens, step.tokens)

    for (const item of step.content) {
      if (item.type !== 'tool') continue
      let toolGroup = toolsByName.get(item.name)
      if (!toolGroup) {
        toolGroup = {
          name: item.name,
          calls: 0,
          succeeded: 0,
          failed: 0,
          unfinished: 0,
          durations: [],
        }
        toolsByName.set(item.name, toolGroup)
      }
      toolGroup.calls += 1
      if (item.state.status === 'completed') toolGroup.succeeded += 1
      else if (item.state.status === 'error') toolGroup.failed += 1
      else toolGroup.unfinished += 1
      if (item.time.completed !== undefined) {
        toolGroup.durations.push(item.time.completed - (item.time.ran ?? item.time.created))
      }
    }
  }

  const modelEntries = [...modelsByKey.values()].sort(
    (a, b) => b.cost - a.cost || b.steps - a.steps,
  )

  const toolEntries = [...toolsByName.values()]
    .sort((a, b) => b.calls - a.calls)
    .map((group) => {
      const durationP50 = median(group.durations)
      const entry = {
        name: group.name,
        calls: group.calls,
        succeeded: group.succeeded,
        failed: group.failed,
        unfinished: group.unfinished,
      }
      return durationP50 === undefined ? entry : { ...entry, durationP50 }
    })

  return {
    steps: filtered.length,
    cost,
    tokens,
    averageTokensPerSecond:
      throughputSteps > 0 && throughputSeconds > 0
        ? throughputTokens / throughputSeconds
        : null,
    models: modelEntries,
    tools: toolEntries,
    availableModels,
  }
}
