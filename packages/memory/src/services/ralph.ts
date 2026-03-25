import type { KvService } from './kv'
import type { Logger, RalphConfig } from '../types'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import { findPartialMatch } from '../utils/partial-match'

export const MAX_RETRIES = 3
export const STALL_TIMEOUT_MS = 60_000
export const MAX_CONSECUTIVE_STALLS = 5
export const DEFAULT_MIN_AUDITS = 1
export const RECENT_MESSAGES_COUNT = 5

export interface RalphState {
  active: boolean
  sessionId: string
  worktreeName: string
  worktreeDir: string
  worktreeBranch?: string
  workspaceId?: string
  iteration: number
  maxIterations: number
  completionPromise: string | null
  startedAt: string
  prompt?: string
  phase: 'coding' | 'auditing'
  audit?: boolean
  lastAuditResult?: string
  errorCount: number
  auditCount: number
  terminationReason?: string
  completedAt?: string
  inPlace?: boolean
  modelFailed?: boolean
}

export interface RalphService {
  getActiveState(name: string): RalphState | null
  getAnyState(name: string): RalphState | null
  setState(name: string, state: RalphState): void
  deleteState(name: string): void
  registerSession(sessionId: string, worktreeName: string): void
  resolveWorktreeName(sessionId: string): string | null
  unregisterSession(sessionId: string): void
  checkCompletionPromise(text: string, promise: string): boolean
  buildContinuationPrompt(state: RalphState, auditFindings?: string): string
  buildAuditPrompt(state: RalphState): string
  listActive(): RalphState[]
  listRecent(): RalphState[]
  findByWorktreeName(name: string): RalphState | null
  findCandidatesByPartialName(name: string): RalphState[]
  getStallTimeoutMs(): number
  getMinAudits(): number
  terminateAll(): void
}

export function createRalphService(
  kvService: KvService,
  projectId: string,
  logger: Logger,
  ralphConfig?: RalphConfig,
): RalphService {
  const stateKey = (name: string) => `ralph:${name}`

  function getAnyState(name: string): RalphState | null {
    return kvService.get<RalphState>(projectId, stateKey(name))
  }

  function getActiveState(name: string): RalphState | null {
    const state = kvService.get<RalphState>(projectId, stateKey(name))
    if (!state || !state.active) {
      return null
    }
    return state
  }

  function setState(name: string, state: RalphState): void {
    kvService.set(projectId, stateKey(name), state)
  }

  function deleteState(name: string): void {
    kvService.delete(projectId, stateKey(name))
  }

  function registerSession(sessionId: string, worktreeName: string): void {
    kvService.set(projectId, `ralph-session:${sessionId}`, worktreeName)
  }

  function resolveWorktreeName(sessionId: string): string | null {
    return kvService.get<string>(projectId, `ralph-session:${sessionId}`)
  }

  function unregisterSession(sessionId: string): void {
    kvService.delete(projectId, `ralph-session:${sessionId}`)
  }

  function checkCompletionPromise(text: string, promise: string): boolean {
    const match = text.match(/<promise>([\s\S]*?)<\/promise>/)
    if (!match) {
      return false
    }
    const extracted = match[1].trim().replace(/\s+/g, ' ')
    return extracted === promise
  }

  function buildContinuationPrompt(state: RalphState, auditFindings?: string): string {
    let systemLine = `Ralph iteration ${state.iteration ?? 0}`

    if (state.completionPromise) {
      systemLine += ` | To stop: output <promise>${state.completionPromise}</promise> (ONLY when all requirements are met)`
    } else if ((state.maxIterations ?? 0) > 0) {
      systemLine += ` / ${state.maxIterations}`
    } else {
      systemLine += ` | No completion promise set - loop runs until cancelled`
    }

    let prompt = `[${systemLine}]\n\n${state.prompt ?? ''}`

    if (auditFindings) {
      const completionInstruction = state.completionPromise
        ? '\n\nAfter fixing all issues, output the completion signal.'
        : ''
      prompt += `\n\n---\nThe code auditor reviewed your changes. You MUST address all bugs and convention violations below — do not dismiss findings as unrelated to the task. Fix them directly without creating a plan or asking for approval.\n\n${auditFindings}${completionInstruction}`
    }

    return prompt
  }

  function buildAuditPrompt(state: RalphState): string {
    const taskSummary = (state.prompt?.length ?? 0) > 200
      ? `${state.prompt?.substring(0, 197)}...`
      : (state.prompt ?? '')

    const branchInfo = state.worktreeBranch ? ` (branch: ${state.worktreeBranch})` : ''
    return [
      `Post-iteration ${state.iteration ?? 0} code review${branchInfo}.`,
      '',
      `Task context: ${taskSummary}`,
      '',
      'Review the code changes in this worktree. Focus on bugs, logic errors, missing error handling, and convention violations.',
      'If you find bugs in related code that affect the correctness of this task, report them — even if the buggy code was not directly modified.',
      'If everything looks good, state "No issues found." clearly.',
      '',
      'This is an automated loop — do not direct the agent to "create a plan" or "present for approval." Just report findings directly.',
    ].join('\n')
  }

  function listActive(): RalphState[] {
    const entries = kvService.listByPrefix(projectId, 'ralph:')
    return entries
      .map((entry) => entry.data as RalphState)
      .filter((state): state is RalphState => state !== null && state.active)
  }

  function listRecent(): RalphState[] {
    const entries = kvService.listByPrefix(projectId, 'ralph:')
    return entries
      .map((entry) => entry.data as RalphState)
      .filter((state): state is RalphState => state !== null && !state.active)
  }

  function findByWorktreeName(name: string): RalphState | null {
    const active = listActive()
    const recent = listRecent()
    const allStates = [...active, ...recent]

    const { match } = findPartialMatch(name, allStates, (s) => [s.worktreeName, s.worktreeBranch])
    return match
  }

  function findCandidatesByPartialName(name: string): RalphState[] {
    const active = listActive()
    const recent = listRecent()
    const allStates = [...active, ...recent]

    const { candidates } = findPartialMatch(name, allStates, (s) => [s.worktreeName, s.worktreeBranch])
    return candidates
  }

  function getStallTimeoutMs(): number {
    return ralphConfig?.stallTimeoutMs ?? STALL_TIMEOUT_MS
  }

  function getMinAudits(): number {
    return ralphConfig?.minAudits ?? DEFAULT_MIN_AUDITS
  }

  function terminateAll(): void {
    const active = listActive()
    for (const state of active) {
      const updated: RalphState = {
        ...state,
        active: false,
        completedAt: new Date().toISOString(),
        terminationReason: 'shutdown',
      }
      setState(state.worktreeName, updated)
    }
    logger.log(`Ralph: terminated ${active.length} active loop(s)`)
  }

  return {
    getActiveState,
    getAnyState,
    setState,
    deleteState,
    registerSession,
    resolveWorktreeName,
    unregisterSession,
    checkCompletionPromise,
    buildContinuationPrompt,
    buildAuditPrompt,
    listActive,
    listRecent,
    findByWorktreeName,
    findCandidatesByPartialName,
    getStallTimeoutMs,
    getMinAudits,
    terminateAll,
  }
}

