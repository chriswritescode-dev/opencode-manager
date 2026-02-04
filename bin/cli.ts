#!/usr/bin/env bun
import { spawn, execSync, spawnSync } from 'child_process'
import { createInterface } from 'readline'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as crypto from 'crypto'

const VERSION = '0.5.4'
const DEFAULT_PORT = 5001
const DEFAULT_OPENCODE_PORT = 5551
const MANAGED_PORTS = [5001, 5002, 5003, 5173, 5174, 5175, 5176, 5552, 5553, 5554]

const CONFIG_DIR = path.join(os.homedir(), '.local', 'run', 'opencode-manager')
const ENDPOINTS_FILE = path.join(CONFIG_DIR, 'endpoints.json')
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json')
const CLOUDFLARED_LOG_FILE = path.join(CONFIG_DIR, 'cloudflared.log')
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
const MAX_LOG_BACKUPS = 3

interface AuthConfig {
  username: string
  password: string
}

interface Endpoint {
  type: 'local' | 'tunnel'
  url: string
  timestamp: string
}

interface EndpointsConfig {
  endpoints: Endpoint[]
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  }
}

/**
 * Rotate a log file if it exceeds the maximum size.
 * Creates backups like: cloudflared.log.1, cloudflared.log.2, etc.
 */
function rotateLogFile(logPath: string): void {
  try {
    if (!fs.existsSync(logPath)) return
    
    const stats = fs.statSync(logPath)
    if (stats.size < MAX_LOG_SIZE_BYTES) return
    
    console.log(`📜 Rotating log file (${Math.round(stats.size / 1024)}KB): ${path.basename(logPath)}`)
    
    // Remove oldest backup if it exists
    const oldestBackup = `${logPath}.${MAX_LOG_BACKUPS}`
    if (fs.existsSync(oldestBackup)) {
      fs.unlinkSync(oldestBackup)
    }
    
    // Shift existing backups: .2 -> .3, .1 -> .2
    for (let i = MAX_LOG_BACKUPS - 1; i >= 1; i--) {
      const current = `${logPath}.${i}`
      const next = `${logPath}.${i + 1}`
      if (fs.existsSync(current)) {
        fs.renameSync(current, next)
      }
    }
    
    // Move current log to .1
    fs.renameSync(logPath, `${logPath}.1`)
    
  } catch (err) {
    console.warn('⚠️  Failed to rotate log file:', err)
  }
}

function getOrCreateAuth(): AuthConfig {
  ensureConfigDir()
  
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const content = fs.readFileSync(AUTH_FILE, 'utf8')
      const auth = JSON.parse(content) as AuthConfig
      if (auth.username && auth.password) {
        return auth
      }
    } catch {}
  }
  
  const auth: AuthConfig = {
    username: 'admin',
    password: crypto.randomBytes(16).toString('base64url'),
  }
  
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 })
  console.log(`\n🔐 Generated new credentials:`)
  console.log(`   Username: ${auth.username}`)
  console.log(`   Password: ${auth.password}`)
  console.log(`   Saved to: ${AUTH_FILE}\n`)
  
  return auth
}

function updateEndpoints(localUrl: string, tunnelUrl?: string): void {
  ensureConfigDir()
  
  let config: EndpointsConfig = { endpoints: [] }
  
  if (fs.existsSync(ENDPOINTS_FILE)) {
    try {
      config = JSON.parse(fs.readFileSync(ENDPOINTS_FILE, 'utf8'))
    } catch {}
  }
  
  const timestamp = new Date().toISOString()
  
  config.endpoints = config.endpoints.filter(e => e.url !== localUrl)
  config.endpoints.push({ type: 'local', url: localUrl, timestamp })
  
  if (tunnelUrl) {
    config.endpoints = config.endpoints.filter(e => e.type !== 'tunnel' || e.url === tunnelUrl)
    config.endpoints.push({ type: 'tunnel', url: tunnelUrl, timestamp })
  }
  
  fs.writeFileSync(ENDPOINTS_FILE, JSON.stringify(config, null, 2), { mode: 0o600 })
}

