import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFile } from 'fs/promises'
import { initializeDatabase } from './db/schema'
import { createRepoRoutes } from './routes/repos'
import { createRepoTerminalSocketRoutes } from './routes/repo-terminal-socket'
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
import { createSessionPermissionModeRoutes } from './routes/session-permission-modes'
import { createSessionGoalRoutes } from './routes/session-goals'
import { createMultiRunRoutes } from './routes/multi-runs'
import { createChangeWalkthroughRoutes } from './routes/change-walkthroughs'
import { createLogRoutes } from './routes/logs'
import { createPreviewRoutes, createPreviewAvailability } from './routes/preview'
import { createPreviewGatewayApp, PreviewSessionStore } from './services/preview/gateway'
import { createInternalRoutes } from './routes/internal'
import { sweepStaleUploadSessions } from './routes/internal/repo-mirror-helpers'
import { createOpenCodeProxyRoutes } from './routes/opencode-proxy'
import { createAuthenticatedOpenCodeProxyRoutes } from './routes/opencode-auth-proxy'
import { sseAggregator } from './services/sse-aggregator'
import { ensureDirectoryExists, writeFileContent, fileExists } from './services/file-operations'
import { SettingsService } from './services/settings'
import { SessionPermissionModeService } from './services/session-permission-modes'
import { SessionGoalService } from './services/session-goals'
import { MultiRunService } from './services/multi-runs'
import { ChangeWalkthroughService } from './services/change-walkthroughs'
import { opencodeServerManager } from './services/opencode-single-server'
import { createOpenCodeClient } from './services/opencode/client'
import { getOpenCodeUpstreamBaseUrl } from './services/opencode/upstream'
import { NotificationService } from './services/notification'
import { ScheduleRunner, ScheduleService } from './services/schedules'
import { CredentialProvider } from './services/credential-provider'
import { TerminalService } from './services/terminal'
import { ProjectConfigService } from './services/project-config'
import { RepoWorkspaceService } from './services/repo-workspace'
import { createGitService } from './services/git/GitService'
import { ScheduleWorktreeManager } from './services/schedule-worktree'
import { migrateGlobalSkills } from './services/skills'
import { installAssistantWorkspace } from './services/assistant-mode'
import { detectSandboxCapability } from './services/sandbox/capability'
import { SandboxRuntimeService, stopWorkspaceSandboxOnShutdown } from './services/sandbox/runtime'
import { getOpenCodeImportStatus, syncOpenCodeImport } from './services/opencode-import'
import { readOpenCodeConfigFile, foldLegacyConfigJsonSource, withOpenCodeConfigLock } from './services/opencode-config-file'
import { seedOpenCodeConfigFile } from './services/opencode-config-apply'
import { OpenCodeSupervisor } from './services/opencode-supervisor'
import { logger } from './utils/logger'
import { 
  getWorkspacePath, 
  getReposPath, 
  getConfigPath,
  getAgentsMdPath,
  getDatabasePath,
  getTrustedOrigins,
  ENV
} from '@opencode-manager/shared/config/env'


const { PORT, HOST } = ENV.SERVER
const DB_PATH = getDatabasePath()

const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

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
    const trustedOrigins = getTrustedOrigins()
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
  await withOpenCodeConfigLock(foldLegacyConfigJsonSource)

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

const terminalService = new TerminalService(
  openCodeClient,
  new CredentialProvider(db),
  () => getOpenCodeUpstreamBaseUrl(opencodeServerManager.getEffectiveServerHost()),
)
const gitService = createGitService(gitAuthService)
const projectConfigService = new ProjectConfigService(db, gitService, gitAuthService)
const scheduleWorktreeManager = new ScheduleWorktreeManager(gitAuthService, db)
const scheduleService = new ScheduleService(db, openCodeClient, scheduleWorktreeManager)
scheduleService.setWorktreeRemovedHandler(async (directory) => {
  try {
    await terminalService.removeAll(directory)
  } catch (error) {
    logger.warn(`Failed to remove terminals for schedule worktree ${directory}:`, error)
  }
})
const repoWorkspaces = new RepoWorkspaceService(db, openCodeClient, gitAuthService, projectConfigService, terminalService, scheduleService)
const scheduleRunnerInstance = new ScheduleRunner(scheduleService)

const notificationService = new NotificationService(db)
const sessionSettingsService = new SettingsService(db)
const sessionPermissionModeService = new SessionPermissionModeService(db, openCodeClient, sessionSettingsService)
const sessionGoalService = new SessionGoalService(db, openCodeClient, sessionSettingsService, {
  onOutcome: (goal) => {
    void notificationService.notifyGoalOutcome(goal).catch((error) => {
      logger.error('Goal outcome notification error:', error)
    })
  },
  resolveSessionLock: async (sessionId) =>
    (await sessionPermissionModeService.getEffectiveMode(sessionId)).lockedReason,
})
sessionGoalService.loadOpenGoals()

const multiRunService = new MultiRunService(db, openCodeClient, repoWorkspaces, sessionPermissionModeService)
const changeWalkthroughService = new ChangeWalkthroughService(db, openCodeClient, sessionSettingsService, gitAuthService, gitService)

