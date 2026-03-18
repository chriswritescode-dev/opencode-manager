import type { PluginInput } from '@opencode-ai/plugin'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import type { RalphService, RalphState } from '../services/ralph'
import { MAX_RETRIES, MAX_CONSECUTIVE_STALLS } from '../services/ralph'
import type { Logger, PluginConfig } from '../types'
import { parseModelString, retryWithModelFallback } from '../utils/model-fallback'
import { execSync, spawnSync } from 'child_process'
import { resolve } from 'path'

export interface RalphEventHandler {
  onEvent(input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void>
  terminateAll(): void
  clearAllRetryTimeouts(): void
  startWatchdog(sessionId: string): void
  getStallInfo(sessionId: string): { consecutiveStalls: number; lastActivityTime: number } | null
}

export function createRalphEventHandler(
  ralphService: RalphService,
  client: PluginInput['client'],
  v2Client: OpencodeClient,
  logger: Logger,
  getConfig: () => PluginConfig,
): RalphEventHandler {
  const minAudits = ralphService.getMinAudits()
  const retryTimeouts = new Map<string, NodeJS.Timeout>()
  const lastActivityTime = new Map<string, number>()
  const stallWatchdogs = new Map<string, NodeJS.Timeout>()
  const consecutiveStalls = new Map<string, number>()
  const childSessions = new Map<string, Set<string>>()
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

  function findRalphParent(childSessionId: string): string | undefined {
    for (const [ralphId, children] of childSessions.entries()) {
      if (children.has(childSessionId)) {
        return ralphId
      }
    }
    return undefined
  }

  function recordActivity(sessionId: string): void {
    lastActivityTime.set(sessionId, Date.now())
  }

  function stopWatchdog(sessionId: string): void {
    const interval = stallWatchdogs.get(sessionId)
    if (interval) {
      clearInterval(interval)
      stallWatchdogs.delete(sessionId)
    }
    lastActivityTime.delete(sessionId)
    consecutiveStalls.delete(sessionId)
    childSessions.delete(sessionId)
  }

  function startWatchdog(sessionId: string): void {
    stopWatchdog(sessionId)
    lastActivityTime.set(sessionId, Date.now())
    consecutiveStalls.set(sessionId, 0)

    const stallTimeout = ralphService.getStallTimeoutMs()

    const interval = setInterval(async () => {
      const lastActivity = lastActivityTime.get(sessionId)
      if (!lastActivity) return

      const elapsed = Date.now() - lastActivity
      if (elapsed < stallTimeout) return

      const state = ralphService.getActiveState(sessionId)
      if (!state?.active) {
        stopWatchdog(sessionId)
        return
      }

      try {
        const statusResult = await v2Client.session.status()
        const statuses = (statusResult.data ?? {}) as Record<string, { type: string }>

        const sessionIds = [sessionId, ...(childSessions.get(sessionId) ?? [])]
        const hasActiveWork = sessionIds.some(id => {
          const status = statuses[id]?.type
          return status === 'busy' || status === 'retry' || status === 'compact'
        })

        if (hasActiveWork) {
          lastActivityTime.set(sessionId, Date.now())
          logger.log(`Ralph watchdog: session ${sessionId} has active work, resetting timer`)
          return
        }
      } catch (err) {
        logger.error(`Ralph watchdog: failed to check session status`, err)
        return
      }

      const stallCount = (consecutiveStalls.get(sessionId) ?? 0) + 1
      consecutiveStalls.set(sessionId, stallCount)
      lastActivityTime.set(sessionId, Date.now())

      if (stallCount >= MAX_CONSECUTIVE_STALLS) {
        logger.error(`Ralph watchdog: session ${sessionId} exceeded max consecutive stalls (${MAX_CONSECUTIVE_STALLS}), terminating`)
        await terminateLoop(sessionId, state, 'stall_timeout')
        return
      }

      logger.log(`Ralph watchdog: stall detected for session ${sessionId} (${stallCount}/${MAX_CONSECUTIVE_STALLS}), re-triggering ${state.phase} phase`)

      try {
        if (state.phase === 'auditing') {
          await handleAuditingPhase(sessionId, state)
        } else {
          await handleCodingPhase(sessionId, state)
        }
      } catch (err) {
        await handlePromptError(sessionId, state, `watchdog recovery in ${state.phase} phase`, err)
      }
    }, stallTimeout)

    stallWatchdogs.set(sessionId, interval)
    logger.log(`Ralph watchdog: started for session ${sessionId} (timeout: ${stallTimeout}ms)`)
  }

  function getStallInfo(sessionId: string): { consecutiveStalls: number; lastActivityTime: number } | null {
    const lastActivity = lastActivityTime.get(sessionId)
    if (lastActivity === undefined) return null
    return {
      consecutiveStalls: consecutiveStalls.get(sessionId) ?? 0,
      lastActivityTime: lastActivity,
    }
  }

  async function terminateLoop(sessionId: string, state: RalphState, reason: string): Promise<void> {
    stopWatchdog(sessionId)

    const retryTimeout = retryTimeouts.get(sessionId)
    if (retryTimeout) {
      clearTimeout(retryTimeout)
      retryTimeouts.delete(sessionId)
    }

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

  async function handlePromptError(sessionId: string, state: RalphState, context: string, err: unknown, retryFn?: () => Promise<void>): Promise<void> {
    const nextErrorCount = (state.errorCount ?? 0) + 1
    
    if (nextErrorCount < MAX_RETRIES) {
      logger.error(`Ralph: ${context} (attempt ${nextErrorCount}/${MAX_RETRIES}), will retry`, err)
      ralphService.setState(sessionId, { ...state, errorCount: nextErrorCount })
      if (retryFn) {
        const retryTimeout = setTimeout(async () => {
          const currentState = ralphService.getActiveState(sessionId)
          if (!currentState?.active) {
            logger.log(`Ralph: loop cancelled, skipping retry`)
            retryTimeouts.delete(sessionId)
            return
          }
          try {
            await retryFn()
          } catch (retryErr) {
            await handlePromptError(sessionId, { ...state, errorCount: nextErrorCount }, context, retryErr, retryFn)
          }
        }, 2000)
        retryTimeouts.set(sessionId, retryTimeout)
      }
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
        // Check if minimum audits have been performed
        const currentAuditCount = state.auditCount ?? 0
        if (!state.audit || currentAuditCount >= minAudits) {
          await terminateLoop(sessionId, state, 'completed')
          logger.log(`Ralph loop completed: detected <promise>${state.completionPromise}</promise> at iteration ${state.iteration} (${currentAuditCount}/${minAudits} audits)`)
          return
        }
        logger.log(`Ralph: completion promise detected but only ${currentAuditCount}/${minAudits} audits performed, continuing`)
      }
    }

    if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
      await terminateLoop(sessionId, state, 'max_iterations')
      return
    }

    if (state.audit) {
      ralphService.setState(sessionId, { ...state, phase: 'auditing', errorCount: 0 })
      logger.log(`Ralph iteration ${state.iteration} complete, running auditor for session ${sessionId}`)

      const auditPrompt = {
        sessionID: sessionId,
        directory: state.worktreeDir,
        parts: [{
          type: 'subtask' as const,
          agent: 'auditor',
          description: `Post-iteration ${state.iteration} code review`,
          prompt: ralphService.buildAuditPrompt(state),
        }],
      }
      
      const promptResult = await v2Client.session.promptAsync(auditPrompt)
      
      if (promptResult.error) {
        const retryFn = async () => {
          const result = await v2Client.session.promptAsync(auditPrompt)
          if (result.error) {
            throw result.error
          }
        }
        await handlePromptError(sessionId, { ...state, phase: 'coding' }, 'failed to send audit prompt', promptResult.error, retryFn)
        return
      }
      
      const currentConfig = getConfig()
      const configuredModel = currentConfig.auditorModel ?? currentConfig.ralph?.model ?? currentConfig.executionModel
      logger.log(`auditor using agent-configured model: ${configuredModel ?? 'default'}`)
      
      consecutiveStalls.set(sessionId, 0)
      return
    }

    const nextIteration = state.iteration + 1
    ralphService.setState(sessionId, { ...state, iteration: nextIteration, errorCount: 0 })

    const continuationPrompt = ralphService.buildContinuationPrompt({ ...state, iteration: nextIteration })
    logger.log(`Ralph iteration ${nextIteration} for session ${sessionId}`)

    const currentConfig = getConfig()
    const ralphModel = parseModelString(currentConfig.ralph?.model) ?? parseModelString(currentConfig.executionModel)

    const sendContinuationPromptWithModel = async () => {
      const result = await v2Client.session.promptAsync({
        sessionID: sessionId,
        directory: state.worktreeDir,
        parts: [{ type: 'text' as const, text: continuationPrompt }],
        model: ralphModel!,
      })
      return { data: result.data, error: result.error }
    }
    
    const sendContinuationPromptWithoutModel = async () => {
      const result = await v2Client.session.promptAsync({
        sessionID: sessionId,
        directory: state.worktreeDir,
        parts: [{ type: 'text' as const, text: continuationPrompt }],
      })
      return { data: result.data, error: result.error }
    }
    
    const { result: promptResult, usedModel: actualModel } = await retryWithModelFallback(
      sendContinuationPromptWithModel,
      sendContinuationPromptWithoutModel,
      ralphModel,
      logger,
    )
    
    if (promptResult.error) {
      const retryFn = async () => {
        const result = await sendContinuationPromptWithoutModel()
        if (result.error) {
          throw result.error
        }
      }
      await handlePromptError(sessionId, state, 'failed to send continuation prompt', promptResult.error, retryFn)
      return
    }
    
    if (actualModel) {
      logger.log(`coding phase using model: ${actualModel.providerID}/${actualModel.modelID}`)
    } else {
      logger.log(`coding phase using default model (fallback)`)
    }
    
    consecutiveStalls.set(sessionId, 0)
  }

