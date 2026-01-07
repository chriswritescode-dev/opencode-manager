import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { basicAuth } from 'hono/basic-auth'
import { serveStatic } from '@hono/node-server/serve-static'
import { Server as SocketIOServer } from 'socket.io'
import os from 'os'
import path from 'path'
import { initializeDatabase } from './db/schema'
import { createRepoRoutes } from './routes/repos'
import { createSettingsRoutes } from './routes/settings'
import { createHealthRoutes } from './routes/health'
import { createTTSRoutes, cleanupExpiredCache } from './routes/tts'
import { createSTTRoutes } from './routes/stt'
import { createFileRoutes } from './routes/files'
import { createProvidersRoutes } from './routes/providers'
import { createOAuthRoutes } from './routes/oauth'
import { createTerminalRoutes, registerTerminalSocketIO } from './routes/terminal'
import { terminalService } from './services/terminal'
import { whisperServerManager } from './services/whisper'
import { ensureDirectoryExists, writeFileContent, fileExists, readFileContent } from './services/file-operations'
import { SettingsService } from './services/settings'
import { opencodeServerManager } from './services/opencode-single-server'
import { cleanupOrphanedDirectories, registerExternalDirectory } from './services/repo'
import { proxyRequest } from './services/proxy'
import { logger } from './utils/logger'
import { chatterboxServerManager } from './services/chatterbox'
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

const { PORT, HOST } = ENV.SERVER
const DB_PATH = getDatabasePath()

const app = new Hono()

app.use('/*', cors({
  origin: (origin) => origin || '', // Reflect the origin to support credentials
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-forwarded-proto', 'x-forwarded-host'],
}))

const { AUTH_USERNAME, AUTH_PASSWORD } = ENV.SERVER
if (AUTH_USERNAME && AUTH_PASSWORD) {
  logger.info(`Basic authentication enabled for user: ${AUTH_USERNAME}`)
  app.use('/*', basicAuth({
    username: AUTH_USERNAME,
    password: AUTH_PASSWORD,
  }))
}

const db = initializeDatabase(DB_PATH)

export const DEFAULT_AGENTS_MD = `# OpenCode Manager - Global Agent Instructions

## Critical System Constraints

- **DO NOT** use ports 5003 or 5551 - these are reserved for OpenCode Manager
- **DO NOT** kill or stop processes on ports 5003 or 5551
- **DO NOT** modify files in the \`.config/opencode\` directory unless explicitly requested

## Dev Server Ports

When starting dev servers, use the pre-allocated ports 5100-5103:
- Port 5100: Primary dev server (frontend)
- Port 5101: Secondary dev server (API/backend)
- Port 5102: Additional service
- Port 5103: Additional service

Always bind to \`0.0.0.0\` to allow external access from the Docker host.

## Package Management

### Node.js Packages
Prefer **pnpm** or **bun** over npm for installing dependencies to save disk space:
- Use \`pnpm install\` instead of \`npm install\`
- Use \`bun install\` as an alternative
- Both are pre-installed in the container

 ### Python Packages
 Always create a virtual environment in the repository directory before installing packages:

 1. Create virtual environment in repo:
   \`cd \`<repo_path>\`
   \`uv venv .venv\`

 2. Activate the virtual environment:
   \`source .venv/bin/activate\`  # or \`uv pip sync\` for project-based workflows

 3. Install packages into activated environment:
   \`uv pip install \`<package>\`
   \`uv pip install -r requirements.txt\`

 4. Run Python commands:
   \`python script.py\`  # Uses activated .venv

 Alternative: Use \`uv run python script.py\` to skip explicit activation

 **Important:**
 - Always create .venv in the repository directory (not workspace root)
 - Activate the environment before running pip operations
 - uv is pre-installed in the container and provides faster package installation
 - .venv directories created in repos will persist but can be removed safely

## General Guidelines

- This file is merged with any AGENTS.md files in individual repositories
- Repository-specific instructions take precedence for their respective codebases
`

