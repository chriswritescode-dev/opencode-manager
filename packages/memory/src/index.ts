import type { Plugin, PluginInput, Hooks } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import { agents } from './agents'
import { createConfigHandler } from './config'
import { VERSION } from './version'
import { createSessionHooks, createMemoryInjectionHook } from './hooks'
import { join } from 'path'
import { initializeDatabase, resolveDataDir, closeDatabase, createMetadataQuery } from './storage'
import type { MemoryService } from './services/memory'
import { createVecService } from './storage/vec'
import { createEmbeddingProvider, checkServerHealth, isServerRunning, killEmbeddingServer } from './embedding'
import { createMemoryService } from './services/memory'
import { createEmbeddingSyncService } from './services/embedding-sync'
import { loadPluginConfig } from './setup'
import { resolveLogPath } from './storage'
import { createLogger } from './utils/logger'
import type { Database } from 'bun:sqlite'
import type { PluginConfig, CompactionConfig, HealthStatus, Logger } from './types'
import type { EmbeddingProvider } from './embedding'
import type { VecService } from './storage/vec-types'
import { createNoopVecService } from './storage/vec'


const z = tool.schema

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

function parseModelString(modelStr?: string): { providerID: string; modelID: string } | undefined {
  if (!modelStr) return undefined
  const slashIndex = modelStr.indexOf('/')
  if (slashIndex <= 0 || slashIndex === modelStr.length - 1) return undefined
  return {
    providerID: modelStr.substring(0, slashIndex),
    modelID: modelStr.substring(slashIndex + 1),
  }
}

export function createMemoryPlugin(config: PluginConfig): Plugin {
  return async (input: PluginInput): Promise<Hooks> => {
    const { directory, project, client } = input
    const projectId = project.id

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
      memoryInjection.destroy()
      await memoryService.destroy()
      closeDatabase(db)
      logger.log('Plugin cleanup complete')
    }

    process.once('exit', cleanup)
    process.once('SIGINT', cleanup)
    process.once('SIGTERM', cleanup)

    const getCleanup = cleanup

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
          description: 'Check memory plugin health or trigger a reindex of all embeddings. Use action "check" (default) to view status, or "reindex" to regenerate all embeddings when model has changed or embeddings are missing. Always report the plugin version from the output. Never run reindex unless the user explicitly asks for it.',
          args: {
            action: z.enum(['check', 'reindex']).optional().default('check').describe('Action to perform: "check" for health status, "reindex" to regenerate embeddings'),
          },
          execute: async (args) => {
            if (args.action === 'reindex') {
              if (!currentVec.available) {
                return 'Reindex unavailable: vector service is still initializing. Try again in a few seconds.'
              }
              return executeReindex(projectId, memoryService, db, config, provider, mismatchState, currentVec)
            }
            const result = await executeHealthCheck(projectId, db, config, provider, dataDir)
            const initInfo = `\nInit: ${initState.vecReady ? 'vec ready' : 'vec pending'}${initState.syncRunning ? ', sync in progress' : initState.syncComplete ? ', sync complete' : ''}`
            return withDimensionWarning(result + initInfo)
          },
        }),
        'memory-plan-execute': tool({
          description: 'Create a new Code session and send the plan as the first prompt. Call this after the user approves the plan.',
          args: {
            plan: z.string().describe('The full implementation plan to send to the Code agent'),
            title: z.string().describe('Short title for the session (shown in session list)'),
          },
          execute: async (args) => {
            logger.log(`memory-plan-execute: creating session titled "${args.title}"`)

            const sessionTitle = args.title.length > 60 ? `${args.title.substring(0, 57)}...` : args.title

            const createResult = await client.session.create({
              body: { title: sessionTitle },
            })

            if (createResult.error || !createResult.data) {
              logger.error(`memory-plan-execute: failed to create session`, createResult.error)
              return 'Failed to create new session.'
            }

            const newSessionId = createResult.data.id
            logger.log(`memory-plan-execute: created session=${newSessionId}`)

            const executionModel = parseModelString(config.executionModel)

            const promptResult = await client.session.promptAsync({
              path: { id: newSessionId },
              body: {
                parts: [{ type: 'text' as const, text: args.plan }],
                agent: 'Code',
                ...(executionModel && { model: executionModel }),
              },
            })

            if (promptResult.error) {
              logger.error(`memory-plan-execute: failed to prompt session`, promptResult.error)
              return `Session created (${newSessionId}) but failed to send plan. Switch to it and paste the plan manually.`
            }

            logger.log(`memory-plan-execute: prompted session=${newSessionId}`)

            const modelInfo = executionModel ? `${executionModel.providerID}/${executionModel.modelID}` : 'default'
            return `Implementation session created and plan sent.\n\nSession: ${newSessionId}\nTitle: ${sessionTitle}\nModel: ${modelInfo}\n\nSwitch to this session to begin. You can change the model from the session dropdown.`
          },
        }),
      },
      config: createConfigHandler(agents),
      'chat.message': sessionHooks.onMessage,
      event: async (input) => {
        const eventInput = input as { event: { type: string; properties?: Record<string, unknown> } }
        if (eventInput.event?.type === 'server.instance.disposed') {
          cleanup()
          return
        }
        await sessionHooks.onEvent(eventInput)
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

You may ONLY: observe, analyze, plan, and use memory tools (memory-read, memory-write, memory-edit, memory-delete, memory-health, memory-plan-execute).
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