  async function handleAuditingPhase(sessionId: string, state: RalphState): Promise<void> {
    const auditText = await getLastAssistantText(sessionId, state.worktreeDir)

    const nextIteration = state.iteration + 1
    const newAuditCount = (state.auditCount ?? 0) + 1
    logger.log(`Ralph audit ${newAuditCount} at iteration ${state.iteration}`)

    // Always pass the full audit response to the code agent
    const auditFindings = auditText ?? undefined

    if (state.completionPromise && auditText) {
      if (ralphService.checkCompletionPromise(auditText, state.completionPromise)) {
        // Check if minimum audits have been performed
        if (!state.audit || newAuditCount >= minAudits) {
          await terminateLoop(sessionId, state, 'completed')
          logger.log(`Ralph loop completed: detected <promise>${state.completionPromise}</promise> in audit at iteration ${state.iteration} (${newAuditCount}/${minAudits} audits)`)
          return
        }
        logger.log(`Ralph: completion promise detected but only ${newAuditCount}/${minAudits} audits performed, continuing`)
      }
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
      auditCount: newAuditCount,
      errorCount: 0,
    })

    const continuationPrompt = ralphService.buildContinuationPrompt(
      { ...state, iteration: nextIteration },
      auditFindings,
    )
    logger.log(`Ralph iteration ${nextIteration} for session ${sessionId}`)