function getPackageDir(): string {
  return path.resolve(import.meta.dir, '..')
}

function printHelp(): void {
  console.log(`
opencode-manager v${VERSION}

Usage: opencode-manager <command> [options]

Commands:
  start              Start the OpenCode Manager server
  health             Check health of locally running service
  install-service    Install as a user service (macOS/Linux)
  uninstall-service  Remove the user service
  status             Show service status
  logs               Show service logs
  help               Show this help message

Start Options:
  --client, -c       Connect to existing opencode server
  --tunnel, -t       Start a Cloudflare tunnel for public access
  --port, -p <port>  Backend API port (default: 5001)
  --no-auth          Disable basic authentication

Health Options:
  --port, -p <port>  Backend API port to check (default: 5001)
  --verbose, -v      Show detailed information
  --json             Output results as JSON

Service Options:
  --no-tunnel        Disable Cloudflare tunnel (tunnel enabled by default)

Note: Service runs in client mode by default, connecting to existing
opencode CLI sessions. If no opencode server is found on port 5551,
one will be started automatically.

Examples:
  opencode-manager start
  opencode-manager start --tunnel
  opencode-manager health
  opencode-manager health --verbose
  opencode-manager install-service
  opencode-manager install-service --no-tunnel
  opencode-manager status
`)
}

