import type { Plugin, PluginInput, Hooks } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import { createOpencodeClient as createV2Client } from '@opencode-ai/sdk/v2'
import { agents } from './agents'
import { createConfigHandler } from './config'
import { VERSION } from './version'
import { createSessionHooks, createMemoryInjectionHook, createRalphEventHandler } from './hooks'
import { join, resolve } from 'path'
import { initializeDatabase, resolveDataDir, closeDatabase, createMetadataQuery } from './storage'
import type { MemoryService } from './services/memory'
import { createVecService } from './storage/vec'
import { createEmbeddingProvider, checkServerHealth, isServerRunning, killEmbeddingServer } from './embedding'
import { createMemoryService } from './services/memory'
import { createEmbeddingSyncService } from './services/embedding-sync'
import { createKvService } from './services/kv'
import { createRalphService, type RalphState, fetchSessionOutput, type RalphSessionOutput } from './services/ralph'
import { findPartialMatch } from './utils/partial-match'
import { loadPluginConfig } from './setup'
import { resolveLogPath } from './storage'
import { createLogger, slugify } from './utils/logger'
import { stripPromiseTags } from './utils/strip-promise-tags'
import { truncate } from './cli/utils'
import { formatSessionOutput, formatAuditResult } from './utils/ralph-format'
import type { Database } from 'bun:sqlite'
import type { PluginConfig, CompactionConfig, HealthStatus, Logger } from './types'
import type { EmbeddingProvider } from './embedding'
import type { VecService } from './storage/vec-types'
import { createNoopVecService } from './storage/vec'
import { checkForUpdate, formatUpgradeCheck, performUpgrade } from './utils/upgrade'
import { MAX_RETRIES } from './services/ralph'
import { parseModelString, retryWithModelFallback } from './utils/model-fallback'
import { execSync, spawnSync } from 'child_process'
import { existsSync } from 'fs'

const z = tool.schema

const DEFAULT_PLAN_COMPLETION_PROMISE = 'All phases of the plan have been completed successfully'

async function getHealthStatus(
  projectId: string,
  db: Database,
  config: PluginConfig,
  provider: EmbeddingProvider,
  dataDir: string,
): Promise<HealthStatus> {
  const socketPath = join(dataDir, 'embedding.sock')

  let dbStatus: 'ok' | 'error' = 'ok'
  let memoryCount = 0
  try {
    db.prepare('SELECT 1').get()
    const row = db.prepare("SELECT COUNT(*) as count FROM memories WHERE project_id = ?").get(projectId) as { count: number }
    memoryCount = row.count
  } catch {
    dbStatus = 'error'
  }

  let operational = false
  try {
    operational = await provider.test()
  } catch {
    operational = false
  }

  let serverRunning = false
  let serverHealth: { status: string; clients: number; uptime: number } | null = null
  try {
    serverRunning = await isServerRunning(dataDir)
    if (serverRunning) {
      serverHealth = await checkServerHealth(socketPath)
    }
  } catch {
    serverRunning = false
  }

  const configuredModel = {
    model: config.embedding.model,
    dimensions: config.embedding.dimensions ?? provider.dimensions,
  }

  let currentModel: { model: string; dimensions: number } | null = null
  try {
    const metadata = createMetadataQuery(db)
    const stored = metadata.getEmbeddingModel()
    if (stored) {
      currentModel = { model: stored.model, dimensions: stored.dimensions }
    }
  } catch {
    // Ignore
  }

  const needsReindex = !currentModel ||
    currentModel.model !== configuredModel.model ||
    currentModel.dimensions !== configuredModel.dimensions

  const overallStatus: 'ok' | 'degraded' | 'error' = dbStatus === 'error'
    ? 'error'
    : !operational
      ? 'degraded'
      : 'ok'

  return {
    dbStatus,
    memoryCount,
    operational,
    serverRunning,
    serverHealth,
    configuredModel,
    currentModel,
    needsReindex,
    overallStatus,
  }
}

function formatHealthStatus(status: HealthStatus, provider: EmbeddingProvider): string {
  const { dbStatus, memoryCount, operational, serverRunning, serverHealth, configuredModel, currentModel, needsReindex, overallStatus } = status

  const embeddingStatus: 'ok' | 'error' = operational ? 'ok' : 'error'

  const lines: string[] = [
    `Memory Plugin v${VERSION}`,
    `Status: ${overallStatus.toUpperCase()}`,
    '',
    `Embedding: ${embeddingStatus}`,
    `  Provider: ${provider.name} (${provider.dimensions}d)`,
    `  Operational: ${operational}`,
    `  Server running: ${serverRunning}`,
  ]

  if (serverHealth) {
    lines.push(`  Clients: ${serverHealth.clients}, Uptime: ${Math.round(serverHealth.uptime / 1000)}s`)
  }

  lines.push('')
  lines.push(`Database: ${dbStatus}`)
  lines.push(`  Total memories: ${memoryCount}`)
  lines.push('')
  lines.push(`Model: ${needsReindex ? 'drift' : 'ok'}`)
  lines.push(`  Configured: ${configuredModel.model} (${configuredModel.dimensions}d)`)
  if (currentModel) {
    lines.push(`  Indexed: ${currentModel.model} (${currentModel.dimensions}d)`)
  } else {
    lines.push('  Indexed: none')
  }
  if (needsReindex) {
    lines.push('  Reindex required - run memory-health with action "reindex"')
  } else {
    lines.push('  In sync')
  }

  return lines.join('\n')
}

async function executeHealthCheck(
  projectId: string,
  db: Database,
  config: PluginConfig,
  provider: EmbeddingProvider,
  dataDir: string,
): Promise<string> {
  const status = await getHealthStatus(projectId, db, config, provider, dataDir)
  return formatHealthStatus(status, provider)
}

interface DimensionMismatchState {
  detected: boolean
  expected: number | null
  actual: number | null
}

