import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { join } from 'path'
import { logger } from '../utils/logger'
import { PluginMemoryService } from '../services/plugin-memory'
import { resolveProjectId } from '../services/project-id-resolver'
import { getRepoById } from '../db/queries'
import { getWorkspacePath, getConfigPath } from '@opencode-manager/shared/config/env'
import { parseJsonc } from '@opencode-manager/shared/utils'
import { OPENCODE_SERVER_URL } from '../services/proxy'
import {
  CreateMemoryRequestSchema,
  UpdateMemoryRequestSchema,
  MemoryListQuerySchema,
  KvListQuerySchema,
  PluginConfigSchema,
  CreateKvEntryRequestSchema,
  UpdateKvEntryRequestSchema,
  RalphStateSchema,
  type PluginConfig,
  type RalphState,
} from '@opencode-manager/shared/schemas'

function resolveMemoryDataDir(): string {
  return join(getWorkspacePath(), '.opencode', 'state', 'opencode', 'memory')
}

function resolvePluginConfigPath(): string {
  return join(getConfigPath(), 'memory-config.jsonc')
}

function resolveOldPluginConfigPath(): string {
  return join(resolveMemoryDataDir(), 'config.json')
}

function getDefaultPluginConfig(): PluginConfig {
  return {
    embedding: {
      provider: 'local',
      model: 'all-MiniLM-L6-v2',
      dimensions: 384,
    },
    dedupThreshold: 0.25,
  }
}

function loadPluginConfigFromDisk(): PluginConfig {
  const configPath = resolvePluginConfigPath()

  if (!existsSync(configPath)) {
    const oldPath = resolveOldPluginConfigPath()
    if (existsSync(oldPath)) {
      const configDir = getConfigPath()
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true })
      }
      copyFileSync(oldPath, configPath)
    } else {
      return getDefaultPluginConfig()
    }
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const parsed = parseJsonc(content)
    const result = PluginConfigSchema.safeParse(parsed)

    if (!result.success) {
      logger.error('Invalid plugin config:', result.error)
      return getDefaultPluginConfig()
    }

    return result.data
  } catch (error) {
    logger.error('Failed to load plugin config:', error)
    return getDefaultPluginConfig()
  }
}

function savePluginConfigToDisk(config: PluginConfig): void {
  const configPath = resolvePluginConfigPath()
  const configDir = getConfigPath()

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }

  // Read existing content to preserve comments
  let existingContent = ''
  if (existsSync(configPath)) {
    try {
      existingContent = readFileSync(configPath, 'utf-8')
    } catch {
      // File doesn't exist or can't be read, will create new
    }
  }

  // If we have existing content, preserve comments by extracting them
  // and re-adding them to the new content
  if (existingContent) {
    // Extract comments from existing content
    const lines = existingContent.split('\n')
    const commentLines: string[] = []
    
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('//')) {
        commentLines.push(line.match(/\/\/\s*(.*)/)?.[1] || '')
      }
    }

    // Create new JSON string
    const newContent = JSON.stringify(config, null, 2)
    
    // If we found comments, try to preserve them
    if (commentLines.length > 0) {
      const newLines = newContent.split('\n')
      const result: string[] = []
      
      // Add comments at the beginning
      for (const comment of commentLines) {
        result.push(`// ${comment}`)
      }
      
      result.push(...newLines)
      writeFileSync(configPath, result.join('\n'), 'utf-8')
      return
    }
    
    writeFileSync(configPath, newContent, 'utf-8')
  } else {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  }
}

