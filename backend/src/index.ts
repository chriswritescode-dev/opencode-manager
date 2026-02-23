import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import os from 'os'
import path from 'path'
import { readFile } from 'fs/promises'
import { initializeDatabase } from './db/schema'
import { createRepoRoutes } from './routes/repos'
import { createIPCServer, type IPCServer } from './ipc/ipcServer'
import { GitAuthService } from './services/git-auth'
import { createSettingsRoutes } from './routes/settings'
import { createHealthRoutes } from './routes/health'
import { createTTSRoutes, cleanupExpiredCache } from './routes/tts';
import { createSTTRoutes } from './routes/stt'
import { createFileRoutes } from './routes/files'

async function getAppVersion(): Promise<string> {
  try {
    const packageUrl = new URL('../../package.json', import.meta.url)
    const packageJsonRaw = await readFile(packageUrl, 'utf-8')
    const packageJson = JSON.parse(packageJsonRaw) as { version?: string }
    return packageJson.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
import { createProvidersRoutes } from './routes/providers'
import { createOAuthRoutes } from './routes/oauth'
import { createTitleRoutes } from './routes/title'
import { createSSERoutes } from './routes/sse'
import { createSSHRoutes } from './routes/ssh'
import { createNotificationRoutes } from './routes/notifications'
import { createMemoryRoutes } from './routes/memory'
import { createMcpOauthProxyRoutes } from './routes/mcp-oauth-proxy'
import { createAuthRoutes, createAuthInfoRoutes, syncAdminFromEnv } from './routes/auth'
import { createAuth } from './auth'
import { createAuthMiddleware } from './auth/middleware'
import { sseAggregator } from './services/sse-aggregator'
import { ensureDirectoryExists, writeFileContent, fileExists, readFileContent } from './services/file-operations'
import { SettingsService } from './services/settings'
import { opencodeServerManager } from './services/opencode-single-server'
import { proxyRequest, proxyMcpAuthStart, proxyMcpAuthAuthenticate } from './services/proxy'
import { NotificationService } from './services/notification'

import { logger } from './utils/logger'
import { 
  getWorkspacePath, 
  getReposPath, 
  getConfigPath,
  getOpenCodeConfigFilePath,
  getAgentsMdPath,
  getDatabasePath,
  ENV
} from '@opencode-manager/shared/config/env'
import { OpenCodeConfigSchema } from '@opencode-manager/shared/schemas'
import stripJsonComments from 'strip-json-comments'

const { PORT, HOST } = ENV.SERVER
const DB_PATH = getDatabasePath()

const app = new Hono()

app.use('/*', cors({
  origin: (origin) => {
    const trustedOrigins = ENV.AUTH.TRUSTED_ORIGINS.split(',').map(o => o.trim())
    if (!origin) return trustedOrigins[0]
    if (trustedOrigins.includes(origin)) return origin
    return trustedOrigins[0]
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

const db = initializeDatabase(DB_PATH)
const auth = createAuth(db)
const requireAuth = createAuthMiddleware(auth)

import { DEFAULT_AGENTS_MD } from './constants'

let ipcServer: IPCServer | undefined
const gitAuthService = new GitAuthService()

async function ensureDefaultConfigExists(): Promise<void> {
  const settingsService = new SettingsService(db)
  const workspaceConfigPath = getOpenCodeConfigFilePath()
  
  if (await fileExists(workspaceConfigPath)) {
    logger.info(`Found workspace config at ${workspaceConfigPath}, syncing to database...`)
    try {
      const rawContent = await readFileContent(workspaceConfigPath)
      const parsed = JSON.parse(stripJsonComments(rawContent))
      const validation = OpenCodeConfigSchema.safeParse(parsed)
      
      if (!validation.success) {
        logger.warn('Workspace config has invalid structure', validation.error)
      } else {
        const existingDefault = settingsService.getOpenCodeConfigByName('default')
        if (existingDefault) {
          settingsService.updateOpenCodeConfig('default', {
            content: rawContent,
            isDefault: true,
          })
          logger.info('Updated database config from workspace file')
        } else {
          settingsService.createOpenCodeConfig({
            name: 'default',
            content: rawContent,
            isDefault: true,
          })
          logger.info('Created database config from workspace file')
        }
        return
      }
    } catch (error) {
      logger.warn('Failed to read workspace config', error)
    }
  }
  
  const homeConfigPath = path.join(os.homedir(), '.config/opencode/opencode.json')
  if (await fileExists(homeConfigPath)) {
    logger.info(`Found home config at ${homeConfigPath}, importing...`)
    try {
      const rawContent = await readFileContent(homeConfigPath)
      const parsed = JSON.parse(stripJsonComments(rawContent))
      const validation = OpenCodeConfigSchema.safeParse(parsed)
      
      if (validation.success) {
        const existingDefault = settingsService.getOpenCodeConfigByName('default')
        if (existingDefault) {
          settingsService.updateOpenCodeConfig('default', {
            content: rawContent,
            isDefault: true,
          })
        } else {
          settingsService.createOpenCodeConfig({
            name: 'default',
            content: rawContent,
            isDefault: true,
          })
        }
        
        await writeFileContent(workspaceConfigPath, rawContent)
        logger.info('Imported home config to workspace')
        return
      }
    } catch (error) {
      logger.warn('Failed to import home config', error)
    }
  }
  
  const existingDbConfigs = settingsService.getOpenCodeConfigs()
  if (existingDbConfigs.configs.length > 0) {
    const defaultConfig = settingsService.getDefaultOpenCodeConfig()
    if (defaultConfig) {
      await writeFileContent(workspaceConfigPath, defaultConfig.rawContent)
      logger.info('Wrote existing database config to workspace file')
    }
    return
  }
  
  logger.info('No existing config found, creating minimal seed config')
  const seedConfig = JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2)
  settingsService.createOpenCodeConfig({
    name: 'default',
    content: seedConfig,
    isDefault: true,
  })
  await writeFileContent(workspaceConfigPath, seedConfig)
  logger.info('Created minimal seed config')
}

async function ensureDefaultAgentsMdExists(): Promise<void> {
  const agentsMdPath = getAgentsMdPath()
  const exists = await fileExists(agentsMdPath)
  
  if (!exists) {
    await writeFileContent(agentsMdPath, DEFAULT_AGENTS_MD)
    logger.info(`Created default AGENTS.md at: ${agentsMdPath}`)
  }
}

try {
  if (ENV.SERVER.NODE_ENV === 'production' && !ENV.AUTH.SECRET) {
    logger.error('AUTH_SECRET is required in production mode')
    logger.error('Generate one with: openssl rand -base64 32')
    logger.error('Set it as environment variable: AUTH_SECRET=your-secret')
    process.exit(1)
  }

  await ensureDirectoryExists(getWorkspacePath())
  await ensureDirectoryExists(getReposPath())
  await ensureDirectoryExists(getConfigPath())
  logger.info('Workspace directories initialized')

  await cleanupExpiredCache()

  await ensureDefaultConfigExists()
  await ensureDefaultAgentsMdExists()

  const settingsService = new SettingsService(db)
  settingsService.initializeLastKnownGoodConfig()

  ipcServer = await createIPCServer(process.env.STORAGE_PATH || undefined)
  await gitAuthService.initialize(ipcServer, db)
  logger.info(`Git IPC server running at ${ipcServer.ipcHandlePath}`)

  opencodeServerManager.setDatabase(db)
  await opencodeServerManager.start()
  logger.info(`OpenCode server running on port ${opencodeServerManager.getPort()}`)

  await syncAdminFromEnv(auth, db)
} catch (error) {
  logger.error('Failed to initialize workspace:', error)
}

const notificationService = new NotificationService(db)

if (ENV.VAPID.PUBLIC_KEY && ENV.VAPID.PRIVATE_KEY) {
  if (!ENV.VAPID.SUBJECT) {
    logger.warn('VAPID_SUBJECT is not set — push notifications require a mailto: subject (e.g. mailto:you@example.com)')
  } else if (!ENV.VAPID.SUBJECT.startsWith('mailto:')) {
    logger.warn(`VAPID_SUBJECT="${ENV.VAPID.SUBJECT}" does not use mailto: format — iOS/Safari push notifications will fail`)
  }

  notificationService.configureVapid({
    publicKey: ENV.VAPID.PUBLIC_KEY,
    privateKey: ENV.VAPID.PRIVATE_KEY,
    subject: ENV.VAPID.SUBJECT || 'mailto:push@localhost',
  })
  sseAggregator.onEvent((directory, event) => {
    notificationService.handleSSEEvent(directory, event).catch((err) => {
      logger.error('Push notification dispatch error:', err)
    })
  })
}

app.route('/api/auth', createAuthRoutes(auth))
app.route('/api/auth-info', createAuthInfoRoutes(auth, db))

app.route('/api/mcp-oauth-proxy', createMcpOauthProxyRoutes(requireAuth))

const protectedApi = new Hono()
protectedApi.use('/*', requireAuth)

protectedApi.route('/health', createHealthRoutes(db))
protectedApi.route('/repos', createRepoRoutes(db, gitAuthService))
protectedApi.route('/settings', createSettingsRoutes(db))
protectedApi.route('/files', createFileRoutes())
protectedApi.route('/providers', createProvidersRoutes())
protectedApi.route('/oauth', createOAuthRoutes())
protectedApi.route('/tts', createTTSRoutes(db))
protectedApi.route('/stt', createSTTRoutes(db))
protectedApi.route('/generate-title', createTitleRoutes())
protectedApi.route('/sse', createSSERoutes())
protectedApi.route('/ssh', createSSHRoutes(gitAuthService))
protectedApi.route('/notifications', createNotificationRoutes(notificationService))
protectedApi.route('/memory', createMemoryRoutes(db))

app.route('/api', protectedApi)

app.post('/api/opencode/mcp/:name/auth', requireAuth, async (c) => {
  const serverName = c.req.param('name')
  const directory = c.req.query('directory')
  return proxyMcpAuthStart(serverName, directory)
})

app.post('/api/opencode/mcp/:name/auth/authenticate', requireAuth, async (c) => {
  const serverName = c.req.param('name')
  const directory = c.req.query('directory')
  return proxyMcpAuthAuthenticate(serverName, directory)
})

app.all('/api/opencode/*', requireAuth, async (c) => {
  const request = c.req.raw
  return proxyRequest(request)
})

const isProduction = ENV.SERVER.NODE_ENV === 'production'

if (isProduction) {
  app.use('/*', async (c, next) => {
    await next()
    if (c.req.path === '/sw.js') {
      c.res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
      c.res.headers.set('Pragma', 'no-cache')
      c.res.headers.set('Expires', '0')
    }
  })

  app.use('/*', serveStatic({ root: './frontend/dist' }))
  
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.notFound()
    }
    const fs = await import('fs/promises')
    const path = await import('path')
    const indexPath = path.join(process.cwd(), 'frontend/dist/index.html')
    const html = await fs.readFile(indexPath, 'utf-8')
    return c.html(html)
  })
} else {
  app.get('/', async (c) => {
    const version = await getAppVersion()
    return c.json({
      name: 'OpenCode WebUI',
      version,
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
    sseAggregator.shutdown()
    logger.info('SSE Aggregator stopped')
    if (ipcServer) {
      await ipcServer.dispose()
      logger.info('Git IPC server stopped')
    }
    await opencodeServerManager.stop()
    logger.info('OpenCode server stopped')
  } catch (error) {
    logger.error('Error during shutdown:', error)
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
