import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
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
import { createFilesystemRoutes } from './routes/filesystem'
import { createScheduleRoutes } from './routes/schedules'

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
import { createSSERoutes } from './routes/sse'
import { createSSHRoutes } from './routes/ssh'
import { createNotificationRoutes } from './routes/notifications'
import { createMcpOauthProxyRoutes } from './routes/mcp-oauth-proxy'
import { createAuthRoutes, createAuthInfoRoutes, syncAdminFromEnv } from './routes/auth'
import { createAuth } from './auth'
import { createAuthMiddleware } from './auth/middleware'
import { createPromptTemplateRoutes } from './routes/prompt-templates'
import { createSessionPinRoutes } from './routes/session-pins'
import { createLogRoutes } from './routes/logs'
import { createInternalRoutes } from './routes/internal'
import { sweepStaleUploadSessions } from './routes/internal/repo-mirror-helpers'
import { createOpenCodeProxyRoutes } from './routes/opencode-proxy'
import { createAuthenticatedOpenCodeProxyRoutes } from './routes/opencode-auth-proxy'
import { sseAggregator } from './services/sse-aggregator'
import { ensureDirectoryExists, writeFileContent, fileExists } from './services/file-operations'
import { SettingsService } from './services/settings'
import { opencodeServerManager } from './services/opencode-single-server'
import { createOpenCodeClient } from './services/opencode/client'
import { NotificationService } from './services/notification'
import { ScheduleRunner, ScheduleService } from './services/schedules'
import { CredentialProvider } from './services/credential-provider'
import { ScheduleWorktreeManager } from './services/schedule-worktree'
import { migrateGlobalSkills } from './services/skills'
import { installAssistantWorkspace } from './services/assistant-mode'
import { detectSandboxCapability } from './services/sandbox/capability'
import { SandboxRuntimeService, stopWorkspaceSandboxOnShutdown } from './services/sandbox/runtime'
import { getOpenCodeImportStatus, syncOpenCodeImport } from './services/opencode-import'
import { readOpenCodeConfigFile } from './services/opencode-config-file'
import { seedOpenCodeConfigFile } from './services/opencode-config-apply'
import { OpenCodeSupervisor } from './services/opencode-supervisor'
import { OpenCodeRestartCoordinator } from './services/opencode-restart-coordinator'
import { setOpenCodeRestartCoordinator } from './services/opencode-restart'
import { logger } from './utils/logger'
import { 
  getWorkspacePath, 
  getReposPath, 
  getConfigPath,
  getAgentsMdPath,
  getDatabasePath,
  ENV
} from '@opencode-manager/shared/config/env'


const { PORT, HOST } = ENV.SERVER
const DB_PATH = getDatabasePath()

const app = new Hono()

/**
 * Route prefixes reachable from custom WebViews whose origin is not a
 * trusted web origin (e.g. "null" for file://). These routes authenticate via
 * Bearer/CF-Access headers rather than cookies, so any origin may be reflected.
 */
const REFLECT_ANY_ORIGIN_PREFIXES = ['/api/opencode-proxy/', '/api/internal/']

app.use('/*', cors({
  origin: (origin, c) => {
    if (origin && REFLECT_ANY_ORIGIN_PREFIXES.some(prefix => c.req.path.startsWith(prefix))) {
      return origin
    }
    const trustedOrigins = ENV.AUTH.TRUSTED_ORIGINS.split(',').map(o => o.trim())
    if (!origin) return trustedOrigins[0]
    if (trustedOrigins.includes(origin)) return origin
    return trustedOrigins[0]
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'CF-Access-Client-Id', 'CF-Access-Client-Secret'],
  credentials: true,
}))

const db = initializeDatabase(DB_PATH)
const auth = createAuth(db)
const requireAuth = createAuthMiddleware(auth)
const openCodeClient = createOpenCodeClient(
  () => new SettingsService(db).getOpenCodeServerPassword(),
  () => opencodeServerManager.getEffectiveServerHost(),
)

import { DEFAULT_AGENTS_MD } from './constants'

let ipcServer: IPCServer | undefined
const gitAuthService = new GitAuthService()
let openCodeSupervisor: OpenCodeSupervisor | undefined
async function ensureOpenCodeConfigFileExists(): Promise<void> {
  const existing = await readOpenCodeConfigFile()
  if (existing) {
    if (!existing.isValid) {
      logger.warn('OpenCode config file has validation issues', existing.validationIssues)
    }
    return
  }

  const status = await getOpenCodeImportStatus()
  if (status.configSourcePath) {
    logger.info(`Found importable OpenCode config at ${status.configSourcePath}, importing...`)
    try {
      const result = await syncOpenCodeImport({ overwriteState: false, status })
      if (result.configImported) {
        logger.info(`Imported OpenCode config from ${status.configSourcePath} to workspace`)
        return
      }
    } catch (error) {
      logger.warn(`Failed to import OpenCode config from ${status.configSourcePath}`, error)
    }
  }

  await seedOpenCodeConfigFile()
  logger.info('Created minimal seed config')
}