export function createMemoryRoutes(db: Database): Hono {
  const app = new Hono()
  const pluginMemory = new PluginMemoryService()

  app.get('/', async (c) => {
    const query = c.req.query()
    const parsed = MemoryListQuerySchema.safeParse({
      projectId: query.projectId,
      scope: query.scope,
      content: query.content,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    })

    if (!parsed.success) {
      return c.json({ error: 'Invalid query parameters', details: parsed.error }, 400)
    }

    const filters = parsed.data

    if (!filters.projectId) {
      return c.json({ memories: [] })
    }

    const memories = pluginMemory.list(filters.projectId, {
      scope: filters.scope,
      content: filters.content,
      limit: filters.limit,
      offset: filters.offset,
    })

    return c.json({ memories })
  })

  app.post('/', async (c) => {
    const body = await c.req.json()
    const parsed = CreateMemoryRequestSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error }, 400)
    }

    try {
      const id = pluginMemory.create(parsed.data)
      const memory = pluginMemory.getById(id)

      if (!memory) {
        return c.json({ error: 'Failed to retrieve created memory' }, 500)
      }

      return c.json({ memory }, 201)
    } catch (error) {
      logger.error('Failed to create memory:', error)
      return c.json({ error: 'Failed to create memory' }, 500)
    }
  })

  app.get('/project-summary', async (c) => {
    const repoIdParam = c.req.query('repoId')

    if (!repoIdParam) {
      return c.json({ error: 'Missing repoId parameter' }, 400)
    }

    const repoId = parseInt(repoIdParam, 10)

    if (isNaN(repoId)) {
      return c.json({ error: 'Invalid repoId' }, 400)
    }

    try {
      const repo = getRepoById(db, repoId)

      if (!repo) {
        return c.json({ projectId: null, stats: { total: 0, byScope: {} }, error: 'Repository not found' }, 404)
      }

      const projectId = await resolveProjectId(repo.fullPath)

      if (!projectId) {
        return c.json({ projectId: null, stats: { total: 0, byScope: {} } })
      }

      const stats = pluginMemory.getStats(projectId)
      const kvCount = pluginMemory.getKvCount(projectId)

      return c.json({ projectId, stats, kvCount })
    } catch (error) {
      logger.error('Failed to get project summary:', error)
      return c.json({ projectId: null, stats: { total: 0, byScope: {} }, error: 'Failed to get project summary' }, 500)
    }
  })

  app.get('/stats', async (c) => {
    const projectId = c.req.query('projectId')

    if (!projectId) {
      return c.json({ error: 'Missing projectId parameter' }, 400)
    }

    try {
      const stats = pluginMemory.getStats(projectId)
      return c.json(stats)
    } catch (error) {
      logger.error('Failed to get memory stats:', error)
      return c.json({ error: 'Failed to get stats' }, 500)
    }
  })

  app.get('/resolve-project', async (c) => {
    const repoIdParam = c.req.query('repoId')

    if (!repoIdParam) {
      return c.json({ error: 'Missing repoId parameter' }, 400)
    }

    const repoId = parseInt(repoIdParam, 10)

    if (isNaN(repoId)) {
      return c.json({ error: 'Invalid repoId' }, 400)
    }

    try {
      const repo = getRepoById(db, repoId)

      if (!repo) {
        return c.json({ projectId: null, error: 'Repository not found' }, 404)
      }

      const projectId = await resolveProjectId(repo.fullPath)

      return c.json({ projectId })
    } catch (error) {
      logger.error('Failed to resolve project ID:', error)
      return c.json({ projectId: null, error: 'Failed to resolve project ID' }, 500)
    }
  })

  app.get('/plugin-config', async (c) => {
    try {
      const config = loadPluginConfigFromDisk()
      return c.json({ config })
    } catch (error) {
      logger.error('Failed to get plugin config:', error)
      return c.json({ error: 'Failed to get plugin config' }, 500)
    }
  })

  app.put('/plugin-config', async (c) => {
    try {
      const body = await c.req.json()
      const parsed = PluginConfigSchema.safeParse(body)

      if (!parsed.success) {
        return c.json({ error: 'Invalid config', details: parsed.error.flatten() }, 400)
      }

      const config = parsed.data
      config.dedupThreshold = Math.max(0.05, Math.min(0.4, config.dedupThreshold ?? 0.25))

      savePluginConfigToDisk(config)

      return c.json({ success: true, config })
    } catch (error) {
      logger.error('Failed to save plugin config:', error)
      return c.json({ error: 'Failed to save plugin config' }, 500)
    }
  })

  app.post('/test-embedding', async (c) => {
    try {
      const config = loadPluginConfigFromDisk()

      if (config.embedding.provider === 'local') {
        const validModels = ['all-MiniLM-L6-v2']
        if (!validModels.includes(config.embedding.model)) {
          return c.json({
            success: false,
            error: `Invalid model: ${config.embedding.model}. Valid models: ${validModels.join(', ')}`
          }, 400)
        }
        return c.json({
          success: true,
          message: 'Local provider configured. Model will be loaded on server restart.',
          dimensions: config.embedding.dimensions ?? 384,
        })
      }

      const endpoints: Record<string, string> = {
        openai: 'https://api.openai.com/v1/embeddings',
        voyage: 'https://api.voyageai.com/v1/embeddings',
      }

      const extractHost = (url: string): string => {
        const protocolEnd = url.indexOf('://')
        if (protocolEnd === -1) return url
        const pathStart = url.indexOf('/', protocolEnd + 3)
        return pathStart === -1 ? url : url.slice(0, pathStart)
      }

      const baseUrl = extractHost(config.embedding.baseUrl || '')
      const endpoint = baseUrl
        ? `${baseUrl}/v1/embeddings`
        : endpoints[config.embedding.provider] ?? ''

      if (!endpoint) {
        return c.json({ success: false, error: 'No endpoint configured' }, 400)
      }

      if (!config.embedding.apiKey) {
        return c.json({ success: false, error: 'API key not configured. Please save your API key first.' }, 400)
      }

      const testBody = {
        model: config.embedding.model,
        input: ['test'],
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.embedding.apiKey}`,
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(testBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return c.json({
          success: false,
          error: `API error: ${response.status}`,
          message: errorText,
        }, 400)
      }

      const data = await response.json() as {
        data?: Array<{ embedding: number[] }>
        embeddings?: Array<{ embedding: number[] }>
      }

      const embeddings = data.data || data.embeddings
      if (!embeddings || embeddings.length === 0 || !embeddings[0]) {
        return c.json({ success: false, error: 'Invalid response from API' }, 400)
      }

      const firstEmbedding = embeddings[0]
      const actualDimensions = firstEmbedding.embedding.length

      return c.json({
        success: true,
        message: `Embedding test successful. Generated ${actualDimensions}d embedding.`,
        dimensions: actualDimensions,
      })
    } catch (error) {
      logger.error('Failed to test embedding config:', error)
      return c.json({ 
        success: false, 
        error: 'Failed to test embedding configuration',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/reindex', async (c) => {
    try {
      const db = pluginMemory.getDb()

      if (!db) {
        return c.json({ 
          error: 'Memory database not found. Make sure the memory plugin has been initialized.',
          total: 0,
          embedded: 0,
          failed: 0
        }, 404)
      }

      const memories = pluginMemory.listAll()
      
      if (memories.length === 0) {
        return c.json({
          success: true,
          message: 'No memories to reindex',
          total: 0,
          embedded: 0,
          failed: 0
        })
      }

      try {
        db.exec('DELETE FROM memory_embeddings')
      } catch {
        return c.json({
          success: true,
          message: 'Cleared embeddings. Server restart required to regenerate embeddings with new model.',
          total: memories.length,
          embedded: 0,
          failed: 0,
          requiresRestart: true
        })
      }

      return c.json({
        success: true,
        message: `Cleared ${memories.length} embeddings. Server restart required to regenerate embeddings.`,
        total: memories.length,
        embedded: 0,
        failed: 0,
        requiresRestart: true
      })
    } catch (error) {
      logger.error('Failed to reindex memories:', error)
      return c.json({ error: 'Failed to reindex memories', details: error instanceof Error ? error.message : 'Unknown error' }, 500)
    }
  })

  app.get('/kv', async (c) => {
    const query = c.req.query()
    const parsed = KvListQuerySchema.safeParse({
      projectId: query.projectId,
      prefix: query.prefix,
    })

    if (!parsed.success) {
      return c.json({ error: 'Invalid query parameters', details: parsed.error }, 400)
    }

    const { projectId, prefix } = parsed.data
    const entries = pluginMemory.listKv(projectId, prefix)
    return c.json({ entries })
  })

  app.post('/kv', async (c) => {
    const body = await c.req.json()
    const parsed = CreateKvEntryRequestSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error }, 400)
    }

    try {
      pluginMemory.setKv(parsed.data.projectId, parsed.data.key, parsed.data.data, parsed.data.ttlMs)
      const entry = pluginMemory.getKv(parsed.data.projectId, parsed.data.key)
      return c.json({ entry }, 201)
    } catch (error) {
      logger.error('Failed to create KV entry:', error)
      return c.json({ error: 'Failed to create KV entry' }, 500)
    }
  })

  app.put('/kv/:key', async (c) => {
    const key = decodeURIComponent(c.req.param('key'))
    const projectId = c.req.query('projectId')

    if (!projectId) {
      return c.json({ error: 'Missing projectId parameter' }, 400)
    }

    const body = await c.req.json()
    const parsed = UpdateKvEntryRequestSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error }, 400)
    }

    try {
      pluginMemory.setKv(projectId, key, parsed.data.data, parsed.data.ttlMs)
      const entry = pluginMemory.getKv(projectId, key)
      return c.json({ entry })
    } catch (error) {
      logger.error('Failed to update KV entry:', error)
      return c.json({ error: 'Failed to update KV entry' }, 500)
    }
  })

  app.delete('/kv/:key', async (c) => {
    const key = decodeURIComponent(c.req.param('key'))
    const projectId = c.req.query('projectId')

    if (!projectId) {
      return c.json({ error: 'Missing projectId parameter' }, 400)
    }

    try {
      pluginMemory.deleteKv(projectId, key)
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete KV entry:', error)
      return c.json({ error: 'Failed to delete KV entry' }, 500)
    }
  })

  app.get('/ralph/status', async (c) => {
    const repoIdParam = c.req.query('repoId')

    if (!repoIdParam) {
      return c.json({ error: 'Missing repoId' }, 400)
    }

    const repoId = parseInt(repoIdParam, 10)

    if (isNaN(repoId)) {
      return c.json({ error: 'Invalid repoId' }, 400)
    }

    try {
      const repo = getRepoById(db, repoId)

      if (!repo) {
        return c.json({ loops: [], projectId: null })
      }

      const projectId = await resolveProjectId(repo.fullPath)

      if (!projectId) {
        return c.json({ loops: [], projectId: null })
      }

      const entries = pluginMemory.listKv(projectId, 'ralph:')
      const loops = entries
        .map(e => e.data)
        .filter((data): data is Record<string, unknown> =>
          data !== null && typeof data === 'object' && 'active' in data
        )
        .map(data => {
          const result = RalphStateSchema.safeParse(data)
          return result.success ? result.data : null
        })
        .filter((loop): loop is RalphState => loop !== null)

      return c.json({ loops, projectId })
    } catch (error) {
      logger.error('Failed to get Ralph status:', error)
      return c.json({ error: 'Failed to get Ralph status' }, 500)
    }
  })

  app.post('/ralph/cancel', async (c) => {
    try {
      const body = await c.req.json()
      const { repoId, worktreeName, sessionId } = body

      if (!repoId || (!worktreeName && !sessionId)) {
        return c.json({ error: 'Missing repoId or identifier (worktreeName or sessionId)' }, 400)
      }

      const repo = getRepoById(db, parseInt(repoId, 10))

      if (!repo) {
        return c.json({ cancelled: false })
      }

      const projectId = await resolveProjectId(repo.fullPath)

      if (!projectId) {
        return c.json({ cancelled: false })
      }

      let worktreeNameToUse: string | undefined

      if (worktreeName) {
        worktreeNameToUse = worktreeName
      } else if (sessionId) {
        const sessionMappingEntry = pluginMemory.getKv(projectId, `ralph-session:${sessionId}`)
        if (!sessionMappingEntry) {
          return c.json({ cancelled: false })
        }
        worktreeNameToUse = sessionMappingEntry.data as string
      }

      if (!worktreeNameToUse) {
        return c.json({ cancelled: false })
      }

      const kvEntry = pluginMemory.getKv(projectId, `ralph:${worktreeNameToUse}`)
      if (!kvEntry) {
        return c.json({ cancelled: false })
      }

      const result = RalphStateSchema.safeParse(kvEntry.data)

      if (!result.success) {
        logger.warn('Failed to parse Ralph state for cancel:', result.error)
        return c.json({ cancelled: false })
      }

      const state = result.data

      if (!state.active) {
        return c.json({ cancelled: false })
      }

      const updatedState = {
        ...state,
        active: false,
        terminationReason: 'cancelled',
        completedAt: new Date().toISOString(),
      }

      pluginMemory.setKv(projectId, `ralph:${worktreeNameToUse}`, updatedState)

      try {
        const abortUrl = new URL(`${OPENCODE_SERVER_URL}/session/${state.sessionId}/abort`)
        abortUrl.searchParams.set('directory', repo.fullPath)
        await fetch(abortUrl.toString(), { method: 'POST' })
      } catch {
        // Session may already be idle
      }

      return c.json({ cancelled: true, worktreeName: state.worktreeName })
    } catch (error) {
      logger.error('Failed to cancel Ralph loop:', error)
      return c.json({ error: 'Failed to cancel Ralph loop' }, 500)
    }
  })

  app.get('/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10)

    if (isNaN(id)) {
      return c.json({ error: 'Invalid memory ID' }, 400)
    }

    const memory = pluginMemory.getById(id)

    if (!memory) {
      return c.json({ error: 'Memory not found' }, 404)
    }

    return c.json({ memory })
  })

  app.put('/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10)

    if (isNaN(id)) {
      return c.json({ error: 'Invalid memory ID' }, 400)
    }

    const body = await c.req.json()
    const parsed = UpdateMemoryRequestSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error }, 400)
    }

    try {
      pluginMemory.update(id, parsed.data)
      const memory = pluginMemory.getById(id)
      return c.json({ memory })
    } catch (error) {
      logger.error('Failed to update memory:', error)
      return c.json({ error: 'Failed to update memory' }, 500)
    }
  })

  app.delete('/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10)

    if (isNaN(id)) {
      return c.json({ error: 'Invalid memory ID' }, 400)
    }

    try {
      pluginMemory.delete(id)
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete memory:', error)
      return c.json({ error: 'Failed to delete memory' }, 500)
    }
  })

  return app
}
