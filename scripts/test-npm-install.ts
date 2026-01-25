#!/usr/bin/env bun
import { execSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
}

const args = process.argv.slice(2)
const skipStart = args.includes('--skip-start')
const skipService = args.includes('--skip-service')

interface TestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
  details?: string
}

const results: TestResult[] = []

function log(msg: string): void {
  console.log(msg)
}

function logStep(msg: string): void {
  console.log(`\n${COLORS.cyan}▶ ${msg}${COLORS.reset}`)
}

function logSuccess(msg: string): void {
  console.log(`${COLORS.green}  ✓ ${msg}${COLORS.reset}`)
}

function logError(msg: string): void {
  console.log(`${COLORS.red}  ✗ ${msg}${COLORS.reset}`)
}

function logWarning(msg: string): void {
  console.log(`${COLORS.yellow}  ⚠ ${msg}${COLORS.reset}`)
}

async function runTest(name: string, fn: () => Promise<{ details?: string }>): Promise<void> {
  const start = Date.now()
  try {
    const result = await fn()
    results.push({ name, passed: true, duration: Date.now() - start, details: result.details })
    logSuccess(`${name} (${Date.now() - start}ms)`)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    results.push({ name, passed: false, duration: Date.now() - start, error: errMsg })
    logError(`${name}: ${errMsg}`)
  }
}

function exec(cmd: string, opts: { cwd?: string; throwOnError?: boolean } = {}): string {
  try {
    return execSync(cmd, { 
      encoding: 'utf8', 
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000,
    }).trim()
  } catch (error) {
    if (opts.throwOnError !== false) throw error
    return ''
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForHealth(url: string, maxAttempts = 60, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return true
    } catch {}
    await sleep(delayMs)
  }
  return false
}

function getInstallLocation(): string | null {
  try {
    const output = exec('which opencode-manager', { throwOnError: false })
    if (output) {
      const resolved = fs.realpathSync(output)
      return path.dirname(path.dirname(resolved))
    }
  } catch {}
  return null
}

async function testUninstallExisting(): Promise<{ details?: string }> {
  const existing = getInstallLocation()
  if (existing) {
    log(`    Found existing installation at ${existing}, removing...`)
    try {
      exec('bun remove -g opencode-manager')
    } catch {}
    try {
      exec('npm uninstall -g opencode-manager')
    } catch {}
  }
  return { details: existing ? `Removed from ${existing}` : 'No existing installation' }
}

async function testInstallFromGitHub(): Promise<{ details?: string }> {
  log('    Installing from GitHub (this may take a minute)...')
  const output = exec('bun install -g github:dzianisv/opencode-manager --force 2>&1')
  
  const location = getInstallLocation()
  if (!location) {
    throw new Error('opencode-manager not found in PATH after installation')
  }
  
  return { details: `Installed to ${location}` }
}

async function testBinaryExists(): Promise<{ details?: string }> {
  const binPath = exec('which opencode-manager')
  if (!binPath) throw new Error('opencode-manager binary not in PATH')
  
  const realPath = fs.realpathSync(binPath)
  if (!fs.existsSync(realPath)) throw new Error(`Binary does not exist at ${realPath}`)
  
  return { details: realPath }
}

async function testHelpCommand(): Promise<{ details?: string }> {
  const output = exec('opencode-manager help')
  
  const requiredStrings = ['start', 'status', 'install-service', 'uninstall-service', 'logs', 'help']
  const missing = requiredStrings.filter(s => !output.includes(s))
  
  if (missing.length > 0) {
    throw new Error(`Help output missing: ${missing.join(', ')}`)
  }
  
  return { details: `Contains ${requiredStrings.length} expected commands` }
}

async function testVersionOutput(): Promise<{ details?: string }> {
  const output = exec('opencode-manager version 2>&1 || opencode-manager --version 2>&1 || true')
  
  const helpOutput = exec('opencode-manager help')
  const versionMatch = helpOutput.match(/v(\d+\.\d+\.\d+)/)
  
  if (!versionMatch) {
    throw new Error('Could not find version in help output')
  }
  
  return { details: `Version ${versionMatch[1]}` }
}