async function checkServerHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/doc`, {
      signal: AbortSignal.timeout(2000)
    })
    return response.status > 0
  } catch {
    return false
  }
}

function isPortInUse(port: number): boolean {
  try {
    const output = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim()
    return output.length > 0
  } catch {
    return false
  }
}

async function waitForBackendHealth(port: number, auth: AuthConfig, maxSeconds: number): Promise<boolean> {
  const headers: Record<string, string> = {
    'Authorization': `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`
  }
  
  for (let i = 0; i < maxSeconds; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2000),
        headers
      })
      if (response.ok) {
        const data = await response.json() as { status?: string }
        if (data.status === 'healthy') {
          return true
        }
      }
    } catch {}
    if (i > 0 && i % 10 === 0) {
      console.log(`   Still waiting... (${i}s)`)
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

function killProcessOnPort(port: number): boolean {
  try {
    const output = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim()
    if (!output) return false
    
    const pids = output.split('\n').filter(Boolean).map(p => parseInt(p))
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM')
        console.log(`   Killed orphaned process on port ${port} (PID ${pid})`)
      } catch {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {}
      }
    }
    return pids.length > 0
  } catch {
    return false
  }
}

function cleanupManagedPorts(): void {
  let cleaned = false
  for (const port of MANAGED_PORTS) {
    if (killProcessOnPort(port)) {
      cleaned = true
    }
  }
  if (cleaned) {
    execSync('sleep 1')
  }
}

async function startOpenCodeServer(port: number): Promise<boolean> {
  if (isPortInUse(port)) {
    console.log(`\n⚠️  Port ${port} is already in use`)
    for (let i = 0; i < 10; i++) {
      if (await checkServerHealth(port)) {
        console.log(`✓ Existing server on port ${port} is responding`)
        return true
      }
      await new Promise(r => setTimeout(r, 500))
    }
    console.log(`   Server on port ${port} not responding, killing and restarting...`)
    killProcessOnPort(port)
    await new Promise(r => setTimeout(r, 1000))
  }

  console.log(`\n🚀 Starting opencode server on port ${port}...`)
  
  const serverProcess = spawn('opencode', ['serve', '--port', port.toString(), '--hostname', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  
  serverProcess.unref()

  for (let i = 0; i < 30; i++) {
    if (await checkServerHealth(port)) {
      console.log(`✓ OpenCode server started on port ${port}`)
      return true
    }
    await new Promise(r => setTimeout(r, 500))
  }
  
  console.error('❌ Failed to start opencode server')
  return false
}

async function startCloudflaredTunnel(localPort: number, auth: AuthConfig): Promise<{ process: ReturnType<typeof spawn>, url: string | null, urlWithAuth: string | null }> {
  console.log('\n🌐 Starting Cloudflare tunnel...')

  // Ensure config directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }

  // Rotate log file if needed
  rotateLogFile(CLOUDFLARED_LOG_FILE)

  // Open log file for appending
  const logStream = fs.createWriteStream(CLOUDFLARED_LOG_FILE, { flags: 'a' })
  const timestamp = () => new Date().toISOString()
  
  // Write startup marker
  logStream.write(`\n${'='.repeat(80)}\n`)
  logStream.write(`[${timestamp()}] Cloudflare tunnel starting...\n`)
  logStream.write(`[${timestamp()}] Target: http://localhost:${localPort}\n`)
  logStream.write(`${'='.repeat(80)}\n\n`)

  const tunnelProcess = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://localhost:${localPort}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let tunnelUrl: string | null = null

  const urlPromise = new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 30000)

    const handleOutput = (data: Buffer) => {
      const output = data.toString()
      
      // Log to file with timestamp
      const lines = output.split('\n').filter(line => line.trim())
      for (const line of lines) {
        logStream.write(`[${timestamp()}] ${line}\n`)
      }
      
      const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (urlMatch && !tunnelUrl) {
        tunnelUrl = urlMatch[0]
        clearTimeout(timeout)
        resolve(tunnelUrl)
      }
    }

    tunnelProcess.stdout?.on('data', handleOutput)
    tunnelProcess.stderr?.on('data', handleOutput)
  })

  tunnelProcess.on('error', (err) => {
    logStream.write(`[${timestamp()}] ERROR: Failed to start cloudflared: ${err.message}\n`)
    console.error('\n❌ Failed to start cloudflared:', err.message)
    console.log('Install cloudflared: brew install cloudflared')
  })

  tunnelProcess.on('exit', (code, signal) => {
    logStream.write(`[${timestamp()}] Process exited with code ${code}, signal ${signal}\n`)
    logStream.end()
  })

  const url = await urlPromise

  let urlWithAuth: string | null = null
  if (url && auth.username && auth.password) {
    try {
      const parsedUrl = new URL(url)
      parsedUrl.username = auth.username
      parsedUrl.password = auth.password
      urlWithAuth = parsedUrl.toString().replace(/\/$/, '')
    } catch {}
  }

  if (url) {
    logStream.write(`[${timestamp()}] Tunnel established: ${url}\n`)
    console.log(`✓ Tunnel URL: ${url}`)
    if (urlWithAuth) {
      console.log(`   Tunnel: ${urlWithAuth}`)
    }
  } else {
    logStream.write(`[${timestamp()}] WARNING: Failed to get tunnel URL within timeout\n`)
  }

  return { process: tunnelProcess, url, urlWithAuth }
}

async function startBackend(port: number, auth: AuthConfig, opencodePort?: number): Promise<ReturnType<typeof spawn>> {
  const packageDir = getPackageDir()
  
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: port.toString(),
    NODE_ENV: 'production',
    AUTH_USERNAME: auth.username,
    AUTH_PASSWORD: auth.password,
  }

  if (opencodePort) {
    env.OPENCODE_SERVER_PORT = opencodePort.toString()
    env.OPENCODE_CLIENT_MODE = 'true'
  }

  console.log(`\n🚀 Starting backend on port ${port}...`)
  if (opencodePort) {
    console.log(`   Connecting to opencode server on port ${opencodePort}`)
  }

  const backendProcess = spawn('bun', [path.join(packageDir, 'backend', 'dist', 'index.js')], {
    cwd: packageDir,
    stdio: 'inherit',
    env,
  })

  return backendProcess
}