async function executeReindex(
  projectId: string,
  memoryService: MemoryService,
  db: Database,
  config: PluginConfig,
  provider: EmbeddingProvider,
  mismatchState: DimensionMismatchState,
  vec: VecService,
): Promise<string> {
  const configuredModel = config.embedding.model
  const configuredDimensions = config.embedding.dimensions ?? provider.dimensions

  let operational = false
  try {
    operational = await provider.test()
  } catch {
    operational = false
  }

  if (!operational) {
    return 'Reindex failed: embedding provider is not operational. Check your API key and model configuration.'
  }

  const tableInfo = await vec.getDimensions()
  if (tableInfo.exists && tableInfo.dimensions !== null && tableInfo.dimensions !== configuredDimensions) {
    await vec.recreateTable(configuredDimensions)
  }

  const result = await memoryService.reindex(projectId)

  if (result.success > 0 || result.total === 0) {
    const metadata = createMetadataQuery(db)
    metadata.setEmbeddingModel(configuredModel, configuredDimensions)
  }

  if (result.failed === 0) {
    mismatchState.detected = false
    mismatchState.expected = null
    mismatchState.actual = null
  }

  const lines: string[] = [
    'Reindex complete',
    '',
    `Total memories: ${result.total}`,
    `Embedded: ${result.success}`,
    `Failed: ${result.failed}`,
    '',
    `Model: ${configuredModel} (${configuredDimensions}d)`,
  ]

  if (result.failed > 0) {
    lines.push(`WARNING: ${result.failed} memories failed to embed`)
  }

  return lines.join('\n')
}

async function autoValidateOnLoad(
  projectId: string,
  memoryService: MemoryService,
  db: Database,
  config: PluginConfig,
  provider: EmbeddingProvider,
  dataDir: string,
  mismatchState: DimensionMismatchState,
  vec: VecService,
  logger: Logger,
): Promise<void> {
  const status = await getHealthStatus(projectId, db, config, provider, dataDir)

  if (status.overallStatus === 'error') {
    logger.log('Auto-validate: unhealthy (db error), skipping')
    return
  }

  if (!status.needsReindex) {
    logger.log('Auto-validate: healthy, no action needed')
    return
  }

  if (!status.operational) {
    logger.log('Auto-validate: reindex needed but provider not operational, skipping')
    return
  }

  logger.log('Auto-validate: model drift detected, starting reindex')
  await executeReindex(projectId, memoryService, db, config, provider, mismatchState, vec)
  logger.log('Auto-validate: reindex complete')
}