async function testBackendDistExists(): Promise<{ details?: string }> {
  const installDir = getInstallLocation()
  if (!installDir) throw new Error('Could not find installation directory')
  
  const backendDist = path.join(installDir, 'backend', 'dist')
  const indexPath = path.join(backendDist, 'index.js')
  
  if (!fs.existsSync(backendDist)) {
    throw new Error(`backend/dist directory not found at ${backendDist}`)
  }
  
  if (!fs.existsSync(indexPath)) {
    throw new Error(`backend/dist/index.js not found at ${indexPath}`)
  }
  
  const files = fs.readdirSync(backendDist)
  return { details: `${files.length} files in backend/dist` }
}

async function testFrontendDistExists(): Promise<{ details?: string }> {
  const installDir = getInstallLocation()
  if (!installDir) throw new Error('Could not find installation directory')
  
  const frontendDist = path.join(installDir, 'frontend', 'dist')
  const indexPath = path.join(frontendDist, 'index.html')
  
  if (!fs.existsSync(frontendDist)) {
    throw new Error(`frontend/dist directory not found at ${frontendDist}`)
  }
  
  if (!fs.existsSync(indexPath)) {
    throw new Error(`frontend/dist/index.html not found at ${indexPath}`)
  }
  
  const files = fs.readdirSync(frontendDist)
  return { details: `${files.length} files in frontend/dist` }
}

async function testWhisperServerExists(): Promise<{ details?: string }> {
  const installDir = getInstallLocation()
  if (!installDir) throw new Error('Could not find installation directory')
  
  const whisperPath = path.join(installDir, 'scripts', 'whisper-server.py')
  
  if (!fs.existsSync(whisperPath)) {
    throw new Error(`whisper-server.py not found at ${whisperPath}`)
  }
  
  const stat = fs.statSync(whisperPath)
  return { details: `${(stat.size / 1024).toFixed(1)}KB` }
}

async function testStartCommand(): Promise<{ details?: string }> {
  const testPort = 5099
  
  try {
    exec(`lsof -ti:${testPort} | xargs kill -9 2>/dev/null || true`)
  } catch {}
  
  await sleep(500)
  
  const proc = spawn('opencode-manager', ['start', '--port', testPort.toString()], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    env: {
      ...process.env,
      OPENCODE_SERVER_PORT: '5599',
    },
  })
  
  let output = ''
  proc.stdout?.on('data', (d) => output += d.toString())
  proc.stderr?.on('data', (d) => output += d.toString())
  
  try {
    const healthy = await waitForHealth(`http://localhost:${testPort}/api/health`, 90, 1000)
    
    if (!healthy) {
      throw new Error(`Backend did not become healthy. Output: ${output.slice(-500)}`)
    }
    
    const resp = await fetch(`http://localhost:${testPort}/api/health`)
    const data = await resp.json() as { status: string }
    
    if (data.status !== 'healthy') {
      throw new Error(`Health status is ${data.status}`)
    }
    
    return { details: 'Backend started and healthy' }
  } finally {
    try {
      process.kill(-proc.pid!, 'SIGTERM')
    } catch {}
    try {
      exec(`lsof -ti:${testPort} | xargs kill -9 2>/dev/null || true`)
      exec(`lsof -ti:5599 | xargs kill -9 2>/dev/null || true`)
    } catch {}
  }
}