async function ensureDefaultConfigExists(): Promise<void> {
  const settingsService = new SettingsService(db)
  const existingDbConfigs = settingsService.getOpenCodeConfigs()
  
  // Config already exists in database - nothing to do
  if (existingDbConfigs.configs.length > 0) {
    logger.info('OpenCode config already exists in database')
    return
  }
  
  // Try to import from existing OpenCode installation (highest priority)
  const homeConfigPath = path.join(os.homedir(), '.config/opencode/opencode.json')
  if (await fileExists(homeConfigPath)) {
    logger.info(`Found existing OpenCode config at ${homeConfigPath}, importing...`)
    try {
      const content = await readFileContent(homeConfigPath)
      const parsed = JSON.parse(content)
      const validation = OpenCodeConfigSchema.safeParse(parsed)
      
      if (!validation.success) {
        logger.warn('Existing config has invalid structure, will try other sources', validation.error)
      } else {
        settingsService.createOpenCodeConfig({
          name: 'default',
          content: validation.data,
          isDefault: true,
        })
        logger.info('Successfully imported existing OpenCode config')
        return
      }
    } catch (error) {
      logger.warn('Failed to import existing config, will try other sources', error)
    }
  }
  
  // Try to import from workspace config (if user reinstalls and workspace persists)
  const workspaceConfigPath = getOpenCodeConfigFilePath()
  if (await fileExists(workspaceConfigPath)) {
    logger.info(`Found workspace config, importing...`)
    try {
      const content = await readFileContent(workspaceConfigPath)
      const parsed = JSON.parse(content)
      const validation = OpenCodeConfigSchema.safeParse(parsed)
      
      if (!validation.success) {
        logger.warn('Workspace config has invalid structure, will use defaults', validation.error)
      } else {
        settingsService.createOpenCodeConfig({
          name: 'default',
          content: validation.data,
          isDefault: true,
        })
        logger.info('Successfully imported workspace config')
        return
      }
    } catch (error) {
      logger.warn('Failed to import workspace config, will use defaults', error)
    }
  }
  
  // No existing config found - create minimal seed config
  logger.info('No existing OpenCode config found, creating minimal seed config')
  settingsService.createOpenCodeConfig({
    name: 'default',
    content: {
      $schema: 'https://opencode.ai/config.json',
      // Minimal seed - users can configure through Manager UI
    },
    isDefault: true,
  })
  logger.info('Created minimal seed OpenCode config')
}

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

async function ensureDefaultAgentsMdExists(): Promise<void> {
  const agentsMdPath = getAgentsMdPath()
  const exists = await fileExists(agentsMdPath)
  
  if (!exists) {
    await writeFileContent(agentsMdPath, DEFAULT_AGENTS_MD)
    logger.info(`Created default AGENTS.md at: ${agentsMdPath}`)
  }
}

try {
  await ensureDirectoryExists(getWorkspacePath())
  await ensureDirectoryExists(getReposPath())
  await ensureDirectoryExists(getConfigPath())
  logger.info('Workspace directories initialized')

  await cleanupOrphanedDirectories(db)
  logger.info('Orphaned directory cleanup completed')

  await cleanupExpiredCache()

  await ensureDefaultConfigExists()
  await syncDefaultConfigToDisk()
  await ensureDefaultAgentsMdExists()

  const settingsService = new SettingsService(db)
  settingsService.initializeLastKnownGoodConfig()

  opencodeServerManager.setDatabase(db)
  await opencodeServerManager.start()
  logger.info(`OpenCode server running on port ${opencodeServerManager.getPort()}`)

  if (opencodeServerManager.isClientMode()) {
    const connectedDir = opencodeServerManager.getConnectedDirectory()
    if (connectedDir) {
      logger.info(`Client mode: registering connected directory as workspace: ${connectedDir}`)
      await registerExternalDirectory(db, connectedDir)
    }
  }

  try {
    await whisperServerManager.start()
    logger.info(`Whisper STT server running on port ${whisperServerManager.getPort()}`)
  } catch (error) {
    logger.warn('Whisper server failed to start (STT will be unavailable):', error)
  }

  try {
    await chatterboxServerManager.start()
    logger.info(`Chatterbox TTS server running on port ${chatterboxServerManager.getPort()}`)
  } catch (error) {
    logger.warn('Chatterbox server failed to start (TTS will be unavailable):', error)
  }
} catch (error) {
  logger.error('Failed to initialize workspace:', error)
}

app.route('/api/repos', createRepoRoutes(db))
app.route('/api/settings', createSettingsRoutes(db))
app.route('/api/health', createHealthRoutes(db))
app.route('/api/files', createFileRoutes(db))
app.route('/api/providers', createProvidersRoutes())
app.route('/api/oauth', createOAuthRoutes())
app.route('/api/tts', createTTSRoutes(db))
app.route('/api/stt', createSTTRoutes(db))
app.route('/api/terminal', createTerminalRoutes())

app.all('/api/opencode/*', async (c) => {
  const request = c.req.raw
  return proxyRequest(request)
})

const isProduction = ENV.SERVER.NODE_ENV === 'production'

if (isProduction) {
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
        terminal: '/api/terminal',
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
    terminalService.destroyAllSessions()
    logger.info('Terminal sessions destroyed')
    await whisperServerManager.stop()
    logger.info('Whisper server stopped')
    await chatterboxServerManager.stop()
    logger.info('Chatterbox server stopped')
    await opencodeServerManager.stop()
    logger.info('OpenCode server stopped')
  } catch (error) {
    logger.error('Error stopping services:', error)
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

const io = new SocketIOServer(server as any, {
  path: '/api/terminal/socket.io',
  cors: {
    origin: true, // Reflect the request origin
    credentials: true,
    methods: ['GET', 'POST']
  }
})

registerTerminalSocketIO(io)

logger.info(`🚀 OpenCode WebUI API running on http://${HOST}:${PORT}`)
