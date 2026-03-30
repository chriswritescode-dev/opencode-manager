import type { KvService, KvEntry } from './kv'
import type { Logger, LoopConfig } from '../types'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import { findPartialMatch } from '../utils/partial-match'

export async function migrateRalphKeys(kvService: KvService, projectId: string, logger: Logger): Promise<void> {
  const oldEntries = await kvService.listByPrefix(projectId, 'ralph:')
  if (oldEntries.length === 0) return
  
  logger.log(`Migrating ${oldEntries.length} ralph: KV entries to loop: prefix`)
  for (const entry of oldEntries) {
    const newKey = entry.key.replace(/^ralph:/, 'loop:')
    const data = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data
    if ('inPlace' in data) {
      data.worktree = !data.inPlace
      delete data.inPlace
    }
    await kvService.set(projectId, newKey, data)
    await kvService.delete(projectId, entry.key)
  }
  
  const oldSessions = await kvService.listByPrefix(projectId, 'ralph-session:')
  for (const entry of oldSessions) {
    const newKey = entry.key.replace(/^ralph-session:/, 'loop-session:')
    await kvService.set(projectId, newKey, entry.data)
    await kvService.delete(projectId, entry.key)
  }
  
  if (oldSessions.length > 0) {
    logger.log(`Migrated ${oldSessions.length} ralph-session: KV entries to loop-session: prefix`)
  }
}

export const MAX_RETRIES = 3
export const STALL_TIMEOUT_MS = 60_000
export const MAX_CONSECUTIVE_STALLS = 5
export const DEFAULT_MIN_AUDITS = 1
export const RECENT_MESSAGES_COUNT = 5

export interface LoopState {
  active: boolean
  sessionId: string
  worktreeName: string
  worktreeDir: string
  worktreeBranch?: string
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
  worktree?: boolean
  modelFailed?: boolean
}

export interface LoopService {
  getActiveState(name: string): LoopState | null
  getAnyState(name: string): LoopState | null
  setState(name: string, state: LoopState): void
  deleteState(name: string): void
  registerSession(sessionId: string, worktreeName: string): void
  resolveWorktreeName(sessionId: string): string | null
  unregisterSession(sessionId: string): void
  checkCompletionPromise(text: string, promise: string): boolean
  buildContinuationPrompt(state: LoopState, auditFindings?: string): string
  buildAuditPrompt(state: LoopState): string
  listActive(): LoopState[]
  listRecent(): LoopState[]
  findByWorktreeName(name: string): LoopState | null
  findCandidatesByPartialName(name: string): LoopState[]
  getStallTimeoutMs(): number
  getMinAudits(): number
  terminateAll(): void
  reconcileStale(): number
  hasOutstandingFindings(branch?: string): boolean
  getOutstandingFindings(branch?: string): KvEntry[]
}

