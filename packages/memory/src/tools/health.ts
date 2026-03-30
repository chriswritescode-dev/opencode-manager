import { tool } from '@opencode-ai/plugin'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import type { ToolContext, DimensionMismatchState } from './types'
import { withDimensionWarning } from './types'
import { VERSION } from '../version'
import type { HealthStatus, PluginConfig } from '../types'
import type { EmbeddingProvider } from '../embedding'
import { isServerRunning, checkServerHealth } from '../embedding'
import { createMetadataQuery } from '../storage'
import { checkForUpdate, formatUpgradeCheck, performUpgrade } from '../utils/upgrade'
import type { VecService } from '../storage/vec-types'
import type { MemoryService } from '../services/memory'

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
    lines.push('  Reindex needed - run memory-health with action "reindex"')
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

export async function autoValidateOnLoad(
  projectId: string,
  memoryService: MemoryService,
  db: Database,
  config: PluginConfig,
  provider: EmbeddingProvider,
  dataDir: string,
  mismatchState: DimensionMismatchState,
  vec: VecService,
  logger: { log: (message: string) => void },
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

export function createHealthTools(ctx: ToolContext): Record<string, ReturnType<typeof tool>> {
  const { projectId, db, config, provider, dataDir, memoryService, logger, cleanup, input, mismatchState, initState } = ctx
  const getCurrentVec = ctx.getCurrentVec

  return {
    'memory-health': tool({
      description: 'Check memory plugin health or trigger a reindex of all embeddings. Use action "check" (default) to view status, "reindex" to regenerate all embeddings when model has changed or embeddings are missing, "upgrade" to update the plugin to the latest version, or "reload" to reload the plugin without restarting OpenCode. Always report the plugin version from the output. Never run reindex unless the user explicitly asks for it.',
      args: {
        action: z.enum(['check', 'reindex', 'upgrade', 'reload']).optional().default('check').describe('Action to perform: "check" for health status, "reindex" to regenerate embeddings, "upgrade" to update plugin, "reload" to reload the plugin without restarting OpenCode'),
      },
      execute: async (args) => {
        if (args.action === 'reload') {
          logger.log('memory-health: reload triggered via health tool')
          await cleanup()
          ctx.v2.instance.dispose().catch(() => {})
          return 'Plugin reload triggered. The instance will reinitialize on next interaction.'
        }
        if (args.action === 'upgrade') {
          const result = await performUpgrade(async (cacheDir, version) => {
            const pkg = `@opencode-manager/memory@${version}`
            const output = await input.$`bun add --force --no-cache --exact --cwd ${cacheDir} ${pkg}`.nothrow().quiet()
            return { exitCode: output.exitCode, stderr: output.stderr.toString() }
          })
          if (result.upgraded) {
            logger.log(`memory-health: upgrade successful (${result.from} -> ${result.to}), triggering reload`)
            await cleanup()
            ctx.v2.instance.dispose().catch(() => {})
            return `${result.message}. Reloading plugin — new version will be active on next interaction.`
          }
          return result.message
        }
        if (args.action === 'reindex') {
          if (!getCurrentVec().available) {
            return 'Reindex unavailable: vector service is still initializing. Try again in a few seconds.'
          }
          return executeReindex(projectId, memoryService, db, config, provider, mismatchState, getCurrentVec())
        }
        const [healthResult, updateCheck] = await Promise.all([
          executeHealthCheck(projectId, db, config, provider, dataDir),
          checkForUpdate(),
        ])
        const versionLine = formatUpgradeCheck(updateCheck)
        const initInfo = `\nInit: ${initState.vecReady ? 'vec ready' : 'vec pending'}${initState.syncRunning ? ', sync in progress' : initState.syncComplete ? ', sync complete' : ''}`
        return withDimensionWarning(mismatchState, healthResult + initInfo + '\n' + versionLine)
      },
    }),
  }
}
