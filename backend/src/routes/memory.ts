import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { logger } from '../utils/logger'
import { PluginMemoryService } from '../services/plugin-memory'
import { resolveProjectId } from '../services/project-id-resolver'
import { getRepoById } from '../db/queries'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import {
  CreateMemoryRequestSchema,
  UpdateMemoryRequestSchema,
  MemoryListQuerySchema,
  PluginConfigSchema,
  type PluginConfig,
} from '@opencode-manager/shared/schemas'

function resolveMemoryDataDir(): string {
  return join(getWorkspacePath(), '.opencode', 'state', 'opencode', 'memory')
}

function resolvePluginConfigPath(): string {
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
    return getDefaultPluginConfig()
  }
  
  try {
    const content = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content)
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
  const dataDir = resolveMemoryDataDir()
  
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }
  
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
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

      return c.json({ projectId, stats })
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

  return app
}
