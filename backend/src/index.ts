import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { initializeDatabase } from './db/schema'
import { createRepoRoutes } from './routes/repos'
import { createSettingsRoutes } from './routes/settings'
import { createHealthRoutes } from './routes/health'
import { createTTSRoutes, cleanupExpiredCache } from './routes/tts'
import { createFileRoutes } from './routes/files'
import { createProvidersRoutes } from './routes/providers'
import { createOAuthRoutes } from './routes/oauth'
import { ensureDirectoryExists, writeFileContent, fileExists } from './services/file-operations'
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
  getAgentsMdPath,
  getDatabasePath,
  ENV
} from '@opencode-manager/shared'

const { PORT, HOST } = ENV.SERVER
const DB_PATH = getDatabasePath()

const app = new Hono()

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

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
Prefer **uv** for Python package management:
- Use \`uv venv\` to create virtual environments instead of \`python -m venv\`
- Use \`uv pip install\` to install packages instead of \`pip install\`
- Use \`uv pip\` for all pip operations
- uv is pre-installed in the container and provides faster package installation

## General Guidelines

- This file is merged with any AGENTS.md files in individual repositories
- Repository-specific instructions take precedence for their respective codebases
`

const DEFAULT_OPENCODE_CONFIG = {
  $schema: 'https://opencode.ai/config.json',
  theme: 'opencode',
  autoupdate: true,
  share: 'disabled',
  keybinds: {
    leader: 'ctrl+x',
    app_exit: 'ctrl+c,ctrl+d,<leader>q',
    editor_open: '<leader>e',
    theme_list: '<leader>t',
    sidebar_toggle: '<leader>b',
    status_view: '<leader>s',
    session_export: '<leader>x',
    session_new: '<leader>n',
    session_list: '<leader>l',
    session_timeline: '<leader>g',
    session_share: 'none',
    session_unshare: 'none',
    session_interrupt: 'escape',
    session_compact: '<leader>c',
    messages_page_up: 'pageup',
    messages_page_down: 'pagedown',
    messages_half_page_up: 'ctrl+alt+u',
    messages_half_page_down: 'ctrl+alt+d',
    messages_first: 'ctrl+g,home',
    messages_last: 'ctrl+alt+g,end',
    messages_copy: '<leader>y',
    messages_undo: '<leader>u',
    messages_redo: '<leader>r',
    messages_toggle_conceal: '<leader>h',
    model_list: '<leader>m',
    model_cycle_recent: 'f2',
    model_cycle_recent_reverse: 'shift+f2',
    command_list: 'ctrl+p',
    agent_list: '<leader>a',
    agent_cycle: 'tab',
    agent_cycle_reverse: 'shift+tab',
    input_clear: 'ctrl+c',
    input_forward_delete: 'ctrl+d',
    input_paste: 'ctrl+v',
    input_submit: 'return',
    input_newline: 'shift+return,ctrl+j',
    history_previous: 'up',
    history_next: 'down',
    session_child_cycle: '<leader>right',
    session_child_cycle_reverse: '<leader>left',
    terminal_suspend: 'ctrl+z',
  },
  permission: {
    bash: {
      '*': 'allow',
    },
  },
}

async function ensureDefaultConfigExists(): Promise<void> {
  const settingsService = new SettingsService(db)
  const configs = settingsService.getOpenCodeConfigs()
  
  if (configs.configs.length === 0) {
    logger.info('No OpenCode configs found, creating default config')
    settingsService.createOpenCodeConfig({
      name: 'default',
      content: DEFAULT_OPENCODE_CONFIG,
      isDefault: true,
    })
    logger.info('Created default OpenCode config')
  }
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
  
  opencodeServerManager.setDatabase(db)
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
app.route('/api/oauth', createOAuthRoutes())
app.route('/api/tts', createTTSRoutes(db))

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