    const currentConfig = getConfig()
    const ralphModel = parseModelString(currentConfig.ralph?.model) ?? parseModelString(currentConfig.executionModel)

    const sendContinuationPromptWithModel = async () => {
      const result = await v2Client.session.promptAsync({
        sessionID: sessionId,
        directory: state.worktreeDir,
        parts: [{ type: 'text' as const, text: continuationPrompt }],
        model: ralphModel!,
      })
      return { data: result.data, error: result.error }
    }
    
    const sendContinuationPromptWithoutModel = async () => {
      const result = await v2Client.session.promptAsync({
        sessionID: sessionId,
        directory: state.worktreeDir,
        parts: [{ type: 'text' as const, text: continuationPrompt }],
      })
      return { data: result.data, error: result.error }
    }
    
    const { result: promptResult, usedModel: actualModel } = await retryWithModelFallback(
      sendContinuationPromptWithModel,
      sendContinuationPromptWithoutModel,
      ralphModel,
      logger,
    )
    
    if (promptResult.error) {
      const retryFn = async () => {
        const result = await sendContinuationPromptWithoutModel()
        if (result.error) {
          throw result.error
        }
      }
      await handlePromptError(sessionId, state, 'failed to send continuation prompt after audit', promptResult.error, retryFn)
      return
    }
    
    if (actualModel) {
      logger.log(`coding continuation using model: ${actualModel.providerID}/${actualModel.modelID}`)
    } else {
      logger.log(`coding continuation using default model (fallback)`)
    }
    
    consecutiveStalls.set(sessionId, 0)
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

    if (event.type === 'session.created' || event.type === 'session.updated') {
      const info = event.properties?.info as { id?: string; parentID?: string } | undefined
      if (info?.id && info?.parentID) {
        const parentState = ralphService.getActiveState(info.parentID)
        if (parentState?.active) {
          let children = childSessions.get(info.parentID)
          if (!children) {
            children = new Set()
            childSessions.set(info.parentID, children)
          }
          children.add(info.id)
          recordActivity(info.parentID)
        }
      }
    }

    if (event.type === 'session.status') {
      const eventSessionId = event.properties?.sessionID as string
      if (eventSessionId) {
        if (ralphService.getActiveState(eventSessionId)?.active) {
          recordActivity(eventSessionId)
        }
        const parentId = findRalphParent(eventSessionId)
        if (parentId) {
          recordActivity(parentId)
        }
      }
    }

    if (event.type !== 'session.idle') return

    const sessionId = event.properties?.sessionID as string
    if (!sessionId) return

    const parentId = findRalphParent(sessionId)
    if (parentId) {
      recordActivity(parentId)
    }

    const state = ralphService.getActiveState(sessionId)
    if (!state || !state.active) return

    recordActivity(sessionId)

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

  function terminateAll(): void {
    ralphService.terminateAll()
  }

  function clearAllRetryTimeouts(): void {
    for (const [sessionId, timeout] of retryTimeouts.entries()) {
      clearTimeout(timeout)
      retryTimeouts.delete(sessionId)
    }
    for (const [sessionId, interval] of stallWatchdogs.entries()) {
      clearInterval(interval)
      stallWatchdogs.delete(sessionId)
    }
    lastActivityTime.clear()
    consecutiveStalls.clear()
    childSessions.clear()
    logger.log('Ralph: cleared all retry timeouts')
  }

  return {
    onEvent,
    terminateAll,
    clearAllRetryTimeouts,
    startWatchdog,
    getStallInfo,
  }
}