export function createMemoryPlugin(config: PluginConfig): Plugin {
  return async (input: PluginInput): Promise<Hooks> => {
    const { directory, project, client } = input
    const projectId = project.id

    const v2 = createV2Client({ baseUrl: input.serverUrl.toString(), directory })

    const loggingConfig = config.logging
    const logger = createLogger({
      enabled: loggingConfig?.enabled ?? false,
      file: loggingConfig?.file ?? resolveLogPath(),
      debug: loggingConfig?.debug ?? false,
    })
    logger.log(`Initializing plugin for directory: ${directory}, projectId: ${projectId}`)

    const provider = createEmbeddingProvider(config.embedding)
    provider.warmup()

    const dataDir = config.dataDir ?? resolveDataDir()
    
    if (config.embedding.provider !== 'local') {
      killEmbeddingServer(dataDir).catch(() => {})
    }
    
    const db = initializeDatabase(dataDir)
    const dimensions = config.embedding.dimensions ?? provider.dimensions

    const noopVec = createNoopVecService()
    const memoryService = await createMemoryService({
      db,
      provider,
      vec: noopVec,
      logger,
    })

    if (config.dedupThreshold) {
      memoryService.setDedupThreshold(config.dedupThreshold)
    }

    const kvService = createKvService(db, logger, config.defaultKvTtlMs)

    const ralphService = createRalphService(kvService, projectId, logger, config.ralph)
    const ralphHandler = createRalphEventHandler(ralphService, client, v2, logger, () => config)

    const mismatchState: DimensionMismatchState = {
      detected: false,
      expected: null,
      actual: null,
    }

    const initState = {
      vecReady: false,
      syncRunning: false,
      syncComplete: false,
    }

    let currentVec: VecService = noopVec

    createVecService(db, dataDir, dimensions, logger)
      .then(async (vec) => {
        currentVec = vec
        memoryService.setVecService(vec)

        if (!vec.available) {
          logger.log('Vec service unavailable, skipping embedding sync')
          return
        }

        logger.log('Vec service initialized')
        initState.vecReady = true

        const tableInfo = await vec.getDimensions()
        if (tableInfo.exists && tableInfo.dimensions !== null && tableInfo.dimensions !== dimensions) {
          logger.log(`Dimension mismatch detected: config=${dimensions}, table=${tableInfo.dimensions}, auto-recreating`)
          await vec.recreateTable(dimensions)
        }

        const embeddingSync = createEmbeddingSyncService(memoryService, logger)
        initState.syncRunning = true
        embeddingSync.start().then(
          () => {
            initState.syncRunning = false
            initState.syncComplete = true
            autoValidateOnLoad(projectId, memoryService, db, config, provider, dataDir, mismatchState, currentVec, logger)
              .catch((err: unknown) => {
                logger.error('Auto-validate failed', err)
              })
          },
          (err: unknown) => {
            initState.syncRunning = false
            logger.error('Embedding sync failed', err)
          }
        )
      })
      .catch((err: unknown) => {
        logger.error('Vec service initialization failed', err)
      })

    const compactionConfig: CompactionConfig | undefined = config.compaction
    const memoryInjectionConfig = config.memoryInjection
    const messagesTransformConfig = config.messagesTransform
    const sessionHooks = createSessionHooks(projectId, memoryService, logger, input, compactionConfig)
    const memoryInjection = createMemoryInjectionHook({
      projectId,
      memoryService,
      logger,
      config: memoryInjectionConfig,
    })
    const injectedMessageIds = new Set<string>()

    const scopeEnum = z.enum(['convention', 'decision', 'context'])

    function withDimensionWarning(result: string): string {
      if (!mismatchState.detected) return result
      return `${result}\n\n---\nWarning: Embedding dimension mismatch detected (config: ${mismatchState.expected}d, database: ${mismatchState.actual}d). Semantic search is disabled.\n- If you changed your embedding model intentionally, run memory-health with action "reindex" to rebuild embeddings.\n- If this was accidental, revert your embedding config to match the existing model.`
    }

    let cleaned = false
    const cleanup = async () => {
      if (cleaned) return
      cleaned = true
      logger.log('Cleaning up plugin resources...')
      
      // First, stop all active Ralph loops
      ralphHandler.terminateAll()
      logger.log('Ralph: all active loops terminated')
      
      // Clear all retry timeouts to prevent callbacks after cleanup
      ralphHandler.clearAllRetryTimeouts()
      
      // Then proceed with remaining cleanup
      memoryInjection.destroy()
      await memoryService.destroy()
      closeDatabase(db)
      logger.log('Plugin cleanup complete')
    }

    process.once('exit', cleanup)
    process.once('SIGINT', cleanup)
    process.once('SIGTERM', cleanup)

    const getCleanup = cleanup

    interface RalphSetupOptions {
      prompt: string
      sessionTitle: string
      worktreeName?: string
      completionPromise: string | null
      maxIterations: number
      audit: boolean
      agent?: string
      model?: { providerID: string; modelID: string }
      inPlace?: boolean
      onLoopStarted?: (worktreeName: string) => void
    }

    async function setupRalphLoop(options: RalphSetupOptions): Promise<string> {
      const autoWorktreeName = options.worktreeName ?? `ralph-${slugify(options.sessionTitle.replace(/^Ralph:\s*/i, ''))}`
      const projectDir = directory
      const maxIter = options.maxIterations ?? config.ralph?.defaultMaxIterations ?? 0

      interface LoopContext {
        sessionId: string
        directory: string
        branch?: string
        workspaceId?: string
        inPlace: boolean
      }

      let loopContext: LoopContext

      if (options.inPlace) {
        let currentBranch: string | undefined
        try {
          currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim()
        } catch (err) {
          logger.log(`ralph: no git branch detected, running without branch info`)
        }

        const createResult = await v2.session.create({
          title: options.sessionTitle,
          directory: projectDir,
        })

        if (createResult.error || !createResult.data) {
          logger.error(`ralph: failed to create session`, createResult.error)
          return 'Failed to create Ralph session.'
        }

        loopContext = {
          sessionId: createResult.data.id,
          directory: projectDir,
          branch: currentBranch,
          inPlace: true,
        }
      } else {
        const worktreeResult = await v2.worktree.create({
          worktreeCreateInput: { name: autoWorktreeName },
        })

        if (worktreeResult.error || !worktreeResult.data) {
          logger.error(`ralph: failed to create worktree`, worktreeResult.error)
          return 'Failed to create worktree.'
        }

        const worktreeInfo = worktreeResult.data
        logger.log(`ralph: worktree created at ${worktreeInfo.directory} (branch: ${worktreeInfo.branch})`)

        const createResult = await v2.session.create({
          title: options.sessionTitle,
          directory: worktreeInfo.directory,
        })

        if (createResult.error || !createResult.data) {
          logger.error(`ralph: failed to create session`, createResult.error)
          try {
            await v2.worktree.remove({ worktreeRemoveInput: { directory: worktreeInfo.directory } })
          } catch (cleanupErr) {
            logger.error(`ralph: failed to cleanup worktree`, cleanupErr)
          }
          return 'Failed to create Ralph session.'
        }

        loopContext = {
          sessionId: createResult.data.id,
          directory: worktreeInfo.directory,
          branch: worktreeInfo.branch,
          workspaceId: `wrk-${autoWorktreeName}`,
          inPlace: false,
        }
      }

      const state: RalphState = {
        active: true,
        sessionId: loopContext.sessionId,
        worktreeName: autoWorktreeName,
        worktreeDir: loopContext.directory,
        worktreeBranch: loopContext.branch,
        workspaceId: loopContext.workspaceId ?? '',
        iteration: 1,
        maxIterations: maxIter,
        completionPromise: options.completionPromise,
        startedAt: new Date().toISOString(),
        prompt: options.prompt,
        phase: 'coding',
        audit: options.audit,
        errorCount: 0,
        auditCount: 0,
        inPlace: options.inPlace,
      }

      ralphService.setState(autoWorktreeName, state)
      ralphService.registerSession(loopContext.sessionId, autoWorktreeName)
      logger.log(`ralph: state stored for worktree=${autoWorktreeName}`)

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
        logger.error(`ralph: failed to send prompt`, promptResult.error)
        ralphService.deleteState(autoWorktreeName)
        if (!options.inPlace && loopContext.workspaceId) {
          try {
            await v2.worktree.remove({ worktreeRemoveInput: { directory: loopContext.directory } })
          } catch (cleanupErr) {
            logger.error(`ralph: failed to cleanup worktree`, cleanupErr)
          }
        }
        return options.inPlace
          ? 'Ralph session created but failed to send prompt.'
          : 'Ralph session created but failed to send prompt. Cleaned up.'
      }

      options.onLoopStarted?.(autoWorktreeName)

      const maxInfo = maxIter > 0 ? maxIter.toString() : 'unlimited'
      const auditInfo = options.audit ? 'enabled' : 'disabled'
      const modelInfo = actualModel ? `${actualModel.providerID}/${actualModel.modelID}` : 'default'

      const lines: string[] = [
        options.inPlace ? 'Ralph loop activated! (in-place mode)' : 'Ralph loop activated!',
        '',
        `Session: ${loopContext.sessionId}`,
        `Title: ${options.sessionTitle}`,
      ]

      if (options.inPlace) {
        lines.push(`Directory: ${loopContext.directory}`)
        if (loopContext.branch) {
          lines.push(`Branch: ${loopContext.branch} (in-place)`)
        }
      } else {
        lines.push(`Workspace: ${loopContext.workspaceId}`)
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
        'The user can run ralph-status or ralph-cancel later if needed.',
      )

      return lines.join('\n')
    }

    const RALPH_BLOCKED_TOOLS: Record<string, string> = {
      question: 'The question tool is not available during a Ralph loop. Do not ask questions — continue working on the task autonomously.',
      'memory-plan-execute': 'The memory-plan-execute tool is not available during a Ralph loop. Focus on executing the current plan.',
      'memory-plan-ralph': 'The memory-plan-ralph tool is not available during a Ralph loop. Focus on executing the current plan.',
    }

    const PLAN_APPROVAL_LABELS = ['New session', 'Execute here', 'Ralph (worktree)', 'Ralph (in place)']

    const PLAN_APPROVAL_DIRECTIVES: Record<string, string> = {
      'New session': `<system-reminder>
The user selected "New session". You MUST now call memory-plan-execute in this response with:
- plan: The FULL self-contained implementation plan (the code agent starts with zero context)
- title: A short descriptive title for the session
- inPlace: false (or omit)
Do NOT output text without also making this tool call.
</system-reminder>`,
      'Execute here': `<system-reminder>
The user selected "Execute here". You MUST now call memory-plan-execute in this response with:
- plan: "Execute the implementation plan from this conversation. Review all phases above and implement each one."
- title: A short descriptive title for the session
- inPlace: true
Do NOT output text without also making this tool call.
</system-reminder>`,
      'Ralph (worktree)': `<system-reminder>
The user selected "Ralph (worktree)". You MUST now call memory-plan-ralph in this response with:
- plan: The FULL self-contained implementation plan (Ralph runs in an isolated worktree with no prior context)
- title: A short descriptive title for the session
- inPlace: false (or omit)
Do NOT output text without also making this tool call.
</system-reminder>`,
      'Ralph (in place)': `<system-reminder>
The user selected "Ralph (in place)". You MUST now call memory-plan-ralph in this response with:
- plan: The FULL self-contained implementation plan (Ralph runs in the current directory with no prior context)
- title: A short descriptive title for the session
- inPlace: true
Do NOT output text without also making this tool call.
</system-reminder>`,
    }

    return {
      getCleanup,
      tool: {
        'memory-read': tool({
          description: 'Search and retrieve project memories',
          args: {
            query: z.string().optional().describe('Semantic search query'),
            scope: scopeEnum.optional().describe('Filter by scope'),
            limit: z.number().optional().default(10).describe('Max results'),
          },
          execute: async (args) => {
            logger.log(`memory-read: query="${args.query ?? 'none'}", scope=${args.scope}, limit=${args.limit}`)

            let results
            if (args.query) {
              const searchResults = await memoryService.search(args.query, projectId, {
                scope: args.scope,
                limit: args.limit,
              })
              results = searchResults.map((r) => r.memory)
            } else {
              results = memoryService.listByProject(projectId, {
                scope: args.scope,
                limit: args.limit,
              })
            }

            logger.log(`memory-read: returned ${results.length} results`)
            if (results.length === 0) {
              return withDimensionWarning('No memories found.')
            }

            const formatted = results.map(
              (m: any) => `[${m.id}] (${m.scope}) - Created ${new Date(m.createdAt).toISOString().split('T')[0]}\n${m.content}`
            )
            return withDimensionWarning(`Found ${results.length} memories:\n\n${formatted.join('\n\n')}`)
          },
        }),
        'memory-write': tool({
          description: 'Store a new project memory',
          args: {
            content: z.string().describe('The memory content to store'),
            scope: scopeEnum.describe('Memory scope category'),
          },
          execute: async (args) => {
            logger.log(`memory-write: scope=${args.scope}, content="${args.content?.substring(0, 80)}"`)

            const result = await memoryService.create({
              projectId,
              scope: args.scope,
              content: args.content,
            })

            logger.log(`memory-write: created id=${result.id}, deduplicated=${result.deduplicated}`)
            return withDimensionWarning(`Memory stored (ID: #${result.id}, scope: ${args.scope}).${result.deduplicated ? ' (matched existing memory)' : ''}`)
          },
        }),
        'memory-edit': tool({
          description: 'Edit an existing project memory',
          args: {
            id: z.number().describe('The memory ID to edit'),
            content: z.string().describe('The updated memory content'),
            scope: scopeEnum.optional().describe('Change the scope category'),
          },
          execute: async (args) => {
            logger.log(`memory-edit: id=${args.id}, content="${args.content?.substring(0, 80)}"`)
            
            const memory = memoryService.getById(args.id)
            if (!memory || memory.projectId !== projectId) {
              logger.log(`memory-edit: id=${args.id} not found`)
              return withDimensionWarning(`Memory #${args.id} not found.`)
            }
            
            await memoryService.update(args.id, {
              content: args.content,
              ...(args.scope && { scope: args.scope }),
            })
            
            logger.log(`memory-edit: updated id=${args.id}`)
            return withDimensionWarning(`Updated memory #${args.id} (scope: ${args.scope ?? memory.scope}).`)
          },
        }),
        'memory-delete': tool({
          description: 'Delete a project memory',
          args: {
            id: z.number().describe('The memory ID to delete'),
          },
          execute: async (args) => {
            const id = args.id
            logger.log(`memory-delete: id=${id}`)

            const memory = memoryService.getById(id)
            if (!memory || memory.projectId !== projectId) {
              logger.log(`memory-delete: id=${id} not found`)
              return withDimensionWarning(`Memory #${id} not found.`)
            }

            await memoryService.delete(id)
            logger.log(`memory-delete: deleted id=${id}`)
            return withDimensionWarning(`Deleted memory #${id}: "${memory.content.substring(0, 50)}..." (${memory.scope})`)
          },
        }),
        'memory-health': tool({
          description: 'Check memory plugin health or trigger a reindex of all embeddings. Use action "check" (default) to view status, "reindex" to regenerate all embeddings when model has changed or embeddings are missing, or "upgrade" to update the plugin to the latest version. Always report the plugin version from the output. Never run reindex unless the user explicitly asks for it.',
          args: {
            action: z.enum(['check', 'reindex', 'upgrade']).optional().default('check').describe('Action to perform: "check" for health status, "reindex" to regenerate embeddings, "upgrade" to update plugin'),
          },
          execute: async (args) => {
            if (args.action === 'upgrade') {
              const result = await performUpgrade(async (cacheDir, version) => {
                const pkg = `@opencode-manager/memory@${version}`
                const output = await input.$`bun add --force --no-cache --exact --cwd ${cacheDir} ${pkg}`.nothrow().quiet()
                return { exitCode: output.exitCode, stderr: output.stderr.toString() }
              })
              return result.message
            }
            if (args.action === 'reindex') {
              if (!currentVec.available) {
                return 'Reindex unavailable: vector service is still initializing. Try again in a few seconds.'
              }
              return executeReindex(projectId, memoryService, db, config, provider, mismatchState, currentVec)
            }
            const [healthResult, updateCheck] = await Promise.all([
              executeHealthCheck(projectId, db, config, provider, dataDir),
              checkForUpdate(),
            ])
            const versionLine = formatUpgradeCheck(updateCheck)
            const initInfo = `\nInit: ${initState.vecReady ? 'vec ready' : 'vec pending'}${initState.syncRunning ? ', sync in progress' : initState.syncComplete ? ', sync complete' : ''}`
            return withDimensionWarning(healthResult + initInfo + '\n' + versionLine)
          },
        }),
        'memory-plan-execute': tool({
          description: 'Send the plan to the Code agent for execution. By default creates a new session. Set inPlace to true to switch to the code agent in the current session (plan is already in context).',
          args: {
            plan: z.string().describe('The full implementation plan to send to the Code agent'),
            title: z.string().describe('Short title for the session (shown in session list)'),
            inPlace: z.boolean().optional().default(false).describe('Execute in the current session as a subtask instead of creating a new session'),
          },
          execute: async (args, context) => {
            logger.log(`memory-plan-execute: ${args.inPlace ? 'switching to code agent' : 'creating session'} titled "${args.title}"`)

            const sessionTitle = args.title.length > 60 ? `${args.title.substring(0, 57)}...` : args.title
            const executionModel = parseModelString(config.executionModel)

            if (args.inPlace) {
              const inPlacePrompt = `The architect agent has created an implementation plan in this conversation above. You are now the code agent taking over this session. Your job is to execute the plan — edit files, run commands, create tests, and implement every phase. Do NOT just describe or summarize the changes. Actually make them.\n\nPlan reference: ${args.plan}`

              const { result: promptResult, usedModel: actualModel } = await retryWithModelFallback(
                () => v2.session.promptAsync({
                  sessionID: context.sessionID,
                  directory,
                  agent: 'code',
                  parts: [{ type: 'text' as const, text: inPlacePrompt }],
                  ...(executionModel ? { model: executionModel } : {}),
                }),
                () => v2.session.promptAsync({
                  sessionID: context.sessionID,
                  directory,
                  agent: 'code',
                  parts: [{ type: 'text' as const, text: inPlacePrompt }],
                }),
                executionModel,
                logger,
              )

              if (promptResult.error) {
                logger.error(`memory-plan-execute: in-place agent switch failed`, promptResult.error)
                return `Failed to switch to code agent. Error: ${JSON.stringify(promptResult.error)}`
              }

              const modelInfo = actualModel ? `${actualModel.providerID}/${actualModel.modelID}` : 'default'
              return `Switching to code agent for execution.\n\nTitle: ${sessionTitle}\nModel: ${modelInfo}\nAgent: code`
            }

            const { cleaned: planText, stripped } = stripPromiseTags(args.plan)
            if (stripped) {
              logger.log(`memory-plan-execute: stripped <promise> tags from plan text`)
            }

            const createResult = await v2.session.create({
              title: sessionTitle,
              directory,
            })

            if (createResult.error || !createResult.data) {
              logger.error(`memory-plan-execute: failed to create session`, createResult.error)
              return 'Failed to create new session.'
            }

            const newSessionId = createResult.data.id
            logger.log(`memory-plan-execute: created session=${newSessionId}`)

            const { result: promptResult, usedModel: actualModel } = await retryWithModelFallback(
              () => v2.session.promptAsync({
                sessionID: newSessionId,
                directory,
                parts: [{ type: 'text' as const, text: planText }],
                agent: 'code',
                model: executionModel!,
              }),
              () => v2.session.promptAsync({
                sessionID: newSessionId,
                directory,
                parts: [{ type: 'text' as const, text: planText }],
                agent: 'code',
              }),
              executionModel,
              logger,
            )

            if (promptResult.error) {
              logger.error(`memory-plan-execute: failed to prompt session`, promptResult.error)
              return `Session created (${newSessionId}) but failed to send plan. Switch to it and paste the plan manually.`
            }

            logger.log(`memory-plan-execute: prompted session=${newSessionId}`)

            const modelInfo = actualModel ? `${actualModel.providerID}/${actualModel.modelID}` : 'default'
            return `Implementation session created and plan sent.\n\nSession: ${newSessionId}\nTitle: ${sessionTitle}\nModel: ${modelInfo}\n\nSwitch to this session to begin. You can change the model from the session dropdown.`
          },
        }),
        'memory-plan-ralph': tool({
          description: 'Execute a plan using a Ralph iterative development loop. By default runs in an isolated git worktree. Set inPlace to true to run in the current directory instead.',
          args: {
            plan: z.string().describe('The full implementation plan to send to the Code agent'),
            title: z.string().describe('Short title for the session (shown in session list)'),
            inPlace: z.boolean().optional().default(false).describe('Run in current directory instead of creating a worktree'),
          },
          execute: async (args, context) => {
            if (config.ralph?.enabled === false) {
              return 'Ralph loops are disabled in plugin config. Use memory-plan-execute instead.'
            }

            logger.log(`memory-plan-ralph: creating worktree for plan="${args.title}"`)

            const sessionTitle = args.title.length > 60 ? `${args.title.substring(0, 57)}...` : args.title
            const ralphModel = parseModelString(config.ralph?.model) ?? parseModelString(config.executionModel)
            const audit = config.ralph?.defaultAudit ?? true

            return setupRalphLoop({
              prompt: args.plan,
              sessionTitle: `Ralph: ${sessionTitle}`,
              completionPromise: DEFAULT_PLAN_COMPLETION_PROMISE,
              maxIterations: config.ralph?.defaultMaxIterations ?? 0,
              audit: audit,
              agent: 'code',
              model: ralphModel,
              inPlace: args.inPlace,
              onLoopStarted: (id) => ralphHandler.startWatchdog(id),
            })
          },
        }),
        'memory-kv-set': tool({
          description: 'Store a key-value pair for the current project. Values expire after 7 days by default. Use for ephemeral project state like planning progress, code review patterns, or session context.',
          args: {
            key: z.string().describe('The key to store the value under'),
            value: z.string().describe('The value to store (JSON string)'),
            ttlMs: z.number().optional().describe('Time-to-live in milliseconds (default: 7 days)'),
          },
          execute: async (args) => {
            logger.log(`memory-kv-set: key="${args.key}"`)
            let parsed: unknown
            try {
              parsed = JSON.parse(args.value)
            } catch {
              parsed = args.value
            }
            kvService.set(projectId, args.key, parsed, args.ttlMs)
            const expiresAt = new Date(Date.now() + (args.ttlMs ?? 7 * 24 * 60 * 60 * 1000))
            logger.log(`memory-kv-set: stored key="${args.key}", expires=${expiresAt.toISOString()}`)
            return `Stored key "${args.key}" (expires ${expiresAt.toISOString()})`
          },
        }),
        'memory-kv-get': tool({
          description: 'Retrieve a value by key for the current project.',
          args: {
            key: z.string().describe('The key to retrieve'),
          },
          execute: async (args) => {
            logger.log(`memory-kv-get: key="${args.key}"`)
            const value = kvService.get(projectId, args.key)
            if (value === null) {
              logger.log(`memory-kv-get: key="${args.key}" not found`)
              return `No value found for key "${args.key}"`
            }
            logger.log(`memory-kv-get: key="${args.key}" found`)
            return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
          },
        }),
        'memory-kv-list': tool({
          description: 'List all active key-value pairs for the current project.',
          args: {
            prefix: z.string().optional().describe('Filter entries by key prefix (e.g. "review-finding:")'),
          },
          execute: async (args) => {
            logger.log(`memory-kv-list: prefix="${args.prefix ?? 'none'}"`)
            const entries = args.prefix
              ? kvService.listByPrefix(projectId, args.prefix)
              : kvService.list(projectId)
            if (entries.length === 0) {
              logger.log('memory-kv-list: no entries')
              return 'No active KV entries for this project.'
            }
            const formatted = entries.map((e) => {
              const expiresIn = Math.round((e.expiresAt - Date.now()) / 60000)
              const dataStr = typeof e.data === 'string' ? e.data : JSON.stringify(e.data)
              const preview = dataStr.substring(0, 50).replace(/\n/g, ' ')
              return `- **${e.key}** (expires in ${expiresIn}m): ${preview}${dataStr.length > 50 ? '...' : ''}`
            })
            logger.log(`memory-kv-list: ${entries.length} entries`)
            return `${entries.length} active KV entries:\n\n${formatted.join('\n')}`
          },
        }),
        'memory-kv-delete': tool({
          description: 'Delete a key-value pair for the current project.',
          args: {
            key: z.string().describe('The key to delete'),
          },
          execute: async (args) => {
            logger.log(`memory-kv-delete: key="${args.key}"`)
            kvService.delete(projectId, args.key)
            return `Deleted key "${args.key}"`
          },
        }),

        'ralph-cancel': tool({
          description: 'Cancel an active Ralph loop and optionally clean up the worktree.',
          args: {
            name: z.string().optional().describe('Worktree name of the Ralph loop to cancel'),
          },
          execute: async (args) => {
            let state: RalphState | null = null

            if (args.name) {
              const name = args.name
              state = ralphService.findByWorktreeName(name)
              if (!state) {
                const candidates = ralphService.findCandidatesByPartialName(name)
                if (candidates.length > 0) {
                  return `Multiple loops match "${name}":\n${candidates.map((s) => `- ${s.worktreeName}`).join('\n')}\n\nBe more specific.`
                }
                const recent = ralphService.listRecent()
                const foundRecent = recent.find((s) => s.worktreeName === name || (s.worktreeBranch && s.worktreeBranch.toLowerCase().includes(name.toLowerCase())))
                if (foundRecent) {
                  return `Ralph loop "${foundRecent.worktreeName}" has already completed.`
                }
                return `No active Ralph loop found for worktree "${name}".`
              }
              if (!state.active) {
                return `Ralph loop "${state.worktreeName}" has already completed.`
              }
            } else {
              const active = ralphService.listActive()
              if (active.length === 0) return 'No active Ralph loops.'
              if (active.length === 1) {
                state = active[0]
              } else {
                return `Multiple active Ralph loops. Specify a name:\n${active.map((s) => `- ${s.worktreeName} (iteration ${s.iteration})`).join('\n')}`
              }
            }

            await ralphHandler.cancelBySessionId(state.sessionId)
            logger.log(`ralph-cancel: cancelled loop for session=${state.sessionId} at iteration ${state.iteration}`)

            if (config.ralph?.cleanupWorktree && !state.inPlace && state.worktreeDir) {
              try {
                const gitCommonDir = execSync('git rev-parse --git-common-dir', { cwd: state.worktreeDir, encoding: 'utf-8' }).trim()
                const gitRoot = resolve(state.worktreeDir, gitCommonDir, '..')
                const removeResult = spawnSync('git', ['worktree', 'remove', '-f', state.worktreeDir], { cwd: gitRoot, encoding: 'utf-8' })
                if (removeResult.status !== 0) {
                  throw new Error(removeResult.stderr || 'git worktree remove failed')
                }
                logger.log(`ralph-cancel: removed worktree ${state.worktreeDir}`)
              } catch (err) {
                logger.error(`ralph-cancel: failed to remove worktree`, err)
              }
            }

            const modeInfo = state.inPlace ? ' (in-place)' : ''
            const branchInfo = state.worktreeBranch ? `\nBranch: ${state.worktreeBranch}` : ''
            return `Cancelled Ralph loop "${state.worktreeName}"${modeInfo} (was at iteration ${state.iteration}).\nDirectory: ${state.worktreeDir}${branchInfo}`
          },
        }),
        'ralph-status': tool({
          description: 'Check the status of Ralph loops. With no arguments, lists all active loops for the current project. Pass a worktree name for detailed status of a specific loop. Use restart to resume an inactive loop.',
          args: {
            name: z.string().optional().describe('Worktree name to check for detailed status'),
            restart: z.boolean().optional().describe('Restart an inactive loop by name'),
          },
          execute: async (args) => {
            const active = ralphService.listActive()

            if (args.restart) {
              if (!args.name) {
                return 'Specify a loop name to restart. Use ralph-status to see available loops.'
              }

              const recent = ralphService.listRecent()
              const allStates = [...active, ...recent]
              const { match: stoppedState, candidates } = findPartialMatch(args.name, allStates, (s) => [s.worktreeName, s.worktreeBranch])
              if (!stoppedState && candidates.length > 0) {
                return `Multiple loops match "${args.name}":\n${candidates.map((s) => `- ${s.worktreeName}`).join('\n')}\n\nBe more specific.`
              }
              if (!stoppedState) {
                const available = [...active, ...recent].map((s) => `- ${s.worktreeName}`).join('\n')
                return `No Ralph loop found for "${args.name}".\n\nAvailable loops:\n${available}`
              }

              if (stoppedState.active) {
                return `Loop "${stoppedState.worktreeName}" is already active. Nothing to restart.`
              }

              if (stoppedState.terminationReason === 'completed') {
                return `Loop "${stoppedState.worktreeName}" completed successfully and cannot be restarted.`
              }

              if (!stoppedState.inPlace && stoppedState.worktreeDir) {
                if (!existsSync(stoppedState.worktreeDir)) {
                  return `Cannot restart "${stoppedState.worktreeName}": worktree directory no longer exists at ${stoppedState.worktreeDir}. The worktree may have been cleaned up.`
                }
              }

              const createResult = await v2.session.create({
                title: stoppedState.worktreeName!,
                directory: stoppedState.worktreeDir!,
              })

              if (createResult.error || !createResult.data) {
                logger.error(`ralph-restart: failed to create session`, createResult.error)
                return `Failed to create new session for restart.`
              }

              const newSessionId = createResult.data.id

              ralphService.deleteState(stoppedState.worktreeName!)

              const newState: RalphState = {
                active: true,
                sessionId: newSessionId,
                worktreeName: stoppedState.worktreeName!,
                worktreeDir: stoppedState.worktreeDir!,
                worktreeBranch: stoppedState.worktreeBranch,
                workspaceId: stoppedState.workspaceId,
                iteration: stoppedState.iteration!,
                maxIterations: stoppedState.maxIterations!,
                completionPromise: stoppedState.completionPromise,
                startedAt: new Date().toISOString(),
                prompt: stoppedState.prompt,
                phase: 'coding',
                audit: stoppedState.audit,
                errorCount: 0,
                auditCount: 0,
                inPlace: stoppedState.inPlace,
              }

              ralphService.setState(stoppedState.worktreeName!, newState)
              ralphService.registerSession(newSessionId, stoppedState.worktreeName!)

              let promptText = stoppedState.prompt ?? ''
              if (stoppedState.completionPromise) {
                promptText += `\n\n---\n\n**IMPORTANT - Completion Signal:** When you have completed ALL phases of this plan successfully, you MUST output the following tag exactly: <promise>${stoppedState.completionPromise}</promise>\n\nDo NOT output this tag until every phase is truly complete. The loop will continue until this signal is detected.`
              }

              const ralphModel = parseModelString(config.ralph?.model) ?? parseModelString(config.executionModel)

              const { result: promptResult } = await retryWithModelFallback(
                () => v2.session.promptAsync({
                  sessionID: newSessionId,
                  directory: stoppedState.worktreeDir!,
                  parts: [{ type: 'text' as const, text: promptText }],
                  agent: 'code',
                  model: ralphModel!,
                }),
                () => v2.session.promptAsync({
                  sessionID: newSessionId,
                  directory: stoppedState.worktreeDir!,
                  parts: [{ type: 'text' as const, text: promptText }],
                  agent: 'code',
                }),
                ralphModel,
                logger,
              )

              if (promptResult.error) {
                logger.error(`ralph-restart: failed to send prompt`, promptResult.error)
                ralphService.deleteState(stoppedState.worktreeName!)
                return `Restart failed: could not send prompt to new session.`
              }

              ralphHandler.startWatchdog(stoppedState.worktreeName!)

              const modeInfo = stoppedState.inPlace ? ' (in-place)' : ''
              const branchInfo = stoppedState.worktreeBranch ? `\nBranch: ${stoppedState.worktreeBranch}` : ''
              return [
                `Restarted Ralph loop "${stoppedState.worktreeName}"${modeInfo}`,
                '',
                `New session: ${newSessionId}`,
                `Continuing from iteration: ${stoppedState.iteration}`,
                `Previous termination: ${stoppedState.terminationReason}`,
                `Directory: ${stoppedState.worktreeDir}${branchInfo}`,
                `Audit: ${stoppedState.audit ? 'enabled' : 'disabled'}`,
              ].join('\n')
            }

            if (!args.name) {
              const recent = ralphService.listRecent()

              if (active.length === 0) {
                if (recent.length === 0) return 'No Ralph loops found.'

                const lines: string[] = ['Recently Completed Ralph Loops', '']
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
                lines.push('Use ralph-status <name> for detailed info.')
                return lines.join('\n')
              }

              let statuses: Record<string, { type: string; attempt?: number; message?: string; next?: number }> = {}
              try {
                const statusResult = await v2.session.status()
                statuses = (statusResult.data ?? {}) as typeof statuses
              } catch {
              }

              const lines: string[] = [`Active Ralph Loops (${active.length})`, '']
              active.forEach((s, i) => {
                const elapsed = s.startedAt ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000) : 0
                const minutes = Math.floor(elapsed / 60)
                const seconds = elapsed % 60
                const duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
                const iterInfo = s.maxIterations && s.maxIterations > 0 ? `${s.iteration} / ${s.maxIterations}` : `${s.iteration} (unlimited)`
                const sessionStatus = statuses[s.sessionId]?.type ?? 'unknown'
                const modeIndicator = s.inPlace ? ' (in-place)' : ''
                const stallInfo = ralphHandler.getStallInfo(s.worktreeName)
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
                  lines.push(`   ... and ${recent.length - 10} more. Use ralph-status <name> for details.`)
                  lines.push('')
                }
              }

              lines.push('Use ralph-status <name> for detailed info, or ralph-cancel <name> to stop a loop.')
              return lines.join('\n')
            }

            const state = ralphService.findByWorktreeName(args.name)
            if (!state) {
              const candidates = ralphService.findCandidatesByPartialName(args.name)
              if (candidates.length > 0) {
                return `Multiple loops match "${args.name}":\n${candidates.map((s) => `- ${s.worktreeName}`).join('\n')}\n\nBe more specific.`
              }
              return `No Ralph loop found for worktree "${args.name}".`
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
                'Ralph Loop Status (Inactive)',
                '',
                `Name: ${state.worktreeName}`,
                `Session: ${state.sessionId}`,
              ]
              if (state.inPlace) {
                statusLines.push(`Mode: in-place | Directory: ${state.worktreeDir}`)
              } else {
                statusLines.push(`Workspace: ${state.workspaceId}`)
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

              const sessionOutput = await fetchSessionOutput(v2, state.sessionId, state.worktreeDir!, logger)
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
              const statusResult = await v2.session.status()
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

            const stallInfo = ralphHandler.getStallInfo(state.worktreeName)
            const secondsSinceActivity = stallInfo
              ? Math.round((Date.now() - stallInfo.lastActivityTime) / 1000)
              : null
            const stallCount = stallInfo?.consecutiveStalls ?? 0

            const statusLines: string[] = [
              'Ralph Loop Status',
              '',
              `Name: ${state.worktreeName}`,
              `Session: ${state.sessionId}`,
            ]
            if (state.inPlace) {
              statusLines.push(`Mode: in-place | Directory: ${state.worktreeDir}`)
            } else {
              statusLines.push(`Workspace: ${state.workspaceId}`)
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
            statusLines.push(
              `Completion promise: ${state.completionPromise ?? 'none'}`,
              `Started: ${state.startedAt}`,
              ...(state.errorCount && state.errorCount > 0 ? [`Error count: ${state.errorCount} (retries before termination: ${MAX_RETRIES})`] : []),
              `Audit count: ${state.auditCount ?? 0}`,
              `Model: ${config.ralph?.model || config.executionModel || 'default'}`,
              `Auditor model: ${config.auditorModel || 'default'}`,
              ...(stallCount > 0 ? [`Stalls: ${stallCount}`] : []),
              ...(secondsSinceActivity !== null ? [`Last activity: ${secondsSinceActivity}s ago`] : []),
              '',
              `Prompt: ${promptPreview}`,
            )

            if (state.lastAuditResult) {
              statusLines.push(...formatAuditResult(state.lastAuditResult))
            }

            const sessionOutput = await fetchSessionOutput(v2, state.sessionId, state.worktreeDir!, logger)
            if (sessionOutput) {
              statusLines.push('')
              statusLines.push('Session Output:')
              statusLines.push(...formatSessionOutput(sessionOutput))
            }

            return statusLines.join('\n')
          },
        }),
      },
      config: createConfigHandler(
        config.auditorModel
          ? { ...agents, auditor: { ...agents.auditor, defaultModel: config.auditorModel } }
          : agents
      ),
      'chat.message': async (input, output) => {
        await sessionHooks.onMessage(input, output)
      },
      event: async (input) => {
        const eventInput = input as { event: { type: string; properties?: Record<string, unknown> } }
        if (eventInput.event?.type === 'server.instance.disposed') {
          cleanup()
          return
        }
        await ralphHandler.onEvent(eventInput)
        await sessionHooks.onEvent(eventInput)
      },
      'tool.execute.before': async (
        input: { tool: string; sessionID: string; callID: string },
        output: { args: unknown }
      ) => {
        const worktreeName = ralphService.resolveWorktreeName(input.sessionID)
        const state = worktreeName ? ralphService.getActiveState(worktreeName) : null
        if (!state?.active) return

        if (!(input.tool in RALPH_BLOCKED_TOOLS)) return

        logger.log(`Ralph: blocking ${input.tool} tool before execution in ${state.phase} phase for session ${input.sessionID}`)

        throw new Error(RALPH_BLOCKED_TOOLS[input.tool]!)
      },
      'tool.execute.after': async (
        input: { tool: string; sessionID: string; callID: string; args: unknown },
        output: { title: string; output: string; metadata: unknown }
      ) => {
        if (input.tool === 'question') {
          const args = input.args as { questions?: Array<{ options?: Array<{ label: string }> }> } | undefined
          const options = args?.questions?.[0]?.options
          if (options) {
            const labels = options.map((o) => o.label)
            const isPlanApproval = PLAN_APPROVAL_LABELS.every((l) => labels.includes(l))
            if (isPlanApproval) {
              const metadata = output.metadata as { answers?: string[][] } | undefined
              const answer = metadata?.answers?.[0]?.[0]?.trim() ?? output.output.trim()
              const matchedLabel = PLAN_APPROVAL_LABELS.find((l) => answer === l || answer.startsWith(l))
              const directive = matchedLabel ? PLAN_APPROVAL_DIRECTIVES[matchedLabel] : '<system-reminder>\nThe user provided a custom response instead of selecting a predefined option. Review their answer and respond accordingly. If they want to proceed with execution, use the appropriate tool (memory-plan-execute or memory-plan-ralph) based on their intent. If they want to cancel or revise the plan, help them with that instead.\n</system-reminder>'
              output.output = `${output.output}\n\n${directive}`
              logger.log(`Plan approval: detected "${matchedLabel ?? 'cancel/custom'}" answer, injected directive`)
            }
          }
          return
        }

        const worktreeName = ralphService.resolveWorktreeName(input.sessionID)
        const state = worktreeName ? ralphService.getActiveState(worktreeName) : null
        if (!state?.active) return

        if (!(input.tool in RALPH_BLOCKED_TOOLS)) return

        logger.log(`Ralph: blocked ${input.tool} tool in ${state.phase} phase for session ${input.sessionID}`)
        
        output.title = 'Tool blocked'
        output.output = RALPH_BLOCKED_TOOLS[input.tool]!
      },
      'permission.ask': async (input, output) => {
        const req = input as unknown as { sessionID: string; patterns: string[] }
        const worktreeName = ralphService.resolveWorktreeName(req.sessionID)
        const state = worktreeName ? ralphService.getActiveState(worktreeName) : null
        if (!state?.active) return

        if (req.patterns.some((p) => p.startsWith('git push'))) {
          logger.log(`Ralph: denied git push for session ${req.sessionID}`)
          output.status = 'deny'
          return
        }
      },
      'experimental.session.compacting': async (input, output) => {
        logger.log(`Compacting triggered`)
        await sessionHooks.onCompacting(
          input as { sessionID: string },
          output as { context: string[]; prompt?: string }
        )
      },
      'experimental.chat.messages.transform': async (
        _input: Record<string, never>,
        output: { messages: Array<{ info: { role: string; agent?: string; id?: string }; parts: Array<Record<string, unknown>> }> }
      ) => {
        const messages = output.messages
        let userMessage: typeof messages[number] | undefined
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].info.role === 'user') {
            userMessage = messages[i]
            break
          }
        }

        if (!userMessage) return

        const messageId = userMessage.info.id
        const alreadyInjected = messageId ? injectedMessageIds.has(messageId) : false

        if (!alreadyInjected) {
          const textParts = userMessage.parts
            .filter((p) => p.type === 'text' && typeof p.text === 'string')
            .map((p) => p.text as string)
          const userText = textParts.join('\n').trim()

          if (userText.length > 0) {
            const memoryInjectionEnabled = config.memoryInjection?.enabled ?? true
            if (memoryInjectionEnabled) {
              const injected = await memoryInjection.handler(userText)
              if (injected) {
                userMessage.parts.push({
                  type: 'text',
                  text: injected,
                  synthetic: true,
                })
              }
            }
          }

          if (messageId) {
            injectedMessageIds.add(messageId)
            if (injectedMessageIds.size > 100) {
              const first = injectedMessageIds.values().next().value
              if (first) injectedMessageIds.delete(first)
            }
          }
        }

        const messagesTransformEnabled = messagesTransformConfig?.enabled ?? true
        if (!messagesTransformEnabled) return

        const isArchitect = userMessage.info.agent === agents.architect.displayName
        if (!isArchitect) return

        userMessage.parts.push({
          type: 'text',
          text: `<system-reminder>
Plan mode is active. You MUST NOT make any file edits, run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

You may ONLY: observe, analyze, plan, and use memory tools (memory-read, memory-write, memory-edit, memory-delete, memory-kv-set, memory-kv-get, memory-kv-list), mcp_question, memory-plan-execute, and memory-plan-ralph.

You MUST get explicit approval via mcp_question before calling memory-plan-execute or memory-plan-ralph. Never execute a plan without approval.
</system-reminder>`,
          synthetic: true,
        })
      },
    } as Hooks & { getCleanup: () => Promise<void> }
  }
}

const plugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const config = loadPluginConfig()
  const factory = createMemoryPlugin(config)
  return factory(input)
}

export default plugin
export type { PluginConfig, CompactionConfig } from './types'
