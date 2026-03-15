import type { PluginInput } from '@opencode-ai/plugin'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import type { RalphService, RalphState } from '../services/ralph'
import { MAX_RETRIES } from '../services/ralph'
import type { Logger } from '../types'
import { execSync, spawnSync } from 'child_process'
import { resolve } from 'path'

export interface RalphEventHandler {
  onEvent(input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void>
}


export function hasAuditIssues(auditText: string): boolean {
  const lower = auditText.toLowerCase()

  if (lower.includes('no issues found') || lower.includes('0 issues found')) return false

  if (/\*\*severity\*\*[:\s]*bug/i.test(auditText)) return true
  if (/\*\*severity\*\*[:\s]*warning/i.test(auditText)) return true
  if (/severity[:\s]*bug/i.test(auditText)) return true
  if (/severity[:\s]*warning/i.test(auditText)) return true

  if (/\b[1-9]\d*\s+(issue|bug|warning)s?\s+found\b/i.test(auditText)) return true

  const issuesSection = auditText.match(/###?\s*Issues\s*\n([\s\S]*?)(?=\n###?\s|\n##\s|$)/i)
  if (issuesSection) {
    const content = issuesSection[1].trim()
    if (content.length > 0 && !/^(none|no issues|n\/a)\.?$/i.test(content)) return true
  }

  return false
}

export function createRalphEventHandler(
  ralphService: RalphService,
  client: PluginInput['client'],
  v2Client: OpencodeClient,
  logger: Logger,
): RalphEventHandler {
  const minCleanAudits = ralphService.getMinCleanAudits()
  async function commitAndCleanupWorktree(state: RalphState): Promise<{ committed: boolean; cleaned: boolean }> {
    if (state.inPlace) {
      logger.log(`Ralph: in-place mode, skipping commit and cleanup`)
      return { committed: false, cleaned: false }
    }

    let committed = false
    let cleaned = false

    try {
      const addResult = spawnSync('git', ['add', '-A'], { cwd: state.worktreeDir, encoding: 'utf-8' })
      if (addResult.status !== 0) {
        throw new Error(addResult.stderr || 'git add failed')
      }

      const statusResult = spawnSync('git', ['status', '--porcelain'], { cwd: state.worktreeDir, encoding: 'utf-8' })
      if (statusResult.status !== 0) {
        throw new Error(statusResult.stderr || 'git status failed')
      }
      const status = statusResult.stdout.trim()

      if (status) {
        const message = `ralph: ${state.worktreeName} completed after ${state.iteration} iterations`
        const commitResult = spawnSync('git', ['commit', '-m', message], { cwd: state.worktreeDir, encoding: 'utf-8' })
        if (commitResult.status !== 0) {
          throw new Error(commitResult.stderr || 'git commit failed')
        }
        committed = true
        logger.log(`Ralph: committed changes on branch ${state.worktreeBranch}`)
      } else {
        logger.log(`Ralph: no uncommitted changes to commit on branch ${state.worktreeBranch}`)
      }
    } catch (err) {
      logger.error(`Ralph: failed to commit changes in worktree ${state.worktreeDir}`, err)
    }

    try {
      const gitCommonDir = execSync('git rev-parse --git-common-dir', { cwd: state.worktreeDir, encoding: 'utf-8' }).trim()
      const gitRoot = resolve(state.worktreeDir, gitCommonDir, '..')
      const removeResult = spawnSync('git', ['worktree', 'remove', '-f', state.worktreeDir], { cwd: gitRoot, encoding: 'utf-8' })
      if (removeResult.status !== 0) {
        throw new Error(removeResult.stderr || 'git worktree remove failed')
      }
      cleaned = true
      logger.log(`Ralph: removed worktree ${state.worktreeDir}, branch ${state.worktreeBranch} preserved`)
    } catch (err) {
      logger.error(`Ralph: failed to remove worktree ${state.worktreeDir}`, err)
    }

    return { committed, cleaned }
  }

  async function terminateLoop(sessionId: string, state: RalphState, reason: string): Promise<void> {
    ralphService.setState(sessionId, {
      ...state,
      active: false,
      completedAt: new Date().toISOString(),
      terminationReason: reason,
    })
    logger.log(`Ralph loop terminated: reason="${reason}", worktree="${state.worktreeName}", iteration=${state.iteration}`)

    let commitResult: { committed: boolean; cleaned: boolean } | undefined
    if (reason === 'completed') {
      commitResult = await commitAndCleanupWorktree(state)
    }

    if (state.parentSessionId) {
      try {
        let notificationText: string
        if (state.inPlace) {
          if (reason === 'completed') {
            notificationText = [
              `Ralph loop "${state.worktreeName}" completed (in-place).`,
              '',
              `Iteration: ${state.iteration}`,
              `Changes are in the current directory on branch: ${state.worktreeBranch}`,
            ].join('\n')
          } else {
            notificationText = `Ralph loop "${state.worktreeName}" terminated (in-place).\n\nReason: ${reason}\nIteration: ${state.iteration}\nDirectory: ${state.worktreeDir}\nBranch: ${state.worktreeBranch}`
          }
        } else if (reason === 'completed' && commitResult) {
          const parts = [`Ralph loop "${state.worktreeName}" completed.`, '', `Iteration: ${state.iteration}`]
          if (commitResult.committed) {
            parts.push(`Changes committed on branch: ${state.worktreeBranch}`)
          }
          if (commitResult.cleaned) {
            parts.push(`Worktree removed. Use \`git merge ${state.worktreeBranch}\` or \`git checkout ${state.worktreeBranch}\` to access the changes.`)
          } else {
            parts.push(`Worktree: ${state.worktreeDir}`)
          }
          notificationText = parts.join('\n')
        } else {
          notificationText = `Ralph loop "${state.worktreeName}" terminated.\n\nReason: ${reason}\nIteration: ${state.iteration}\nWorktree: ${state.worktreeDir}\nBranch: ${state.worktreeBranch}`
        }

        await client.session.promptAsync({
          path: { id: state.parentSessionId },
          body: {
            parts: [{
              type: 'text' as const,
              text: notificationText,
            }],
          },
        })
      } catch (err) {
        logger.error(`Ralph: failed to notify parent session`, err)
      }
    }
  }

  async function handlePromptError(sessionId: string, state: RalphState, context: string, err: unknown): Promise<void> {
    const nextErrorCount = (state.errorCount ?? 0) + 1
    
    if (nextErrorCount < MAX_RETRIES) {
      logger.error(`Ralph: ${context} (attempt ${nextErrorCount}/${MAX_RETRIES}), will retry`, err)
      ralphService.setState(sessionId, { ...state, errorCount: nextErrorCount })
    } else {
      logger.error(`Ralph: ${context} (attempt ${nextErrorCount}/${MAX_RETRIES}), giving up`, err)
      await terminateLoop(sessionId, state, `error_max_retries: ${context}`)
    }
  }

  async function getLastAssistantText(sessionId: string, worktreeDir: string): Promise<string | null> {
    try {
      const messagesResult = await v2Client.session.messages({
        sessionID: sessionId,
        directory: worktreeDir,
        limit: 4,
      })

      const messages = (messagesResult.data ?? []) as Array<{
        info: { role: string }
        parts: Array<{ type: string; text?: string }>
      }>

      const lastAssistant = [...messages].reverse().find((m) => m.info.role === 'assistant')

      if (!lastAssistant) return null

      return lastAssistant.parts
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('\n')
    } catch (err) {
      logger.error(`Ralph: could not read session messages`, err)
      return null
    }
  }

  async function handleCodingPhase(sessionId: string, state: RalphState): Promise<void> {
    if (state.completionPromise) {
      const textContent = await getLastAssistantText(sessionId, state.worktreeDir)
      if (textContent && ralphService.checkCompletionPromise(textContent, state.completionPromise)) {
        if (!state.audit || (state.cleanAuditCount ?? 0) >= minCleanAudits) {
          await terminateLoop(sessionId, state, 'completed')
          logger.log(`Ralph loop completed: detected <promise>${state.completionPromise}</promise> at iteration ${state.iteration}`)
          return
        }
        logger.log(`Ralph: completion promise detected but only ${state.cleanAuditCount ?? 0}/${minCleanAudits} clean audits, continuing`)
      }
    }

    if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
      await terminateLoop(sessionId, state, 'max_iterations')
      return
    }

    if (state.audit) {
      ralphService.setState(sessionId, { ...state, phase: 'auditing', errorCount: 0 })
      logger.log(`Ralph iteration ${state.iteration} complete, running auditor for session ${sessionId}`)

      try {
        await v2Client.session.promptAsync({
          sessionID: sessionId,
          directory: state.worktreeDir,
          parts: [{
            type: 'subtask' as const,
            agent: 'auditor',
            description: `Post-iteration ${state.iteration} code review`,
            prompt: ralphService.buildAuditPrompt(state),
          }],
        })
      } catch (err) {
        await handlePromptError(sessionId, { ...state, phase: 'coding' }, 'failed to send audit prompt', err)
      }
      return
    }

    const nextIteration = state.iteration + 1
    ralphService.setState(sessionId, { ...state, iteration: nextIteration, errorCount: 0 })

    const continuationPrompt = ralphService.buildContinuationPrompt({ ...state, iteration: nextIteration })
    logger.log(`Ralph iteration ${nextIteration} for session ${sessionId}`)

    try {
      await v2Client.session.promptAsync({
        sessionID: sessionId,
        directory: state.worktreeDir,
        parts: [{ type: 'text' as const, text: continuationPrompt }],
      })
    } catch (err) {
      await handlePromptError(sessionId, state, 'failed to send continuation prompt', err)
    }
  }

  async function handleAuditingPhase(sessionId: string, state: RalphState): Promise<void> {
    const auditText = await getLastAssistantText(sessionId, state.worktreeDir)

    const nextIteration = state.iteration + 1
    const auditFindings = auditText && hasAuditIssues(auditText) ? auditText : undefined
    const currentCleanCount = state.cleanAuditCount ?? 0

    let newCleanAuditCount: number
    if (auditFindings) {
      logger.log(`Ralph audit found issues at iteration ${state.iteration}, resetting clean audit count`)
      newCleanAuditCount = 0
    } else {
      newCleanAuditCount = currentCleanCount + 1
      logger.log(`Ralph audit clean at iteration ${state.iteration} (${newCleanAuditCount}/${minCleanAudits} clean audits)`)
    }

    if (!auditFindings && state.completionPromise) {
      if (newCleanAuditCount >= minCleanAudits) {
        await terminateLoop(sessionId, state, 'completed')
        logger.log(`Ralph loop completed after ${newCleanAuditCount} clean audits at iteration ${state.iteration}`)
        return
      }
      logger.log(`Ralph: clean audit but only ${newCleanAuditCount}/${minCleanAudits} needed, continuing`)
    }

    if (state.maxIterations > 0 && nextIteration > state.maxIterations) {
      await terminateLoop(sessionId, state, 'max_iterations')
      return
    }

    ralphService.setState(sessionId, {
      ...state,
      iteration: nextIteration,
      phase: 'coding',
      lastAuditResult: auditFindings,
      cleanAuditCount: newCleanAuditCount,
      errorCount: 0,
    })

    const continuationPrompt = ralphService.buildContinuationPrompt(
      { ...state, iteration: nextIteration },
      auditFindings,
    )
    logger.log(`Ralph iteration ${nextIteration} for session ${sessionId}`)

    try {
      await v2Client.session.promptAsync({
        sessionID: sessionId,
        directory: state.worktreeDir,
        parts: [{ type: 'text' as const, text: continuationPrompt }],
      })
    } catch (err) {
      await handlePromptError(sessionId, state, 'failed to send continuation prompt after audit', err)
    }
  }

  async function onEvent(input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void> {
    const { event } = input

    if (event.type === 'worktree.failed') {
      const message = event.properties?.message as string
      const directory = event.properties?.directory as string
      logger.error(`Ralph: worktree failed: ${message}`)
      
      if (directory) {
        const activeLoops = ralphService.listActive()
        const affectedLoop = activeLoops.find((s) => s.worktreeDir === directory)
        if (affectedLoop) {
          await terminateLoop(affectedLoop.sessionId, affectedLoop, `worktree_failed: ${message}`)
        }
      }
      return
    }

    if (event.type !== 'session.idle') return

    const sessionId = event.properties?.sessionID as string
    if (!sessionId) return

    const state = ralphService.getActiveState(sessionId)
    if (!state || !state.active) return

    try {
      if (state.phase === 'auditing') {
        await handleAuditingPhase(sessionId, state)
      } else {
        await handleCodingPhase(sessionId, state)
      }
    } catch (err) {
      await handlePromptError(sessionId, state, `unhandled error in ${state.phase} phase`, err)
    }
  }

  return {
    onEvent,
  }
}
