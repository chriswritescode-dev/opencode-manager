import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { initializeDatabase } from './db/schema'
import { createRepoRoutes } from './routes/repos'
import { createSettingsRoutes } from './routes/settings'
import { createHealthRoutes } from './routes/health'

import { createFileRoutes } from './routes/files'
import { createProvidersRoutes } from './routes/providers'
import { ensureDirectoryExists, writeFileContent } from './services/file-operations'
import { SettingsService } from './services/settings'
import { opencodeServerManager } from './services/opencode-single-server'
import { cleanupOrphanedDirectories } from './services/repo'
import { proxyRequest } from './services/proxy'
import { logger } from './utils/logger'
import { 
  getWorkspacePath, 
  getReposPath, 
  getConfigPath,
  getOpenCodeConfigFilePath,
  getDatabasePath,
  ENV
} from './config'

const { PORT, HOST } = ENV.SERVER
const DB_PATH = getDatabasePath()

const app = new Hono()

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

const db = initializeDatabase(DB_PATH)

async function syncDefaultConfigToDisk(): Promise<void> {
  const settingsService = new SettingsService(db)
  const defaultConfig = settingsService.getDefaultOpenCodeConfig()
  
  if (defaultConfig) {
    const configPath = getOpenCodeConfigFilePath()
    const configContent = JSON.stringify(defaultConfig.content, null, 2)
    await writeFileContent(configPath, configContent)
    logger.info(`Synced default config '${defaultConfig.name}' to: ${configPath}`)
  } else {
    logger.info('No default OpenCode config found in database')
  }
}

try {
  await ensureDirectoryExists(getWorkspacePath())
  await ensureDirectoryExists(getReposPath())
  await ensureDirectoryExists(getConfigPath())
  logger.info('Workspace directories initialized')
  
  await cleanupOrphanedDirectories(db)
  logger.info('Orphaned directory cleanup completed')
  
  await syncDefaultConfigToDisk()
  
  await opencodeServerManager.start()
  logger.info(`OpenCode server running on port ${opencodeServerManager.getPort()}`)
} catch (error) {
  logger.error('Failed to initialize workspace:', error)
}

app.route('/api/repos', createRepoRoutes(db))
app.route('/api/settings', createSettingsRoutes(db))
app.route('/api/health', createHealthRoutes(db))
app.route('/api/files', createFileRoutes(db))
app.route('/api/providers', createProvidersRoutes())

app.all('/api/opencode/*', async (c) => {
  const request = c.req.raw
  return proxyRequest(request)
})

const isProduction = ENV.SERVER.NODE_ENV === 'production'

if (isProduction) {
  app.use('/*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) {
      return next()
    }
    return serveStatic({ root: './frontend/dist' })(c, next)
  })
  app.get('*', async (c) => {
    return serveStatic({ path: './frontend/dist/index.html' })(c, async () => {})
  })
} else {
  app.get('/', (c) => {
    return c.json({
      name: 'OpenCode WebUI',
      version: '2.0.0',
      status: 'running',
      endpoints: {
        health: '/api/health',
        repos: '/api/repos',
        settings: '/api/settings',
        sessions: '/api/sessions',
        files: '/api/files',
        providers: '/api/providers',
        opencode_proxy: '/api/opencode/*'
      }
    })
  })

  app.get('/api/network-info', async (c) => {
    const os = await import('os')
    const interfaces = os.networkInterfaces()
    const ips = Object.values(interfaces)
      .flat()
      .filter(info => info && !info.internal && info.family === 'IPv4')
      .map(info => info!.address)
    
    const requestHost = c.req.header('host') || `localhost:${PORT}`
    const protocol = c.req.header('x-forwarded-proto') || 'http'
    
    return c.json({
      host: HOST,
      port: PORT,
      requestHost,
      protocol,
      availableIps: ips,
      apiUrls: [
        `${protocol}://localhost:${PORT}`,
        ...ips.map(ip => `${protocol}://${ip}:${PORT}`)
      ]
    })
  })
}

let isShuttingDown = false

const shutdown = async (signal: string) => {
  if (isShuttingDown) return
  isShuttingDown = true
  
  logger.info(`${signal} received, shutting down gracefully...`)
  try {
    await opencodeServerManager.stop()
    logger.info('OpenCode server stopped')
  } catch (error) {
    logger.error('Error stopping OpenCode server:', error)
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

serve({
  fetch: app.fetch,
  port: PORT,
  hostname: HOST,
})

logger.info(`🚀 OpenCode WebUI API running on http://${HOST}:${PORT}`)
