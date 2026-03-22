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
  cancelBySessionId(sessionId: string): Promise<boolean>
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
    const children = childSessions.get(sessionId)
    if (children) {
      await Promise.all(
        Array.from(children).map(async (childId) => {
          try {
            await v2Client.session.abort({ sessionID: childId })
          } catch {
            // Child session may already be idle
          }
        })
      )
    }

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

    try {
      await v2Client.session.abort({ sessionID: sessionId })
    } catch {
      // Session may already be idle
    }

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
    const currentState = ralphService.getActiveState(sessionId)
    if (!currentState?.active) {
      logger.log(`Ralph: loop ${sessionId} already terminated, ignoring error: ${context}`)
      return
    }

    const nextErrorCount = (currentState.errorCount ?? 0) + 1
    
    if (nextErrorCount < MAX_RETRIES) {
      logger.error(`Ralph: ${context} (attempt ${nextErrorCount}/${MAX_RETRIES}), will retry`, err)
      ralphService.setState(sessionId, { ...currentState, errorCount: nextErrorCount })
      if (retryFn) {
        const retryTimeout = setTimeout(async () => {
          const freshState = ralphService.getActiveState(sessionId)
          if (!freshState?.active) {
            logger.log(`Ralph: loop cancelled, skipping retry`)
            retryTimeouts.delete(sessionId)
            return
          }
          try {
            await retryFn()
          } catch (retryErr) {
            await handlePromptError(sessionId, freshState, context, retryErr, retryFn)
          }
        }, 2000)
        retryTimeouts.set(sessionId, retryTimeout)
      }
    } else {
      logger.error(`Ralph: ${context} (attempt ${nextErrorCount}/${MAX_RETRIES}), giving up`, err)
      await terminateLoop(sessionId, currentState, `error_max_retries: ${context}`)
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
    let currentState = ralphService.getActiveState(sessionId)
    if (!currentState?.active) {
      logger.log(`Ralph: loop ${sessionId} no longer active, skipping coding phase`)
      return
    }

    if (currentState.completionPromise) {
      const textContent = await getLastAssistantText(sessionId, currentState.worktreeDir)
      if (textContent && ralphService.checkCompletionPromise(textContent, currentState.completionPromise)) {
        const currentAuditCount = currentState.auditCount ?? 0
        if (!currentState.audit || currentAuditCount >= minAudits) {
          await terminateLoop(sessionId, currentState, 'completed')
          logger.log(`Ralph loop completed: detected <promise>${currentState.completionPromise}</promise> at iteration ${currentState.iteration} (${currentAuditCount}/${minAudits} audits)`)
          return
        }
        logger.log(`Ralph: completion promise detected but only ${currentAuditCount}/${minAudits} audits performed, continuing`)
      }
    }

    if (currentState.maxIterations > 0 && currentState.iteration >= currentState.maxIterations) {
      await terminateLoop(sessionId, currentState, 'max_iterations')
      return
    }

    if (currentState.audit) {
      ralphService.setState(sessionId, { ...currentState, phase: 'auditing', errorCount: 0 })
      logger.log(`Ralph iteration ${currentState.iteration} complete, running auditor for session ${sessionId}`)

      const auditPrompt = {
        sessionID: sessionId,
        directory: currentState.worktreeDir,
        parts: [{
          type: 'subtask' as const,
          agent: 'auditor',
          description: `Post-iteration ${currentState.iteration} code review`,
          prompt: ralphService.buildAuditPrompt(currentState),
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
        await handlePromptError(sessionId, { ...currentState, phase: 'coding' }, 'failed to send audit prompt', promptResult.error, retryFn)
        return
      }
      
      const currentConfig = getConfig()
      const configuredModel = currentConfig.auditorModel ?? currentConfig.ralph?.model ?? currentConfig.executionModel
      logger.log(`auditor using agent-configured model: ${configuredModel ?? 'default'}`)
      
      consecutiveStalls.set(sessionId, 0)
      return
    }

    const nextIteration = currentState.iteration + 1
    ralphService.setState(sessionId, { ...currentState, iteration: nextIteration, errorCount: 0 })

    const continuationPrompt = ralphService.buildContinuationPrompt({ ...currentState, iteration: nextIteration })
    logger.log(`Ralph iteration ${nextIteration} for session ${sessionId}`)

    const currentConfig = getConfig()
    const ralphModel = parseModelString(currentConfig.ralph?.model) ?? parseModelString(currentConfig.executionModel)

    const sendContinuationPromptWithModel = async () => {
      const freshState = ralphService.getActiveState(sessionId)
      if (!freshState?.active) {
        throw new Error('loop_cancelled')
      }
      const result = await v2Client.session.promptAsync({
        sessionID: sessionId,
        directory: freshState.worktreeDir,
        parts: [{ type: 'text' as const, text: continuationPrompt }],
        model: ralphModel!,
      })
      return { data: result.data, error: result.error }
    }
    
    const sendContinuationPromptWithoutModel = async () => {
      const freshState = ralphService.getActiveState(sessionId)
      if (!freshState?.active) {
        throw new Error('loop_cancelled')
      }
      const result = await v2Client.session.promptAsync({
        sessionID: sessionId,
        directory: freshState.worktreeDir,
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
      await handlePromptError(sessionId, currentState, 'failed to send continuation prompt', promptResult.error, retryFn)
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
    // Re-fetch and validate state to catch aborts that happened during idle event processing
    const currentState = ralphService.getActiveState(sessionId)
    if (!currentState?.active) {
      logger.log(`Ralph: loop ${sessionId} no longer active, skipping auditing phase`)
      return
    }

    const auditText = await getLastAssistantText(sessionId, currentState.worktreeDir)

    const nextIteration = currentState.iteration + 1
    const newAuditCount = (currentState.auditCount ?? 0) + 1
    logger.log(`Ralph audit ${newAuditCount} at iteration ${currentState.iteration}`)

    // Always pass the full audit response to the code agent
    const auditFindings = auditText ?? undefined

    if (currentState.completionPromise && auditText) {
      if (ralphService.checkCompletionPromise(auditText, currentState.completionPromise)) {
        // Check if minimum audits have been performed
        if (!currentState.audit || newAuditCount >= minAudits) {
          await terminateLoop(sessionId, currentState, 'completed')
          logger.log(`Ralph loop completed: detected <promise>${currentState.completionPromise}</promise> in audit at iteration ${currentState.iteration} (${newAuditCount}/${minAudits} audits)`)
          return
        }
        logger.log(`Ralph: completion promise detected but only ${newAuditCount}/${minAudits} audits performed, continuing`)
      }
    }

    if (currentState.maxIterations > 0 && nextIteration > currentState.maxIterations) {
      await terminateLoop(sessionId, currentState, 'max_iterations')
      return
    }

    ralphService.setState(sessionId, {
      ...currentState,
      iteration: nextIteration,
      phase: 'coding',
      lastAuditResult: auditFindings,
      auditCount: newAuditCount,
      errorCount: 0,
    })

    const continuationPrompt = ralphService.buildContinuationPrompt(
      { ...currentState, iteration: nextIteration },
      auditFindings,
    )
    logger.log(`Ralph iteration ${nextIteration} for session ${sessionId}`)

    const currentConfig = getConfig()
    const ralphModel = parseModelString(currentConfig.ralph?.model) ?? parseModelString(currentConfig.executionModel)

    const sendContinuationPromptWithModel = async () => {
      const freshState = ralphService.getActiveState(sessionId)
      if (!freshState?.active) {
        throw new Error('loop_cancelled')
      }
      const result = await v2Client.session.promptAsync({
        sessionID: sessionId,
        directory: freshState.worktreeDir,
        parts: [{ type: 'text' as const, text: continuationPrompt }],
        model: ralphModel!,
      })
      return { data: result.data, error: result.error }
    }
    
    const sendContinuationPromptWithoutModel = async () => {
      const freshState = ralphService.getActiveState(sessionId)
      if (!freshState?.active) {
        throw new Error('loop_cancelled')
      }
      const result = await v2Client.session.promptAsync({
        sessionID: sessionId,
        directory: freshState.worktreeDir,
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
        const freshState = ralphService.getActiveState(sessionId)
        if (!freshState?.active) {
          throw new Error('loop_cancelled')
        }
        const result = await sendContinuationPromptWithoutModel()
        if (result.error) {
          throw result.error
        }
      }
      await handlePromptError(sessionId, currentState, 'failed to send continuation prompt after audit', promptResult.error, retryFn)
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

    if (event.type === 'session.error') {
      const errorProps = event.properties as { sessionID?: string; error?: { name?: string } }
      const eventSessionId = errorProps?.sessionID
      const errorName = errorProps?.error?.name
      const isAbort = errorName === 'MessageAbortedError' || errorName === 'AbortError'

      if (!eventSessionId || !isAbort) return

      const state = ralphService.getActiveState(eventSessionId)
      if (state?.active) {
        logger.log(`Ralph: session ${eventSessionId} aborted, terminating loop`)
        await terminateLoop(eventSessionId, state, 'user_aborted')
      }

      const parentId = findRalphParent(eventSessionId)
      if (parentId) {
        const parentState = ralphService.getActiveState(parentId)
        if (parentState?.active) {
          logger.log(`Ralph: child session abort detected, terminating parent loop ${parentId}`)
          await terminateLoop(parentId, parentState, 'user_aborted')
        }
      }

      const childLoops = ralphService.findByParentSessionId(eventSessionId)
      for (const childLoop of childLoops) {
        logger.log(`Ralph: launcher session ${eventSessionId} aborted, terminating child loop ${childLoop.sessionId}`)
        await terminateLoop(childLoop.sessionId, childLoop, 'user_aborted')
      }
      return
    }

    if (event.type !== 'session.idle') return

    const sessionId = event.properties?.sessionID as string
    if (!sessionId) return

    const state = ralphService.getActiveState(sessionId)
    if (!state || !state.active) return

    const parentId = findRalphParent(sessionId)
    if (parentId) {
      recordActivity(parentId)
    }

    recordActivity(sessionId)

    try {
      // Re-check state right before calling phase handler as extra safety
      const freshState = ralphService.getActiveState(sessionId)
      if (!freshState?.active) {
        logger.log(`Ralph: loop ${sessionId} was terminated, skipping phase handler`)
        return
      }
      
      if (freshState.phase === 'auditing') {
        await handleAuditingPhase(sessionId, freshState)
      } else {
        await handleCodingPhase(sessionId, freshState)
      }
    } catch (err) {
      const freshState = ralphService.getActiveState(sessionId)
      await handlePromptError(sessionId, freshState ?? state, `unhandled error in ${(freshState ?? state).phase} phase`, err)
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

  async function cancelBySessionId(sessionId: string): Promise<boolean> {
    const state = ralphService.getActiveState(sessionId)
    if (!state?.active) {
      return false
    }
    await terminateLoop(sessionId, state, 'cancelled')
    return true
  }

  return {
    onEvent,
    terminateAll,
    clearAllRetryTimeouts,
    startWatchdog,
    getStallInfo,
    cancelBySessionId,
  }
}