async function ensureHomeStateImported(): Promise<void> {
  try {
    const status = await getOpenCodeImportStatus()
    if (status.workspaceStateExists) {
      return
    }

    if (!status.stateSourcePath) {
      return
    }

    const result = await syncOpenCodeImport({ overwriteState: false, importConfig: false, status })
    if (result.stateImported) {
      logger.info(`Imported OpenCode state from ${status.stateSourcePath}`)
    }
  } catch (error) {
    logger.warn('Failed to import OpenCode state, continuing without imported state', error)
  }
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
  await sweepStaleUploadSessions()

  await ensureOpenCodeConfigFileExists()
  await ensureHomeStateImported()
  await ensureDefaultAgentsMdExists()

  const settingsService = new SettingsService(db)
  settingsService.initializeLastKnownGoodConfig()

  openCodeSupervisor = new OpenCodeSupervisor(opencodeServerManager, settingsService)

  await migrateGlobalSkills()

  await installAssistantWorkspace({ db })
  logger.info('Assistant workspace installed')

  ipcServer = await createIPCServer(process.env.STORAGE_PATH || undefined)
  await gitAuthService.initialize(ipcServer, db)
  logger.info(`Git IPC server running at ${ipcServer.ipcHandlePath}`)

  await syncAdminFromEnv(auth, db)

  opencodeServerManager.setDatabase(db)
  detectSandboxCapability()
  void new SandboxRuntimeService(db).prepareWorkspaceSandboxOnBoot().catch((error) => {
    logger.warn('Workspace sandbox preparation failed:', error)
  })
  const openCodeStatus = await openCodeSupervisor.start()
  if (openCodeStatus.healthy) {
    logger.info(`OpenCode server running on port ${openCodeStatus.port}`)
  } else {
    logger.warn(`OpenCode server unavailable after startup recovery: ${openCodeStatus.lastError ?? openCodeStatus.state}`)
  }

} catch (error) {
  logger.error('Failed to initialize workspace:', error)
}

const settingsServiceForSchedules = new SettingsService(db)
const credentialProvider = new CredentialProvider(db)
const scheduleWorktreeManager = new ScheduleWorktreeManager(gitAuthService, settingsServiceForSchedules, credentialProvider, db, openCodeClient)
const scheduleService = new ScheduleService(db, openCodeClient, scheduleWorktreeManager)
const scheduleRunnerInstance = new ScheduleRunner(scheduleService)

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

sseAggregator.setPendingActionsFetcher(openCodeClient)
sseAggregator.setPasswordResolver(() => new SettingsService(db).getOpenCodeServerPassword())
sseAggregator.start()

sseAggregator.setScheduledSessionsResolver(
  () => scheduleService.getActiveRunSessions(),
)

const openCodeRestartCoordinator = new OpenCodeRestartCoordinator(openCodeClient, sseAggregator)
setOpenCodeRestartCoordinator(openCodeRestartCoordinator)

void scheduleRunnerInstance.start()

const settingsService = new SettingsService(db)

app.route('/api/auth', createAuthRoutes(auth))
app.route('/api/auth-info', createAuthInfoRoutes(auth, db))
app.route('/api/health', createHealthRoutes(db, openCodeSupervisor))

app.route('/api/mcp-oauth-proxy', createMcpOauthProxyRoutes(openCodeClient, requireAuth))
app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService, openCodeClient))
app.route('/api/opencode-proxy', createOpenCodeProxyRoutes(db, settingsService))

const protectedApi = new Hono()
protectedApi.use('/*', requireAuth)

protectedApi.route('/repos', createRepoRoutes(db, gitAuthService, scheduleService, openCodeClient))
protectedApi.route('/settings', createSettingsRoutes(db, gitAuthService, openCodeClient, openCodeSupervisor))
  protectedApi.route('/files', createFileRoutes())
  protectedApi.route('/filesystem', createFilesystemRoutes())
protectedApi.route('/providers', createProvidersRoutes(openCodeClient, openCodeSupervisor))
protectedApi.route('/oauth', createOAuthRoutes(openCodeClient, openCodeSupervisor))
protectedApi.route('/tts', createTTSRoutes(db))
protectedApi.route('/stt', createSTTRoutes(db))
protectedApi.route('/sse', createSSERoutes())
protectedApi.route('/ssh', createSSHRoutes(gitAuthService))
protectedApi.route('/notifications', createNotificationRoutes(notificationService))
protectedApi.route('/prompt-templates', createPromptTemplateRoutes(db))
protectedApi.route('/session-pins', createSessionPinRoutes(db))
protectedApi.route('/schedules', createScheduleRoutes(scheduleService))
protectedApi.route('/logs', createLogRoutes())

app.route('/api', protectedApi)

app.route('/api/opencode', createAuthenticatedOpenCodeProxyRoutes(openCodeClient, requireAuth))

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
    if (openCodeSupervisor) {
      await openCodeSupervisor.stop()
    }
    scheduleRunnerInstance?.stop()
    logger.info('Schedule runner stopped')
    if (!openCodeSupervisor) {
      await opencodeServerManager.stop()
    }
    logger.info('OpenCode server stopped')
  } catch (error) {
    logger.error('Error during shutdown:', error)
  }
  try {
    await stopWorkspaceSandboxOnShutdown(db)
    logger.info('Workspace sandbox stopped')
  } catch (error) {
    logger.error('Error stopping workspace sandbox:', error)
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