export function createLoopService(
  kvService: KvService,
  projectId: string,
  logger: Logger,
  loopConfig?: LoopConfig,
): LoopService {
  const stateKey = (name: string) => `loop:${name}`

  function getAnyState(name: string): LoopState | null {
    return kvService.get<LoopState>(projectId, stateKey(name))
  }

  function getActiveState(name: string): LoopState | null {
    const state = kvService.get<LoopState>(projectId, stateKey(name))
    if (!state || !state.active) {
      return null
    }
    return state
  }

  function setState(name: string, state: LoopState): void {
    kvService.set(projectId, stateKey(name), state)
  }

  function deleteState(name: string): void {
    kvService.delete(projectId, stateKey(name))
  }

  function registerSession(sessionId: string, worktreeName: string): void {
    kvService.set(projectId, `loop-session:${sessionId}`, worktreeName)
  }

  function resolveWorktreeName(sessionId: string): string | null {
    return kvService.get<string>(projectId, `loop-session:${sessionId}`)
  }

  function unregisterSession(sessionId: string): void {
    kvService.delete(projectId, `loop-session:${sessionId}`)
  }

  function checkCompletionPromise(text: string, promise: string): boolean {
    const match = text.match(/<promise>([\s\S]*?)<\/promise>/)
    if (!match) {
      return false
    }
    const extracted = match[1].trim().replace(/\s+/g, ' ')
    return extracted === promise
  }

  function buildContinuationPrompt(state: LoopState, auditFindings?: string): string {
    let systemLine = `Loop iteration ${state.iteration ?? 0}`

    if (state.completionPromise) {
      systemLine += ` | To stop: output <promise>${state.completionPromise}</promise> (ONLY after all verification steps pass)`
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

    const outstandingFindings = getOutstandingFindings(state.worktreeBranch)
    if (outstandingFindings.length > 0) {
      const findingKeys = outstandingFindings.map((f) => `- \`${f.key}\``).join('\n')
      prompt += `\n\n---\n⚠️ Outstanding Review Findings (${outstandingFindings.length})\n\nThese review findings are blocking loop completion. Fix these issues so they pass the next audit review.\n\n${findingKeys}`
    }

    return prompt
  }

  function buildAuditPrompt(state: LoopState): string {
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
      'Before reviewing, retrieve all existing review findings by calling the memory-kv-list tool with the prefix parameter set to "review-finding:". For each existing finding, verify whether the issue has been resolved in the current code. Delete resolved findings by calling the memory-kv-delete tool. Report any unresolved findings that still apply.',
      '',
      'This is an automated loop — do not direct the agent to "create a plan" or "present for approval." Just report findings directly.',
    ].join('\n')
  }

  function listActive(): LoopState[] {
    const entries = kvService.listByPrefix(projectId, 'loop:')
    return entries
      .map((entry) => entry.data as LoopState)
      .filter((state): state is LoopState => state !== null && state.active)
  }

  function listRecent(): LoopState[] {
    const entries = kvService.listByPrefix(projectId, 'loop:')
    return entries
      .map((entry) => entry.data as LoopState)
      .filter((state): state is LoopState => state !== null && !state.active)
  }

  function findByWorktreeName(name: string): LoopState | null {
    const active = listActive()
    const recent = listRecent()
    const allStates = [...active, ...recent]

    const { match } = findPartialMatch(name, allStates, (s) => [s.worktreeName, s.worktreeBranch])
    return match
  }

  function findCandidatesByPartialName(name: string): LoopState[] {
    const active = listActive()
    const recent = listRecent()
    const allStates = [...active, ...recent]

    const { candidates } = findPartialMatch(name, allStates, (s) => [s.worktreeName, s.worktreeBranch])
    return candidates
  }

  function getStallTimeoutMs(): number {
    return loopConfig?.stallTimeoutMs ?? STALL_TIMEOUT_MS
  }

  function getMinAudits(): number {
    return loopConfig?.minAudits ?? DEFAULT_MIN_AUDITS
  }

  function terminateAll(): void {
    const active = listActive()
    for (const state of active) {
      const updated: LoopState = {
        ...state,
        active: false,
        completedAt: new Date().toISOString(),
        terminationReason: 'shutdown',
      }
      setState(state.worktreeName, updated)
    }
    logger.log(`Loop: terminated ${active.length} active loop(s)`)
  }

  function reconcileStale(): number {
    const active = listActive()
    for (const state of active) {
      setState(state.worktreeName, {
        ...state,
        active: false,
        completedAt: new Date().toISOString(),
        terminationReason: 'shutdown',
      })
      logger.log(`Reconciled stale active loop: ${state.worktreeName} (was at iteration ${state.iteration})`)
    }
    return active.length
  }

  function getOutstandingFindings(branch?: string): KvEntry[] {
    const findings = kvService.listByPrefix(projectId, 'review-finding:')
    if (!branch) return findings
    return findings.filter((f) => {
      const data = f.data as Record<string, unknown> | null
      return data && data.branch === branch
    })
  }

  function hasOutstandingFindings(branch?: string): boolean {
    return getOutstandingFindings(branch).length > 0
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
    reconcileStale,
    hasOutstandingFindings,
    getOutstandingFindings,
  }
}

export interface LoopSessionOutput {
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
): Promise<LoopSessionOutput | null> {
  if (!directory || !sessionId) {
    logger?.debug('fetchSessionOutput: invalid directory or sessionId')
    return null
  }

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
      logger.error(`Loop: could not fetch session output for ${sessionId}`, err)
    }
    return null
  }
}
