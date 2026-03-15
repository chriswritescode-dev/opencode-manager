import type { KvService } from './kv'
import type { Logger, RalphConfig } from '../types'

export const MAX_RETRIES = 3
export const DEFAULT_MIN_CLEAN_AUDITS = 2

export interface RalphState {
  active: boolean
  sessionId: string
  worktreeName: string
  worktreeDir: string
  worktreeBranch: string
  workspaceId: string
  iteration: number
  maxIterations: number
  completionPromise: string | null
  startedAt: string
  prompt: string
  phase: 'coding' | 'auditing'
  audit: boolean
  lastAuditResult?: string
  errorCount: number
  cleanAuditCount: number
  terminationReason?: string
  completedAt?: string
  parentSessionId?: string
  inPlace?: boolean
}

export interface RalphService {
  getActiveState(sessionId: string): RalphState | null
  getAnyState(sessionId: string): RalphState | null
  setState(sessionId: string, state: RalphState): void
  deleteState(sessionId: string): void
  checkCompletionPromise(text: string, promise: string): boolean
  buildContinuationPrompt(state: RalphState, auditFindings?: string): string
  buildAuditPrompt(state: RalphState): string
  listActive(): RalphState[]
  listRecent(): RalphState[]
  findByWorktreeName(name: string): RalphState | null
  getMinCleanAudits(): number
}

export function createRalphService(
  kvService: KvService,
  projectId: string,
  logger: Logger,
  ralphConfig?: RalphConfig,
): RalphService {
  const stateKey = (sessionId: string) => `ralph:${sessionId}`

  function getAnyState(sessionId: string): RalphState | null {
    return kvService.get<RalphState>(projectId, stateKey(sessionId))
  }

  function getActiveState(sessionId: string): RalphState | null {
    const state = kvService.get<RalphState>(projectId, stateKey(sessionId))
    if (!state || !state.active) {
      return null
    }
    return state
  }

  function setState(sessionId: string, state: RalphState): void {
    kvService.set(projectId, stateKey(sessionId), state)
  }

  function deleteState(sessionId: string): void {
    kvService.delete(projectId, stateKey(sessionId))
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
    let systemLine = `Ralph iteration ${state.iteration}`

    if (state.completionPromise) {
      systemLine += ` | To stop: output <promise>${state.completionPromise}</promise> (ONLY when all requirements are met)`
    } else if (state.maxIterations > 0) {
      systemLine += ` / ${state.maxIterations}`
    } else {
      systemLine += ` | No completion promise set - loop runs until cancelled`
    }

    let prompt = `[${systemLine}]\n\n${state.prompt}`

    if (auditFindings) {
      prompt += `\n\n---\nThe following issues were found by the code auditor. Fix them:\n${auditFindings}`
    }

    return prompt
  }

  function buildAuditPrompt(state: RalphState): string {
    const taskSummary = state.prompt.length > 200
      ? `${state.prompt.substring(0, 197)}...`
      : state.prompt

    return [
      `Post-iteration ${state.iteration} code review (branch: ${state.worktreeBranch}).`,
      '',
      `Task context: ${taskSummary}`,
      '',
      'Review the code changes in this worktree. Focus on bugs, logic errors, missing error handling, and convention violations.',
      'If everything looks good, state "No issues found." clearly.',
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
    return active.find((s) => s.worktreeName === name) ?? null
  }

  function getMinCleanAudits(): number {
    return ralphConfig?.minCleanAudits ?? DEFAULT_MIN_CLEAN_AUDITS
  }

  return {
    getActiveState,
    getAnyState,
    setState,
    deleteState,
    checkCompletionPromise,
    buildContinuationPrompt,
    buildAuditPrompt,
    listActive,
    listRecent,
    findByWorktreeName,
    getMinCleanAudits,
  }
}
