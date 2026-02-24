import type { Plugin, PluginInput, Hooks } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import { agents } from './agents'
import { createConfigHandler } from './config'
import { VERSION } from './version'
import {
  createSessionHooks,
  createKeywordHooks,
  createParamsHooks,
  ACTIVATION_CONTEXT,
} from './hooks'
import { join } from 'path'
import { initializeDatabase, resolveDataDir, closeDatabase, createMetadataQuery, getTableDimensions, recreateVecTable } from './storage'
import type { MemoryService } from './services/memory'
import { createVecService } from './storage/vec'
import { createEmbeddingProvider, checkServerHealth, isServerRunning, killEmbeddingServer } from './embedding'
import { createMemoryService } from './services/memory'
import { createSessionStateService } from './services/session-state'
import { createEmbeddingSyncService } from './services/embedding-sync'
import { loadPluginConfig } from './setup'
import { resolveLogPath } from './storage'
import { createLogger } from './utils/logger'
import type { Database } from 'bun:sqlite'
import type { PluginConfig, CompactionConfig, HealthStatus, Logger, PlanningState } from './types'
import type { EmbeddingProvider } from './embedding'
import { createNoopVecService } from './storage/vec'


const z = tool.schema

async function getHealthStatus(
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
    const row = db.prepare("SELECT COUNT(*) as count FROM memories").get() as { count: number }
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
  db: Database,
  config: PluginConfig,
  provider: EmbeddingProvider,
  dataDir: string,
): Promise<string> {
  const status = await getHealthStatus(db, config, provider, dataDir)
  return formatHealthStatus(status, provider)
}

interface DimensionMismatchState {
  detected: boolean
  expected: number | null
  actual: number | null
}

async function executeReindex(
  memoryService: MemoryService,
  db: Database,
  config: PluginConfig,
  provider: EmbeddingProvider,
  dataDir: string,
  mismatchState: DimensionMismatchState,
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

  const tableResult = getTableDimensions(db)
  if (tableResult.exists && tableResult.dimensions !== configuredDimensions) {
    recreateVecTable(db, configuredDimensions)
    const newVec = await createVecService(db, dataDir, configuredDimensions)
    memoryService.setVecService(newVec)
  }

  const result = await memoryService.reindex()

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
  memoryService: MemoryService,
  db: Database,
  config: PluginConfig,
  provider: EmbeddingProvider,
  dataDir: string,
  logger: Logger,
): Promise<void> {
  const status = await getHealthStatus(db, config, provider, dataDir)

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
  const result = await memoryService.reindex()

  if (result.success > 0 || result.total === 0) {
    const metadata = createMetadataQuery(db)
    metadata.setEmbeddingModel(
      config.embedding.model,
      config.embedding.dimensions ?? provider.dimensions,
    )
  }
  logger.log(`Auto-validate: reindex complete (total=${result.total}, success=${result.success}, failed=${result.failed})`)
}