sseAggregator.onEvent((directory, event) => {
  sessionPermissionModeService.handleEvent(directory, event).catch((err) => {
    logger.error('Session permission mode event handling error:', err)
  })
  sessionGoalService.handleEvent(directory, event).catch((err) => {
    logger.error('Session goal event handling error:', err)
  })
  try {
    changeWalkthroughService.handleEvent(event)
  } catch (err) {
    logger.error('Change walkthrough event handling error:', err)
  }
})

notificationService.addEventSuppressor(async (event, sessionId) => {
  if (event.type !== 'permission.asked' || !sessionId) return false
  return (await sessionPermissionModeService.getEffectiveMode(sessionId)).mode === 'auto'
})

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
sseAggregator.onUpstreamConnected(() => {
  void sessionPermissionModeService.acceptPendingRequestsForActiveSessions().catch((err) => {
    logger.error('Failed to accept pending permission requests for active sessions:', err)
  })
})
sseAggregator.start()

void sessionGoalService.recoverOpenGoals().catch((error) => {
  logger.error('Session goal recovery error:', error)
})

sseAggregator.setScheduledSessionsResolver(
  () => scheduleService.getActiveRunSessions(),
)

void scheduleRunnerInstance.start()

const settingsService = new SettingsService(db)
const previewSessionStore = new PreviewSessionStore()
const previewAvailability = createPreviewAvailability(false)

app.route('/api/auth', createAuthRoutes(auth))
app.route('/api/auth-info', createAuthInfoRoutes(auth, db))
app.route('/api/health', createHealthRoutes(db, openCodeSupervisor))

app.route('/api/mcp-oauth-proxy', createMcpOauthProxyRoutes(openCodeClient, requireAuth))
app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService, openCodeClient, sessionPermissionModeService, repoWorkspaces, gitAuthService, sessionGoalService, multiRunService))
app.route('/api/opencode-proxy', createOpenCodeProxyRoutes(db, settingsService, upgradeWebSocket))

const protectedApi = new Hono()
protectedApi.use('/*', requireAuth)

protectedApi.route('/repos', createRepoTerminalSocketRoutes(db, gitAuthService, openCodeClient, terminalService, upgradeWebSocket))
protectedApi.route('/repos', createRepoRoutes(db, gitAuthService, scheduleService, openCodeClient, terminalService, projectConfigService, repoWorkspaces))
protectedApi.route('/settings', createSettingsRoutes(db, gitAuthService, openCodeClient, openCodeSupervisor))
  protectedApi.route('/files', createFileRoutes())
  protectedApi.route('/filesystem', createFilesystemRoutes())
protectedApi.route('/providers', createProvidersRoutes(openCodeClient))
protectedApi.route('/oauth', createOAuthRoutes(openCodeClient))
protectedApi.route('/tts', createTTSRoutes(db))
protectedApi.route('/stt', createSTTRoutes(db))
protectedApi.route('/sse', createSSERoutes())
protectedApi.route('/ssh', createSSHRoutes(gitAuthService))
protectedApi.route('/notifications', createNotificationRoutes(notificationService))
protectedApi.route('/prompt-templates', createPromptTemplateRoutes(db))
protectedApi.route('/session-pins', createSessionPinRoutes(db))
protectedApi.route('/session-permission-modes', createSessionPermissionModeRoutes(sessionPermissionModeService))
protectedApi.route('/session-goals', createSessionGoalRoutes(sessionGoalService))
protectedApi.route('/multi-runs', createMultiRunRoutes(multiRunService))
protectedApi.route('/change-walkthroughs', createChangeWalkthroughRoutes(changeWalkthroughService))
protectedApi.route('/schedules', createScheduleRoutes(scheduleService))
protectedApi.route('/logs', createLogRoutes())
protectedApi.route('/preview', createPreviewRoutes({ store: previewSessionStore, isEnabled: previewAvailability.isEnabled }))

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

const server = serve({
  fetch: app.fetch,
  port: PORT,
  hostname: HOST,
})

injectWebSocket(server)

if (ENV.PREVIEW.PORT > 0) {
  const previewGateway = createPreviewGatewayApp(previewSessionStore)
  const previewServer = serve({
    fetch: previewGateway.app.fetch,
    port: ENV.PREVIEW.PORT,
    hostname: HOST,
  })
  previewServer.on('listening', () => {
    previewAvailability.markAvailable()
    logger.info(`Preview gateway running on http://${HOST}:${ENV.PREVIEW.PORT}`)
  })
  previewServer.on('error', (error: Error) => {
    previewAvailability.markUnavailable()
    const code = (error as NodeJS.ErrnoException).code
    logger.warn(`Preview gateway failed to listen on port ${ENV.PREVIEW.PORT}${code ? ` (${code})` : ''}; preview disabled`)
  })
  previewGateway.injectWebSocket(previewServer)
}

logger.info(`🚀 OpenCode WebUI API running on http://${HOST}:${PORT}`)
