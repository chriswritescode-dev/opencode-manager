import { tool } from '@opencode-ai/plugin'
import { execSync, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import type { ToolContext } from './types'
import { withDimensionWarning } from './types'
import { parseModelString, retryWithModelFallback } from '../utils/model-fallback'
import { slugify } from '../utils/logger'
import { findPartialMatch } from '../utils/partial-match'
import { formatSessionOutput, formatAuditResult } from '../utils/loop-format'
import { fetchSessionOutput, MAX_RETRIES, type LoopState, type LoopSessionOutput } from '../services/loop'

const z = tool.schema
const DEFAULT_PLAN_COMPLETION_PROMISE = 'ALL_PHASES_COMPLETE'

interface LoopSetupOptions {
  prompt: string
  sessionTitle: string
  worktreeName?: string
  completionPromise: string | null
  maxIterations: number
  audit: boolean
  agent?: string
  model?: { providerID: string; modelID: string }
  worktree?: boolean
  onLoopStarted?: (worktreeName: string) => void
}

async function setupLoop(
  ctx: ToolContext,
  options: LoopSetupOptions,
): Promise<string> {
  const { v2, directory, config, loopService, loopHandler, logger } = ctx
  const autoWorktreeName = options.worktreeName ?? `loop-${slugify(options.sessionTitle.replace(/^Loop:\s*/i, ''))}`
  const projectDir = directory
  const maxIter = options.maxIterations ?? config.loop?.defaultMaxIterations ?? 0

  interface LoopContext {
    sessionId: string
    directory: string
    branch?: string
    worktree: boolean
  }

  let loopContext: LoopContext

  if (!options.worktree) {
    let currentBranch: string | undefined
    try {
      currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim()
    } catch (err) {
      logger.log(`loop: no git branch detected, running without branch info`)
    }

    const createResult = await v2.session.create({
      title: options.sessionTitle,
      directory: projectDir,
    })

    if (createResult.error || !createResult.data) {
      logger.error(`loop: failed to create session`, createResult.error)
      return 'Failed to create loop session.'
    }

    loopContext = {
      sessionId: createResult.data.id,
      directory: projectDir,
      branch: currentBranch,
      worktree: false,
    }
  } else {
    const worktreeResult = await v2.worktree.create({
      worktreeCreateInput: { name: autoWorktreeName },
    })

    if (worktreeResult.error || !worktreeResult.data) {
      logger.error(`loop: failed to create worktree`, worktreeResult.error)
      return 'Failed to create worktree.'
    }

    const worktreeInfo = worktreeResult.data
    logger.log(`loop: worktree created at ${worktreeInfo.directory} (branch: ${worktreeInfo.branch})`)

    const createResult = await v2.session.create({
      title: options.sessionTitle,
      directory: worktreeInfo.directory,
    })

    if (createResult.error || !createResult.data) {
      logger.error(`loop: failed to create session`, createResult.error)
      try {
        await v2.worktree.remove({ worktreeRemoveInput: { directory: worktreeInfo.directory } })
      } catch (cleanupErr) {
        logger.error(`loop: failed to cleanup worktree`, cleanupErr)
      }
      return 'Failed to create loop session.'
    }

    loopContext = {
      sessionId: createResult.data.id,
      directory: worktreeInfo.directory,
      branch: worktreeInfo.branch,
      worktree: true,
    }
  }

  const state: LoopState = {
    active: true,
    sessionId: loopContext.sessionId,
    worktreeName: autoWorktreeName,
    worktreeDir: loopContext.directory,
    worktreeBranch: loopContext.branch,
    iteration: 1,
    maxIterations: maxIter,
    completionPromise: options.completionPromise,
    startedAt: new Date().toISOString(),
    prompt: options.prompt,
    phase: 'coding',
    audit: options.audit,
    errorCount: 0,
    auditCount: 0,
    worktree: options.worktree,
  }

  loopService.setState(autoWorktreeName, state)
  loopService.registerSession(loopContext.sessionId, autoWorktreeName)
  logger.log(`loop: state stored for worktree=${autoWorktreeName}`)

  let promptText = options.prompt
  if (options.completionPromise) {
    promptText += `\n\n---\n\n**IMPORTANT - Completion Signal:** When you have completed ALL phases of this plan successfully, you MUST output the following tag exactly: <promise>${options.completionPromise}</promise>\n\nDo NOT output this tag until every phase is truly complete. The loop will continue until this signal is detected.`
  }

  const { result: promptResult, usedModel: actualModel } = await retryWithModelFallback(
    () => v2.session.promptAsync({
      sessionID: loopContext.sessionId,
      directory: loopContext.directory,
      parts: [{ type: 'text' as const, text: promptText }],
      ...(options.agent && { agent: options.agent }),
      model: options.model!,
    }),
    () => v2.session.promptAsync({
      sessionID: loopContext.sessionId,
      directory: loopContext.directory,
      parts: [{ type: 'text' as const, text: promptText }],
      ...(options.agent && { agent: options.agent }),
    }),
    options.model,
    logger,
  )

  if (promptResult.error) {
    logger.error(`loop: failed to send prompt`, promptResult.error)
    loopService.deleteState(autoWorktreeName)
    if (options.worktree) {
      try {
        await v2.worktree.remove({ worktreeRemoveInput: { directory: loopContext.directory } })
      } catch (cleanupErr) {
        logger.error(`loop: failed to cleanup worktree`, cleanupErr)
      }
    }
    return !options.worktree
      ? 'Loop session created but failed to send prompt.'
      : 'Loop session created but failed to send prompt. Cleaned up.'
  }

  options.onLoopStarted?.(autoWorktreeName)

  if (!options.worktree) {
    v2.tui.selectSession({ sessionID: loopContext.sessionId }).catch((err) => {
      logger.error('loop: failed to navigate TUI to new session', err)
    })
  }

  const maxInfo = maxIter > 0 ? maxIter.toString() : 'unlimited'
  const auditInfo = options.audit ? 'enabled' : 'disabled'
  const modelInfo = actualModel ? `${actualModel.providerID}/${actualModel.modelID}` : 'default'

  const lines: string[] = [
    !options.worktree ? 'Memory loop activated! (in-place mode)' : 'Memory loop activated!',
    '',
    `Session: ${loopContext.sessionId}`,
    `Title: ${options.sessionTitle}`,
  ]

  if (!options.worktree) {
    lines.push(`Directory: ${loopContext.directory}`)
    if (loopContext.branch) {
      lines.push(`Branch: ${loopContext.branch} (in-place)`)
    }
  } else {
    lines.push(`Worktree name: ${autoWorktreeName}`)
    lines.push(`Worktree: ${loopContext.directory}`)
    lines.push(`Branch: ${loopContext.branch}`)
  }

  lines.push(
    `Model: ${modelInfo}`,
    `Max iterations: ${maxInfo}`,
    `Completion promise: ${options.completionPromise ?? 'none'}`,
    `Audit: ${auditInfo}`,
    '',
    'The loop will automatically continue when the session goes idle.',
    'Your job is done — just confirm to the user that the loop has been launched.',
    'The user can run memory-loop-status or memory-loop-cancel later if needed.',
  )

  return lines.join('\n')
}

export function createLoopTools(ctx: ToolContext): Record<string, ReturnType<typeof tool>> {
  const { v2, loopService, loopHandler, config, directory, logger } = ctx

  return {
    'memory-loop': tool({
      description: 'Execute a plan using an iterative development loop. Default runs in current directory. Set worktree to true for isolated git worktree.',
      args: {
        plan: z.string().describe('The full implementation plan to send to the Code agent'),
        title: z.string().describe('Short title for the session (shown in session list)'),
        worktree: z.boolean().optional().default(false).describe('Run in isolated git worktree instead of current directory'),
      },
      execute: async (args, context) => {
        if (config.loop?.enabled === false) {
          return 'Loops are disabled in plugin config. Use memory-plan-execute instead.'
        }

        logger.log(`memory-loop: creating worktree for plan="${args.title}"`)

        const sessionTitle = args.title.length > 60 ? `${args.title.substring(0, 57)}...` : args.title
        const loopModel = parseModelString(config.loop?.model) ?? parseModelString(config.executionModel)
        const audit = config.loop?.defaultAudit ?? true

        return setupLoop(ctx, {
          prompt: args.plan,
          sessionTitle: `Loop: ${sessionTitle}`,
          completionPromise: DEFAULT_PLAN_COMPLETION_PROMISE,
          maxIterations: config.loop?.defaultMaxIterations ?? 0,
          audit: audit,
          agent: 'code',
          model: loopModel,
          worktree: args.worktree,
          onLoopStarted: (id) => loopHandler.startWatchdog(id),
        })
      },
    }),

    'memory-loop-cancel': tool({
      description: 'Cancel an active memory loop and optionally clean up the worktree.',
      args: {
        name: z.string().optional().describe('Worktree name of the memory loop to cancel'),
      },
      execute: async (args) => {
        let state: LoopState | null = null

        if (args.name) {
          const name = args.name
          state = loopService.findByWorktreeName(name)
          if (!state) {
            const candidates = loopService.findCandidatesByPartialName(name)
            if (candidates.length > 0) {
              return `Multiple loops match "${name}":\n${candidates.map((s) => `- ${s.worktreeName}`).join('\n')}\n\nBe more specific.`
            }
            const recent = loopService.listRecent()
            const foundRecent = recent.find((s) => s.worktreeName === name || (s.worktreeBranch && s.worktreeBranch.toLowerCase().includes(name.toLowerCase())))
            if (foundRecent) {
              return `Memory loop "${foundRecent.worktreeName}" has already completed.`
            }
            return `No active memory loop found for worktree "${name}".`
          }
          if (!state.active) {
            return `Memory loop "${state.worktreeName}" has already completed.`
          }
        } else {
          const active = loopService.listActive()
          if (active.length === 0) return 'No active memory loops.'
          if (active.length === 1) {
            state = active[0]
          } else {
            return `Multiple active memory loops. Specify a name:\n${active.map((s) => `- ${s.worktreeName} (iteration ${s.iteration})`).join('\n')}`
          }
        }

        await loopHandler.cancelBySessionId(state.sessionId)
        logger.log(`memory-loop-cancel: cancelled loop for session=${state.sessionId} at iteration ${state.iteration}`)

        if (config.loop?.cleanupWorktree && state.worktree && state.worktreeDir) {
          try {
            const gitCommonDir = execSync('git rev-parse --git-common-dir', { cwd: state.worktreeDir, encoding: 'utf-8' }).trim()
            const gitRoot = resolve(state.worktreeDir, gitCommonDir, '..')
            const removeResult = spawnSync('git', ['worktree', 'remove', '-f', state.worktreeDir], { cwd: gitRoot, encoding: 'utf-8' })
            if (removeResult.status !== 0) {
              throw new Error(removeResult.stderr || 'git worktree remove failed')
            }
            logger.log(`memory-loop-cancel: removed worktree ${state.worktreeDir}`)
          } catch (err) {
            logger.error(`memory-loop-cancel: failed to remove worktree`, err)
          }
        }

        const modeInfo = !state.worktree ? ' (in-place)' : ''
        const branchInfo = state.worktreeBranch ? `\nBranch: ${state.worktreeBranch}` : ''
        return `Cancelled memory loop "${state.worktreeName}"${modeInfo} (was at iteration ${state.iteration}).\nDirectory: ${state.worktreeDir}${branchInfo}`
      },
    }),

    'memory-loop-status': tool({
      description: 'Check the status of memory loops. With no arguments, lists all active loops for the current project. Pass a worktree name for detailed status of a specific loop. Use restart to resume an inactive loop.',
      args: {
        name: z.string().optional().describe('Worktree name to check for detailed status'),
        restart: z.boolean().optional().describe('Restart an inactive loop by name'),
      },
      execute: async (args) => {
        const active = loopService.listActive()

        if (args.restart) {
          if (!args.name) {
            return 'Specify a loop name to restart. Use memory-loop-status to see available loops.'
          }

          const recent = loopService.listRecent()
          const allStates = [...active, ...recent]
          const { match: stoppedState, candidates } = findPartialMatch(args.name, allStates, (s) => [s.worktreeName, s.worktreeBranch])
          if (!stoppedState && candidates.length > 0) {
            return `Multiple loops match "${args.name}":\n${candidates.map((s) => `- ${s.worktreeName}`).join('\n')}\n\nBe more specific.`
          }
          if (!stoppedState) {
            const available = [...active, ...recent].map((s) => `- ${s.worktreeName}`).join('\n')
            return `No memory loop found for "${args.name}".\n\nAvailable loops:\n${available}`
          }

          if (stoppedState.active) {
            return `Loop "${stoppedState.worktreeName}" is already active. Nothing to restart.`
          }

          if (stoppedState.terminationReason === 'completed') {
            return `Loop "${stoppedState.worktreeName}" completed successfully and cannot be restarted.`
          }

          if (!stoppedState.worktree && stoppedState.worktreeDir) {
            if (!existsSync(stoppedState.worktreeDir)) {
              return `Cannot restart "${stoppedState.worktreeName}": worktree directory no longer exists at ${stoppedState.worktreeDir}. The worktree may have been cleaned up.`
            }
          }

          const createParams = {
            title: stoppedState.worktreeName!,
            directory: stoppedState.worktreeDir!,
          }

          const createResult = await v2.session.create(createParams)

          if (createResult.error || !createResult.data) {
            logger.error(`memory-loop-restart: failed to create session`, createResult.error)
            return `Failed to create new session for restart.`
          }

          const newSessionId = createResult.data.id

          loopService.deleteState(stoppedState.worktreeName!)

          const newState: LoopState = {
            active: true,
            sessionId: newSessionId,
            worktreeName: stoppedState.worktreeName!,
            worktreeDir: stoppedState.worktreeDir!,
            worktreeBranch: stoppedState.worktreeBranch,
            iteration: stoppedState.iteration!,
            maxIterations: stoppedState.maxIterations!,
            completionPromise: stoppedState.completionPromise,
            startedAt: new Date().toISOString(),
            prompt: stoppedState.prompt,
            phase: 'coding',
            audit: stoppedState.audit,
            errorCount: 0,
            auditCount: 0,
            worktree: stoppedState.worktree,
          }

          loopService.setState(stoppedState.worktreeName!, newState)
          loopService.registerSession(newSessionId, stoppedState.worktreeName!)

          let promptText = stoppedState.prompt ?? ''
          if (stoppedState.completionPromise) {
            promptText += `\n\n---\n\n**IMPORTANT - Completion Signal:** When you have completed ALL phases of this plan successfully, you MUST output the following tag exactly: <promise>${stoppedState.completionPromise}</promise>\n\nDo NOT output this tag until every phase is truly complete. The loop will continue until this signal is detected.`
          }

          const loopModel = parseModelString(config.loop?.model) ?? parseModelString(config.executionModel)

          const { result: promptResult } = await retryWithModelFallback(
            () => v2.session.promptAsync({
              sessionID: newSessionId,
              directory: stoppedState.worktreeDir!,
              parts: [{ type: 'text' as const, text: promptText }],
              agent: 'code',
              model: loopModel!,
            }),
            () => v2.session.promptAsync({
              sessionID: newSessionId,
              directory: stoppedState.worktreeDir!,
              parts: [{ type: 'text' as const, text: promptText }],
              agent: 'code',
            }),
            loopModel,
            logger,
          )

          if (promptResult.error) {
            logger.error(`memory-loop-restart: failed to send prompt`, promptResult.error)
            loopService.deleteState(stoppedState.worktreeName!)
            return `Restart failed: could not send prompt to new session.`
          }

          loopHandler.startWatchdog(stoppedState.worktreeName!)

          const modeInfo = !stoppedState.worktree ? ' (in-place)' : ''
          const branchInfo = stoppedState.worktreeBranch ? `\nBranch: ${stoppedState.worktreeBranch}` : ''
          return [
            `Restarted memory loop "${stoppedState.worktreeName}"${modeInfo}`,
            '',
            `New session: ${newSessionId}`,
            `Continuing from iteration: ${stoppedState.iteration}`,
            `Previous termination: ${stoppedState.terminationReason}`,
            `Directory: ${stoppedState.worktreeDir}${branchInfo}`,
            `Audit: ${stoppedState.audit ? 'enabled' : 'disabled'}`,
          ].join('\n')
        }

        if (!args.name) {
          const recent = loopService.listRecent()

          if (active.length === 0) {
            if (recent.length === 0) return 'No memory loops found.'

            const lines: string[] = ['Recently Completed Memory Loops', '']
            recent.forEach((s, i) => {
              const duration = s.completedAt && s.startedAt
                ? Math.round((new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)
                : 0
              const minutes = Math.floor(duration / 60)
              const seconds = duration % 60
              const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
              lines.push(`${i + 1}. ${s.worktreeName}`)
              lines.push(`   Reason: ${s.terminationReason ?? 'unknown'} | Iterations: ${s.iteration} | Duration: ${durationStr} | Completed: ${s.completedAt ?? 'unknown'}`)
              lines.push('')
            })
            lines.push('Use memory-loop-status <name> for detailed info.')
            return lines.join('\n')
          }

          let statuses: Record<string, { type: string; attempt?: number; message?: string; next?: number }> = {}
          try {
            const uniqueDirs = [...new Set(active.map((s) => s.worktreeDir).filter(Boolean))]
            const results = await Promise.allSettled(
              uniqueDirs.map((dir) => v2.session.status({ directory: dir })),
            )
            for (const result of results) {
              if (result.status === 'fulfilled' && result.value.data) {
                Object.assign(statuses, result.value.data)
              }
            }
          } catch {
          }

          const lines: string[] = [`Active Memory Loops (${active.length})`, '']
          active.forEach((s, i) => {
            const elapsed = s.startedAt ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000) : 0
            const minutes = Math.floor(elapsed / 60)
            const seconds = elapsed % 60
            const duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
            const iterInfo = s.maxIterations && s.maxIterations > 0 ? `${s.iteration} / ${s.maxIterations}` : `${s.iteration} (unlimited)`
            const sessionStatus = statuses[s.sessionId]?.type ?? 'unavailable'
            const modeIndicator = !s.worktree ? ' (in-place)' : ''
            const stallInfo = loopHandler.getStallInfo(s.worktreeName)
            const stallCount = stallInfo?.consecutiveStalls ?? 0
            const stallSuffix = stallCount > 0 ? ` | Stalls: ${stallCount}` : ''
            lines.push(`${i + 1}. ${s.worktreeName}${modeIndicator}`)
            lines.push(`   Phase: ${s.phase} | Iteration: ${iterInfo} | Duration: ${duration} | Status: ${sessionStatus}${stallSuffix}`)
            lines.push('')
          })

          if (recent.length > 0) {
            lines.push('Recently Completed:')
            lines.push('')
            const limitedRecent = recent.slice(0, 10)
            limitedRecent.forEach((s, i) => {
              const duration = s.completedAt && s.startedAt
                ? Math.round((new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)
                : 0
              const minutes = Math.floor(duration / 60)
              const seconds = duration % 60
              const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
              lines.push(`${i + 1}. ${s.worktreeName}`)
              lines.push(`   Reason: ${s.terminationReason ?? 'unknown'} | Iterations: ${s.iteration} | Duration: ${durationStr} | Completed: ${s.completedAt ?? 'unknown'}`)
              lines.push('')
            })
            if (recent.length > 10) {
              lines.push(`   ... and ${recent.length - 10} more. Use memory-loop-status <name> for details.`)
              lines.push('')
            }
          }

          lines.push('Use memory-loop-status <name> for detailed info, or memory-loop-cancel <name> to stop a loop.')
          return lines.join('\n')
        }

        const state = loopService.findByWorktreeName(args.name)
        if (!state) {
          const candidates = loopService.findCandidatesByPartialName(args.name)
          if (candidates.length > 0) {
            return `Multiple loops match "${args.name}":\n${candidates.map((s) => `- ${s.worktreeName}`).join('\n')}\n\nBe more specific.`
          }
          return `No loop found for worktree "${args.name}".`
        }

        if (!state.active) {
          const maxInfo = state.maxIterations && state.maxIterations > 0 ? `${state.iteration} / ${state.maxIterations}` : `${state.iteration} (unlimited)`
          const duration = state.completedAt && state.startedAt
            ? Math.round((new Date(state.completedAt).getTime() - new Date(state.startedAt).getTime()) / 1000)
            : 0
          const minutes = Math.floor(duration / 60)
          const seconds = duration % 60
          const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`

          const statusLines: string[] = [
            'Loop Status (Inactive)',
            '',
            `Name: ${state.worktreeName}`,
            `Session: ${state.sessionId}`,
          ]
          if (!state.worktree) {
            statusLines.push(`Mode: in-place | Directory: ${state.worktreeDir}`)
          } else {
            statusLines.push(`Worktree: ${state.worktreeDir}`)
          }
          statusLines.push(
            `Iteration: ${maxInfo}`,
            `Duration: ${durationStr}`,
            `Reason: ${state.terminationReason ?? 'unknown'}`,
          )
          if (state.worktreeBranch) {
            statusLines.push(`Branch: ${state.worktreeBranch}`)
          }
          statusLines.push(
            `Started: ${state.startedAt}`,
            ...(state.completedAt ? [`Completed: ${state.completedAt}`] : []),
          )

          if (state.lastAuditResult) {
            statusLines.push(...formatAuditResult(state.lastAuditResult))
          }

          const sessionOutput = state.worktreeDir ? await fetchSessionOutput(v2, state.sessionId, state.worktreeDir, logger) : null
          if (sessionOutput) {
            statusLines.push('')
            statusLines.push('Session Output:')
            statusLines.push(...formatSessionOutput(sessionOutput))
          }

          return statusLines.join('\n')
        }

        const maxInfo = state.maxIterations && state.maxIterations > 0 ? `${state.iteration} / ${state.maxIterations}` : `${state.iteration} (unlimited)`
        const promptPreview = state.prompt && state.prompt.length > 100 ? `${state.prompt.substring(0, 97)}...` : (state.prompt ?? '')

        let sessionStatus = 'unknown'
        try {
          const statusResult = await v2.session.status({ directory: state.worktreeDir })
          const statuses = statusResult.data as Record<string, { type: string; attempt?: number; message?: string; next?: number }> | undefined
          const status = statuses?.[state.sessionId]
          if (status) {
            sessionStatus = status.type === 'retry'
              ? `retry (attempt ${status.attempt}, next in ${Math.round(((status.next ?? 0) - Date.now()) / 1000)}s)`
              : status.type
          }
        } catch {
          sessionStatus = 'unavailable'
        }

        const elapsed = state.startedAt ? Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000) : 0
        const minutes = Math.floor(elapsed / 60)
        const seconds = elapsed % 60
        const duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`

        const stallInfo = loopHandler.getStallInfo(state.worktreeName)
        const secondsSinceActivity = stallInfo
          ? Math.round((Date.now() - stallInfo.lastActivityTime) / 1000)
          : null
        const stallCount = stallInfo?.consecutiveStalls ?? 0

        const statusLines: string[] = [
          'Loop Status',
          '',
          `Name: ${state.worktreeName}`,
          `Session: ${state.sessionId}`,
        ]
        if (!state.worktree) {
          statusLines.push(`Mode: in-place | Directory: ${state.worktreeDir}`)
        } else {
          statusLines.push(`Worktree: ${state.worktreeDir}`)
        }
        statusLines.push(
          `Status: ${sessionStatus}`,
          `Phase: ${state.phase}`,
          `Iteration: ${maxInfo}`,
          `Duration: ${duration}`,
          `Audit: ${state.audit ? 'enabled' : 'disabled'}`,
        )
        if (state.worktreeBranch) {
          statusLines.push(`Branch: ${state.worktreeBranch}`)
        }

        let sessionOutput: LoopSessionOutput | null = null
        if (state.worktreeDir) {
          try {
            sessionOutput = await fetchSessionOutput(v2, state.sessionId, state.worktreeDir, logger)
          } catch {
            // Silently ignore fetch errors to avoid cluttering output
          }
        }
        if (sessionOutput) {
          statusLines.push('')
          statusLines.push('Session Output:')
          statusLines.push(...formatSessionOutput(sessionOutput))
        }

        if (state.lastAuditResult) {
          statusLines.push(...formatAuditResult(state.lastAuditResult))
        }

        statusLines.push(
          '',
          `Completion promise: ${state.completionPromise ?? 'none'}`,
          `Started: ${state.startedAt}`,
          ...(state.errorCount && state.errorCount > 0 ? [`Error count: ${state.errorCount} (retries before termination: ${MAX_RETRIES})`] : []),
          `Audit count: ${state.auditCount ?? 0}`,
          `Model: ${config.loop?.model || config.executionModel || 'default'}`,
          `Auditor model: ${config.auditorModel || 'default'}`,
          ...(stallCount > 0 ? [`Stalls: ${stallCount}`] : []),
          ...(secondsSinceActivity !== null ? [`Last activity: ${secondsSinceActivity}s ago`] : []),
          '',
          `Prompt: ${promptPreview}`,
        )

        return statusLines.join('\n')
      },
    }),
  }
}