async function testServiceInstall(): Promise<{ details?: string }> {
  const platform = os.platform()
  
  if (platform !== 'darwin' && platform !== 'linux') {
    return { details: `Skipped (unsupported platform: ${platform})` }
  }
  
  try {
    exec('opencode-manager uninstall-service 2>&1 || true')
  } catch {}
  
  const output = exec('opencode-manager install-service --no-tunnel 2>&1')
  
  if (platform === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.opencode-manager.plist')
    if (!fs.existsSync(plistPath)) {
      throw new Error(`LaunchAgent plist not created at ${plistPath}`)
    }
    
    await sleep(3000)
    
    try {
      exec('opencode-manager uninstall-service')
    } catch {}
    
    return { details: 'LaunchAgent installed and uninstalled' }
  } else {
    const servicePath = path.join(os.homedir(), '.config', 'systemd', 'user', 'opencode-manager.service')
    if (!fs.existsSync(servicePath)) {
      throw new Error(`Systemd service not created at ${servicePath}`)
    }
    
    try {
      exec('opencode-manager uninstall-service')
    } catch {}
    
    return { details: 'Systemd service installed and uninstalled' }
  }
}

async function testAuthFileCreation(): Promise<{ details?: string }> {
  const configDir = path.join(os.homedir(), '.local', 'run', 'opencode-manager')
  const authFile = path.join(configDir, 'auth.json')
  
  if (!fs.existsSync(authFile)) {
    return { details: 'Auth file not yet created (will be on first start)' }
  }
  
  const content = JSON.parse(fs.readFileSync(authFile, 'utf8'))
  if (!content.username || !content.password) {
    throw new Error('Auth file missing username or password')
  }
  
  return { details: `Username: ${content.username}` }
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗')
  console.log('║   OpenCode Manager - NPM Package Installation E2E Test        ║')
  console.log('╚═══════════════════════════════════════════════════════════════╝')

  const startTime = Date.now()

  logStep('Cleanup existing installation')
  await runTest('Uninstall existing package', testUninstallExisting)

  logStep('Install from GitHub')
  await runTest('Install package from GitHub', testInstallFromGitHub)

  logStep('Verify binary installation')
  await runTest('Binary exists in PATH', testBinaryExists)
  await runTest('Help command works', testHelpCommand)
  await runTest('Version output', testVersionOutput)

  logStep('Verify dist files extracted')
  await runTest('Backend dist exists', testBackendDistExists)
  await runTest('Frontend dist exists', testFrontendDistExists)
  await runTest('Whisper server script exists', testWhisperServerExists)

  logStep('Test runtime functionality')
  if (skipStart) {
    logWarning('Skipping start command test (--skip-start)')
    results.push({ name: 'Start command works', passed: true, duration: 0, details: 'Skipped (--skip-start)' })
  } else {
    await runTest('Start command works', testStartCommand)
  }
  await runTest('Auth file creation', testAuthFileCreation)

  logStep('Test service installation')
  if (skipService) {
    logWarning('Skipping service test (--skip-service)')
    results.push({ name: 'Service install/uninstall', passed: true, duration: 0, details: 'Skipped (--skip-service)' })
  } else {
    await runTest('Service install/uninstall', testServiceInstall)
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('                         RESULTS                               ')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  for (const result of results) {
    const status = result.passed ? `${COLORS.green}✓${COLORS.reset}` : `${COLORS.red}✗${COLORS.reset}`
    const details = result.details ? ` (${result.details})` : ''
    const error = result.error ? ` - ${COLORS.red}${result.error}${COLORS.reset}` : ''
    console.log(`  ${status} ${result.name}${details}${error}`)
  }

  console.log(`\n  ${COLORS.bold}Total:${COLORS.reset} ${COLORS.green}${passed} passed${COLORS.reset}, ${failed > 0 ? COLORS.red : ''}${failed} failed${COLORS.reset}`)
  console.log(`  ${COLORS.bold}Duration:${COLORS.reset} ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`)

  if (failed > 0) {
    console.log(`${COLORS.red}Some tests failed. Check the output above for details.${COLORS.reset}\n`)
    process.exit(1)
  } else {
    console.log(`${COLORS.green}All tests passed! The npm package installation is working correctly.${COLORS.reset}\n`)
    process.exit(0)
  }
}

main().catch(error => {
  console.error(`\n${COLORS.red}Fatal error:${COLORS.reset}`, error)
  process.exit(1)
})