export function createMemoryPlugin(config: PluginConfig): Plugin {
  return async (input: PluginInput): Promise<Hooks> => {
    const { directory, project } = input
    const projectId = project.id

    const loggingConfig = config.logging
    const logger = createLogger({
      enabled: loggingConfig?.enabled ?? false,
      file: loggingConfig?.file ?? resolveLogPath(),
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

    const sessionStateService = createSessionStateService(db, logger)
    sessionStateService.startCleanupInterval()
    sessionStateService.deleteExpired()

    if (config.dedupThreshold) {
      memoryService.setDedupThreshold(config.dedupThreshold)
    }

    const mismatchState: DimensionMismatchState = {
      detected: false,
      expected: null,
      actual: null,
    }

    const initPromise = createVecService(db, dataDir, dimensions)
      .then(async (vec) => {
        memoryService.setVecService(vec)

        if (!vec.available) {
          logger.log('Vec service unavailable, skipping embedding sync')
          return
        }

        logger.log('Vec service initialized')

        const tableResult = getTableDimensions(db)
        if (tableResult.exists && tableResult.dimensions !== dimensions) {
          mismatchState.detected = true
          mismatchState.expected = dimensions
          mismatchState.actual = tableResult.dimensions
          memoryService.setVecService(createNoopVecService())
          logger.log(`Dimension mismatch detected: config=${dimensions}, table=${tableResult.dimensions ?? 'unknown'}`)
          return
        }

        const embeddingSync = createEmbeddingSyncService(memoryService, logger)
        await embeddingSync.start().catch((err: unknown) => {
          logger.error('Embedding sync failed', err)
        })

        await autoValidateOnLoad(memoryService, db, config, provider, dataDir, logger)
      })
      .catch((err: unknown) => {
        logger.error('Vec service initialization failed', err)
      })

    const compactionConfig: CompactionConfig | undefined = config.compaction
    const sessionHooks = createSessionHooks(projectId, memoryService, sessionStateService, logger, input, compactionConfig)
    const keywordHooks = createKeywordHooks(logger)
    const paramsHooks = createParamsHooks(keywordHooks)

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
      await memoryService.destroy()
      sessionStateService.destroy()
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
            await initPromise
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
            await initPromise
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
            await initPromise
            logger.log(`memory-edit: id=${args.id}, content="${args.content?.substring(0, 80)}"`)
            
            const memory = memoryService.getById(args.id)
            if (!memory) {
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
            await initPromise
            const id = args.id
            logger.log(`memory-delete: id=${id}`)

            const memory = memoryService.getById(id)
            if (!memory) {
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
            await initPromise
            if (args.action === 'reindex') {
              return executeReindex(memoryService, db, config, provider, dataDir, mismatchState)
            }
            return withDimensionWarning(await executeHealthCheck(db, config, provider, dataDir))
          },
        }),
        'memory-planning-update': tool({
          description: 'Update the session planning state (phases, objectives, progress). Merge new fields with existing state.',
          args: {
            sessionID: z.string().describe('The session ID to update'),
            objective: z.string().optional().describe('The main task/goal'),
            current: z.string().optional().describe('Current phase or activity'),
            next: z.string().optional().describe('What comes next'),
            phases: z.array(z.object({
              title: z.string(),
              status: z.string(),
              notes: z.string().optional(),
            })).optional().describe('Phase list with status'),
            findings: z.array(z.string()).optional().describe('Key discoveries'),
            errors: z.array(z.string()).optional().describe('Errors to avoid'),
          },
          execute: async (args) => {
            await initPromise
            const sessionId = args.sessionID
            logger.log(`memory-planning-update: session=${sessionId}`)

            const existing = sessionStateService.getPlanningState(sessionId)
            const merged: typeof existing = {
              ...(existing ?? {}),
              ...(args.objective !== undefined && { objective: args.objective }),
              ...(args.current !== undefined && { current: args.current }),
              ...(args.next !== undefined && { next: args.next }),
              ...(args.phases !== undefined && { phases: args.phases }),
              ...(args.findings !== undefined && {
                findings: [...new Set([...(existing?.findings ?? []), ...args.findings])]
              }),
              ...(args.errors !== undefined && {
                errors: [...new Set([...(existing?.errors ?? []), ...args.errors])]
              }),
              active: true,
            }

            sessionStateService.setPlanningState(sessionId, projectId, merged as PlanningState)

            const hasPhases = merged?.phases && merged.phases.length > 0
            const summary = [
              merged?.objective && `objective: ${merged.objective}`,
              merged?.current && `current: ${merged.current}`,
              hasPhases && `${merged.phases!.length} phases`,
            ].filter(Boolean).join(', ')

            logger.log(`memory-planning-update: stored for session ${sessionId}`)
            return `Planning state updated for session ${sessionId}. ${summary || 'No data provided'}`
          },
        }),
        'memory-planning-get': tool({
          description: 'Get the current planning state for a session',
          args: {
            sessionID: z.string().describe('The session ID to retrieve planning state for'),
          },
          execute: async (args) => {
            await initPromise
            const sessionId = args.sessionID
            logger.log(`memory-planning-get: session=${sessionId}`)

            const planningState = sessionStateService.getPlanningState(sessionId)
            if (!planningState) {
              return 'No planning state found for this session'
            }

            const sections: string[] = []
            if (planningState.objective) sections.push(`**Objective:** ${planningState.objective}`)
            if (planningState.current) sections.push(`**Current:** ${planningState.current}`)
            if (planningState.next) sections.push(`**Next:** ${planningState.next}`)

            if (planningState.phases && planningState.phases.length > 0) {
              sections.push('\n### Phases:')
              for (const phase of planningState.phases) {
                const statusIcon = phase.status === 'completed' ? '[x]' : phase.status === 'in_progress' ? '[~]' : '[ ]'
                const notes = phase.notes ? ` - ${phase.notes}` : ''
                sections.push(`- ${statusIcon} ${phase.title}${notes}`)
              }
            }

            if (planningState.findings && planningState.findings.length > 0) {
              sections.push('\n### Key Findings:')
              for (const finding of planningState.findings) {
                sections.push(`- ${finding}`)
              }
            }

            if (planningState.errors && planningState.errors.length > 0) {
              sections.push('\n### Errors to Avoid:')
              for (const error of planningState.errors) {
                sections.push(`- ${error}`)
              }
            }

            return sections.join('\n') || 'Planning state exists but is empty'
          },
        }),
      },
      config: createConfigHandler(agents),
      'chat.message': async (input, output) => {
        await keywordHooks.onMessage(input, output)
        await sessionHooks.onMessage(input, output)
      },
      'chat.params': paramsHooks.onParams,
      'experimental.chat.system.transform': async (input, output) => {
        const transformInput = input as { sessionID?: string }
        const transformOutput = output as { system: string[] }
        const sessionId = transformInput.sessionID
        if (!sessionId) return
        if (!keywordHooks.isActivated(sessionId)) return
        transformOutput.system.push(ACTIVATION_CONTEXT)
      },
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
          input as { sessionID: string; branch?: string },
          output as { context: string[]; prompt?: string }
        )
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