async function commandStart(args: string[]): Promise<void> {
  const hasClient = args.includes('--client') || args.includes('-c')
  const hasTunnel = args.includes('--tunnel') || args.includes('-t')
  const noAuth = args.includes('--no-auth')
  const portIdx = args.findIndex(a => a === '--port' || a === '-p')
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1]) || DEFAULT_PORT : DEFAULT_PORT

  console.log('\n╔═══════════════════════════════════════╗')
  console.log('║      OpenCode Manager - Start         ║')
  console.log('╚═══════════════════════════════════════╝')

  // Rotate log files if they're too large
  ensureConfigDir()
  rotateLogFile(path.join(CONFIG_DIR, 'stdout.log'))
  rotateLogFile(path.join(CONFIG_DIR, 'stderr.log'))
  rotateLogFile(CLOUDFLARED_LOG_FILE)

  const auth = noAuth ? { username: '', password: '' } : getOrCreateAuth()

  let opencodePort: number | undefined

  if (hasClient) {
    console.log('\n🔍 Checking for opencode server on port', DEFAULT_OPENCODE_PORT, '...')
    
    if (await checkServerHealth(DEFAULT_OPENCODE_PORT)) {
      console.log(`✓ Found existing server`)
      opencodePort = DEFAULT_OPENCODE_PORT
    } else {
      console.log('   No server found, starting one...')
      if (!await startOpenCodeServer(DEFAULT_OPENCODE_PORT)) {
        process.exit(1)
      }
      opencodePort = DEFAULT_OPENCODE_PORT
    }
  }

  console.log('\n🧹 Cleaning up orphaned processes...')
  cleanupManagedPorts()

  const processes: ReturnType<typeof spawn>[] = []
  const backendProcess = await startBackend(port, auth, opencodePort)
  processes.push(backendProcess)

  console.log('\n⏳ Waiting for backend to be ready...')
  const backendReady = await waitForBackendHealth(port, auth, 120)
  if (!backendReady) {
    console.error('❌ Backend failed to start within timeout')
    process.exit(1)
  }
  console.log('✓ Backend is ready!')

  const localUrl = `http://localhost:${port}`
  let tunnelUrl: string | undefined
  let tunnelUrlWithAuth: string | undefined

  if (hasTunnel) {
    const tunnel = await startCloudflaredTunnel(port, auth)
    processes.push(tunnel.process)
    tunnelUrl = tunnel.url || undefined
    tunnelUrlWithAuth = tunnel.urlWithAuth || undefined

    if (tunnel.url) {
      console.log('\n═══════════════════════════════════════')
      console.log(`🌍 Public URL: ${tunnel.url}`)
      if (tunnel.urlWithAuth) {
        console.log(`🔐 With auth:  ${tunnel.urlWithAuth}`)
      }
      console.log('═══════════════════════════════════════\n')
    }
  }

  updateEndpoints(localUrl, tunnelUrlWithAuth || tunnelUrl)

  console.log('\n📍 Endpoints:')
  console.log(`   Local: ${localUrl}`)
  if (tunnelUrlWithAuth) {
    console.log(`   Tunnel: ${tunnelUrlWithAuth}`)
  } else if (tunnelUrl) {
    console.log(`   Tunnel: ${tunnelUrl}`)
  }
  if (!noAuth) {
    console.log(`\n🔐 Auth: ${auth.username}:${auth.password}`)
  }
  console.log('\nPress Ctrl+C to stop\n')

  const cleanup = () => {
    console.log('\n\n🛑 Shutting down...')
    processes.forEach(p => {
      try { p.kill('SIGTERM') } catch {}
    })
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  await Promise.race(processes.map(p => new Promise((_, reject) => {
    p.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Process exited with code ${code}`))
      }
    })
  })))
}

function getServiceName(): string {
  return 'opencode-manager'
}

function getMacOSPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.opencode-manager.plist')
}

function getLinuxServicePath(): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user', 'opencode-manager.service')
}

function getFullPath(): string {
  const basePaths = [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
  ]
  
  try {
    const bunPath = execSync('which bun', { encoding: 'utf8' }).trim()
    basePaths.push(path.dirname(bunPath))
  } catch {}
  
  try {
    const opencodePath = execSync('which opencode', { encoding: 'utf8' }).trim()
    basePaths.push(path.dirname(opencodePath))
  } catch {}
  
  try {
    const cloudflaredPath = execSync('which cloudflared', { encoding: 'utf8' }).trim()
    basePaths.push(path.dirname(cloudflaredPath))
  } catch {}
  
  try {
    const pythonPath = execSync('which python3', { encoding: 'utf8' }).trim()
    basePaths.push(path.dirname(pythonPath))
  } catch {}
  
  const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node')
  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir)
      for (const v of versions) {
        basePaths.push(path.join(nvmDir, v, 'bin'))
      }
    } catch {}
  }
  
  const userLocalBin = path.join(os.homedir(), '.local', 'bin')
  if (fs.existsSync(userLocalBin)) {
    basePaths.push(userLocalBin)
  }
  
  const uniquePaths = [...new Set(basePaths)]
  return uniquePaths.join(':')
}

function commandInstallService(args: string[]): void {
  const noTunnel = args.includes('--no-tunnel')
  const hasTunnel = !noTunnel
  const platform = os.platform()

  console.log('\n🔧 Installing OpenCode Manager as a user service...\n')

  const auth = getOrCreateAuth()

  const packageDir = getPackageDir()
  const cliPath = path.join(packageDir, 'bin', 'cli.ts')
  const bunPath = execSync('which bun', { encoding: 'utf8' }).trim()
  const fullPath = getFullPath()

  const startArgs = ['start', '--client']
  if (hasTunnel) startArgs.push('--tunnel')

  if (platform === 'darwin') {
    const plistPath = getMacOSPlistPath()
    const plistDir = path.dirname(plistPath)
    
    if (!fs.existsSync(plistDir)) {
      fs.mkdirSync(plistDir, { recursive: true })
    }

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.opencode-manager</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>${cliPath}</string>
${startArgs.map(a => `    <string>${a}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${packageDir}</string>
  <key>StandardOutPath</key>
  <string>${path.join(CONFIG_DIR, 'stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(CONFIG_DIR, 'stderr.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${fullPath}</string>
    <key>HOME</key>
    <string>${os.homedir()}</string>
    <key>AUTH_USERNAME</key>
    <string>${auth.username}</string>
    <key>AUTH_PASSWORD</key>
    <string>${auth.password}</string>${process.env.GEMINI_API_KEY ? `
    <key>GEMINI_API_KEY</key>
    <string>${process.env.GEMINI_API_KEY}</string>` : ''}${process.env.OPENAI_API_KEY ? `
    <key>OPENAI_API_KEY</key>
    <string>${process.env.OPENAI_API_KEY}</string>` : ''}${process.env.ANTHROPIC_API_KEY ? `
    <key>ANTHROPIC_API_KEY</key>
    <string>${process.env.ANTHROPIC_API_KEY}</string>` : ''}${process.env.XAI_API_KEY ? `
    <key>XAI_API_KEY</key>
    <string>${process.env.XAI_API_KEY}</string>` : ''}
  </dict>
</dict>
</plist>`

    fs.writeFileSync(plistPath, plistContent)
    console.log(`✓ Created plist: ${plistPath}`)

    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { encoding: 'utf8' })
    } catch {}
    
    execSync(`launchctl load "${plistPath}"`, { encoding: 'utf8' })
    console.log('✓ Service loaded and started')

  } else if (platform === 'linux') {
    const servicePath = getLinuxServicePath()
    const serviceDir = path.dirname(servicePath)
    
    if (!fs.existsSync(serviceDir)) {
      fs.mkdirSync(serviceDir, { recursive: true })
    }

    const serviceContent = `[Unit]
Description=OpenCode Manager
After=network.target

[Service]
Type=simple
ExecStart=${bunPath} ${cliPath} ${startArgs.join(' ')}
WorkingDirectory=${packageDir}
Restart=always
RestartSec=10
Environment="PATH=${fullPath}"
Environment="HOME=${os.homedir()}"
Environment="AUTH_USERNAME=${auth.username}"
Environment="AUTH_PASSWORD=${auth.password}"

[Install]
WantedBy=default.target
`

    fs.writeFileSync(servicePath, serviceContent)
    console.log(`✓ Created service file: ${servicePath}`)

    execSync('systemctl --user daemon-reload', { encoding: 'utf8' })
    execSync('systemctl --user enable opencode-manager', { encoding: 'utf8' })
    execSync('systemctl --user start opencode-manager', { encoding: 'utf8' })
    console.log('✓ Service enabled and started')

  } else {
    console.error(`❌ Unsupported platform: ${platform}`)
    console.log('   Supported: macOS (darwin), Linux')
    process.exit(1)
  }

  console.log('\n✅ Installation complete!')
  console.log(`\n🔐 Credentials saved to: ${AUTH_FILE}`)
  console.log(`   Username: ${auth.username}`)
  console.log(`   Password: ${auth.password}`)
  console.log(`\n📍 Endpoints will be written to: ${ENDPOINTS_FILE}`)
  console.log('\nCommands:')
  console.log('  opencode-manager status  - Check service status')
  console.log('  opencode-manager logs    - View logs')
}

function commandUninstallService(): void {
  const platform = os.platform()

  console.log('\n🔧 Uninstalling OpenCode Manager service...\n')

  if (platform === 'darwin') {
    const plistPath = getMacOSPlistPath()
    
    try {
      execSync(`launchctl unload "${plistPath}"`, { encoding: 'utf8' })
      console.log('✓ Service stopped')
    } catch {}

    if (fs.existsSync(plistPath)) {
      fs.unlinkSync(plistPath)
      console.log(`✓ Removed plist: ${plistPath}`)
    }

  } else if (platform === 'linux') {
    try {
      execSync('systemctl --user stop opencode-manager', { encoding: 'utf8' })
      console.log('✓ Service stopped')
    } catch {}

    try {
      execSync('systemctl --user disable opencode-manager', { encoding: 'utf8' })
      console.log('✓ Service disabled')
    } catch {}

    const servicePath = getLinuxServicePath()
    if (fs.existsSync(servicePath)) {
      fs.unlinkSync(servicePath)
      console.log(`✓ Removed service file: ${servicePath}`)
    }

    execSync('systemctl --user daemon-reload', { encoding: 'utf8' })

  } else {
    console.error(`❌ Unsupported platform: ${platform}`)
    process.exit(1)
  }

  console.log('\n✅ Uninstallation complete!')
}

function commandStatus(): void {
  const platform = os.platform()

  console.log('\n📊 OpenCode Manager Service Status\n')

  if (platform === 'darwin') {
    const plistPath = getMacOSPlistPath()
    
    if (!fs.existsSync(plistPath)) {
      console.log('❌ Service not installed')
      return
    }

    try {
      const result = execSync('launchctl list | grep com.opencode-manager', { encoding: 'utf8' })
      const parts = result.trim().split(/\s+/)
      const pid = parts[0]
      const exitCode = parts[1]
      
      if (pid !== '-') {
        console.log(`✅ Running (PID: ${pid})`)
      } else if (exitCode === '0') {
        console.log('⏸️  Stopped (last exit: success)')
      } else {
        console.log(`❌ Stopped (last exit code: ${exitCode})`)
      }
    } catch {
      console.log('⏸️  Not running')
    }

  } else if (platform === 'linux') {
    try {
      const result = execSync('systemctl --user status opencode-manager --no-pager', { encoding: 'utf8' })
      console.log(result)
    } catch (err: unknown) {
      const error = err as { stdout?: string }
      if (error.stdout) {
        console.log(error.stdout)
      } else {
        console.log('❌ Service not installed or not running')
      }
    }

  } else {
    console.log(`❌ Unsupported platform: ${platform}`)
  }

  if (fs.existsSync(ENDPOINTS_FILE)) {
    try {
      const config = JSON.parse(fs.readFileSync(ENDPOINTS_FILE, 'utf8')) as EndpointsConfig
      console.log('\n📍 Last known endpoints:')
      for (const ep of config.endpoints) {
        console.log(`   ${ep.type}: ${ep.url}`)
      }
    } catch {}
  }
}

function commandLogs(): void {
  const platform = os.platform()

  if (platform === 'darwin') {
    const stdoutLog = path.join(CONFIG_DIR, 'stdout.log')
    const stderrLog = path.join(CONFIG_DIR, 'stderr.log')

    console.log('\n📜 OpenCode Manager Logs\n')
    
    if (fs.existsSync(stdoutLog)) {
      console.log('=== stdout ===')
      const result = spawnSync('tail', ['-50', stdoutLog], { stdio: 'inherit' })
    }
    
    if (fs.existsSync(stderrLog)) {
      console.log('\n=== stderr ===')
      const result = spawnSync('tail', ['-50', stderrLog], { stdio: 'inherit' })
    }

  } else if (platform === 'linux') {
    spawnSync('journalctl', ['--user', '-u', 'opencode-manager', '-f', '--no-pager', '-n', '100'], { stdio: 'inherit' })

  } else {
    console.log(`❌ Unsupported platform: ${platform}`)
  }
}

interface HealthResponse {
  status: string
  timestamp?: string
  database?: string
  opencode?: string
  opencodePort?: number
  opencodeVersion?: string
  opencodeMinVersion?: string
  opencodeVersionSupported?: boolean
  telegram?: {
    running: boolean
    sessions: number
    allowlist: number
  }
  error?: string
}

interface SttStatusResponse {
  server: {
    running: boolean
    model?: string
    port?: number
  }
}

interface TtsVoice {
  id: string
  name: string
}

async function commandHealth(args: string[]): Promise<void> {
  const portIdx = args.findIndex(a => a === '--port' || a === '-p')
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1]) || DEFAULT_PORT : DEFAULT_PORT
  const verbose = args.includes('--verbose') || args.includes('-v')
  const jsonOutput = args.includes('--json')

  // Load auth credentials
  let auth: AuthConfig | null = null
  if (fs.existsSync(AUTH_FILE)) {
    try {
      auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) as AuthConfig
    } catch {}
  }

  const headers: Record<string, string> = {}
  if (auth?.username && auth?.password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`
  }

  const results: {
    backend: { ok: boolean; data?: HealthResponse; error?: string }
    stt: { ok: boolean; data?: SttStatusResponse; error?: string }
    tts: { ok: boolean; voiceCount?: number; error?: string }
  } = {
    backend: { ok: false },
    stt: { ok: false },
    tts: { ok: false },
  }

  // Check backend health
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(5000),
      headers,
    })
    if (response.ok) {
      const data = await response.json() as HealthResponse
      results.backend = { ok: data.status === 'healthy', data }
    } else if (response.status === 401) {
      results.backend = { ok: false, error: 'Authentication failed' }
    } else {
      results.backend = { ok: false, error: `HTTP ${response.status}` }
    }
  } catch (err) {
    results.backend = { ok: false, error: err instanceof Error ? err.message : 'Connection failed' }
  }

  // Check STT status
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/stt/status`, {
      signal: AbortSignal.timeout(5000),
      headers,
    })
    if (response.ok) {
      const data = await response.json() as SttStatusResponse
      results.stt = { ok: data.server?.running === true, data }
    } else {
      results.stt = { ok: false, error: `HTTP ${response.status}` }
    }
  } catch (err) {
    results.stt = { ok: false, error: err instanceof Error ? err.message : 'Connection failed' }
  }

  // Check TTS voices
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/tts/voices`, {
      signal: AbortSignal.timeout(5000),
      headers,
    })
    if (response.ok) {
      const voices = await response.json() as TtsVoice[]
      results.tts = { ok: Array.isArray(voices) && voices.length > 0, voiceCount: voices.length }
    } else {
      results.tts = { ok: false, error: `HTTP ${response.status}` }
    }
  } catch (err) {
    results.tts = { ok: false, error: err instanceof Error ? err.message : 'Connection failed' }
  }

  // Output results
  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2))
    process.exit(results.backend.ok ? 0 : 1)
    return
  }

  console.log('\n🏥 OpenCode Manager Health Check\n')
  console.log(`   Port: ${port}`)
  console.log('')

  // Backend status
  if (results.backend.ok) {
    console.log(`✅ Backend:    healthy`)
    if (verbose && results.backend.data) {
      const d = results.backend.data
      console.log(`               Database: ${d.database || 'unknown'}`)
      console.log(`               OpenCode: ${d.opencode || 'unknown'} (v${d.opencodeVersion || '?'})`)
      if (d.telegram) {
        console.log(`               Telegram: ${d.telegram.running ? 'running' : 'stopped'} (${d.telegram.sessions} sessions)`)
      }
    }
  } else if (results.backend.data?.status === 'degraded') {
    console.log(`⚠️  Backend:    degraded`)
    if (verbose && results.backend.data) {
      console.log(`               Database: ${results.backend.data.database || 'unknown'}`)
      console.log(`               OpenCode: ${results.backend.data.opencode || 'unknown'}`)
    }
  } else {
    console.log(`❌ Backend:    ${results.backend.error || 'unhealthy'}`)
  }

  // STT status
  if (results.stt.ok) {
    console.log(`✅ STT:        running`)
    if (verbose && results.stt.data?.server) {
      console.log(`               Model: ${results.stt.data.server.model || 'unknown'}`)
    }
  } else {
    console.log(`❌ STT:        ${results.stt.error || 'not running'}`)
  }

  // TTS status
  if (results.tts.ok) {
    console.log(`✅ TTS:        available (${results.tts.voiceCount} voice${results.tts.voiceCount === 1 ? '' : 's'})`)
  } else {
    console.log(`❌ TTS:        ${results.tts.error || 'not available'}`)
  }

  console.log('')

  // Overall status
  const allHealthy = results.backend.ok && results.stt.ok && results.tts.ok
  const coreHealthy = results.backend.ok

  if (allHealthy) {
    console.log('🎉 All services healthy!\n')
    process.exit(0)
  } else if (coreHealthy) {
    console.log('⚠️  Core services healthy, some optional services unavailable\n')
    process.exit(0)
  } else {
    console.log('❌ Service unhealthy\n')
    if (!fs.existsSync(AUTH_FILE)) {
      console.log('💡 Tip: No auth credentials found. Is the service installed?')
      console.log(`   Run: opencode-manager install-service\n`)
    } else {
      console.log('💡 Tip: Check logs with: opencode-manager logs\n')
    }
    process.exit(1)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0] || 'help'
  const commandArgs = args.slice(1)

  switch (command) {
    case 'start':
      await commandStart(commandArgs)
      break
    case 'health':
      await commandHealth(commandArgs)
      break
    case 'install-service':
      commandInstallService(commandArgs)
      break
    case 'uninstall-service':
      commandUninstallService()
      break
    case 'status':
      commandStatus()
      break
    case 'logs':
      commandLogs()
      break
    case 'help':
    case '--help':
    case '-h':
      printHelp()
      break
    case 'version':
    case '--version':
    case '-v':
      console.log(`opencode-manager v${VERSION}`)
      break
    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