export interface RalphSessionOutput {
  messages: Array<{ text: string; cost: number; tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number } }>
  totalCost: number
  totalTokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
  fileChanges: { additions: number; deletions: number; files: number } | null
}

export async function fetchSessionOutput(
  v2Client: OpencodeClient,
  sessionId: string,
  directory: string,
  logger?: Logger,
): Promise<RalphSessionOutput | null> {
  try {
    const messagesResult = await v2Client.session.messages({
      sessionID: sessionId,
      directory,
    })

    const messages = (messagesResult.data ?? []) as Array<{
      info: { role: string; cost?: number; tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } }
      parts: Array<{ type: string; text?: string }>
    }>

    const assistantMessages = messages.filter((m) => m.info.role === 'assistant')
    const lastThree = assistantMessages.slice(-RECENT_MESSAGES_COUNT)

    const extractedMessages = lastThree.map((msg) => {
      const text = msg.parts
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('\n')
      const cost = msg.info.cost ?? 0
      const tokens = msg.info.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
      return {
        text,
        cost,
        tokens: {
          input: tokens.input,
          output: tokens.output,
          reasoning: tokens.reasoning,
          cacheRead: tokens.cache?.read ?? 0,
          cacheWrite: tokens.cache?.write ?? 0,
        },
      }
    })

    let totalCost = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalReasoningTokens = 0
    let totalCacheRead = 0
    let totalCacheWrite = 0

    for (const msg of assistantMessages) {
      totalCost += msg.info.cost ?? 0
      const tokens = msg.info.tokens
      if (tokens) {
        totalInputTokens += tokens.input ?? 0
        totalOutputTokens += tokens.output ?? 0
        totalReasoningTokens += tokens.reasoning ?? 0
        totalCacheRead += tokens.cache?.read ?? 0
        totalCacheWrite += tokens.cache?.write ?? 0
      }
    }

    const sessionResult = await v2Client.session.get({ sessionID: sessionId, directory })
    const session = sessionResult.data as { summary?: { additions: number; deletions: number; files: number } } | undefined
    const fileChanges = session?.summary
      ? {
          additions: session.summary.additions,
          deletions: session.summary.deletions,
          files: session.summary.files,
        }
      : null

    return {
      messages: extractedMessages,
      totalCost,
      totalTokens: {
        input: totalInputTokens,
        output: totalOutputTokens,
        reasoning: totalReasoningTokens,
        cacheRead: totalCacheRead,
        cacheWrite: totalCacheWrite,
      },
      fileChanges,
    }
  } catch (err) {
    if (logger) {
      logger.error(`Ralph: could not fetch session output for ${sessionId}`, err)
    }
    return null
  }
}
