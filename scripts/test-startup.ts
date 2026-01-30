#!/usr/bin/env bun
import { spawn, execSync } from 'child_process'
import path from 'path'

const BACKEND_PORT = 5002  // Use a port that's in the cleanup script's list
const OPENCODE_PORT = 5551 // Use the default opencode port
const TIMEOUT_MS = 60000

interface TestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
}

const results: TestResult[] = []

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForHealth(url: string, maxAttempts = 30, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return true
    } catch {}
    await sleep(delayMs)
  }
  return false
}

function killPort(port: number): void {
  try {
    const pids = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    for (const pid of pids) {
      try {
        process.kill(parseInt(pid), 'SIGKILL')
      } catch {}
    }
  } catch {}
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now()
  try {
    await fn()
    results.push({ name, passed: true, duration: Date.now() - start })
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    results.push({ name, passed: false, duration: Date.now() - start, error: errMsg })
    console.log(`  ✗ ${name}: ${errMsg}`)
  }
}

async function cleanupPorts(): Promise<void> {
  killPort(BACKEND_PORT)
  killPort(OPENCODE_PORT)
  await sleep(1000)
}

async function testNormalMode(): Promise<void> {
  console.log('\n📋 Test: Normal Mode (spawns opencode serve)\n')

  await cleanupPorts()

  const proc = spawn('bun', ['scripts/start-native.ts', '--port', BACKEND_PORT.toString()], {
    cwd: path.resolve(import.meta.dir, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OPENCODE_SERVER_PORT: OPENCODE_PORT.toString(),
      NODE_ENV: 'test',
    },
  })

  let output = ''
  proc.stdout?.on('data', (data) => { output += data.toString() })
  proc.stderr?.on('data', (data) => { output += data.toString() })

  try {
    await runTest('Backend starts', async () => {
      const healthy = await waitForHealth(`http://localhost:${BACKEND_PORT}/api/health`, 30, 1000)
      if (!healthy) throw new Error('Backend health check failed')
    })

    await runTest('Health endpoint returns correct data', async () => {
      const resp = await fetch(`http://localhost:${BACKEND_PORT}/api/health`)
      const data = await resp.json() as { status: string; opencodePort: number }
      if (data.status !== 'healthy') throw new Error(`Status is ${data.status}`)
      if (data.opencodePort !== OPENCODE_PORT) throw new Error(`OpenCode port is ${data.opencodePort}`)
    })

    await runTest('OpenCode proxy works', async () => {
      const resp = await fetch(`http://localhost:${BACKEND_PORT}/api/opencode/doc`)
      if (!resp.ok) throw new Error(`OpenCode proxy returned ${resp.status}`)
      const text = await resp.text()
      if (!text.includes('openapi')) throw new Error('Response does not contain OpenAPI spec')
    })

    await runTest('Can list sessions', async () => {
      const resp = await fetch(`http://localhost:${BACKEND_PORT}/api/opencode/session`)
      if (!resp.ok) throw new Error(`Sessions endpoint returned ${resp.status}`)
      const data = await resp.json()
      if (!Array.isArray(data)) throw new Error('Sessions is not an array')
    })

  } finally {
    proc.kill('SIGTERM')
    await sleep(1000)
    await cleanupPorts()
  }
}

async function testClientMode(): Promise<void> {
  console.log('\n📋 Test: Client Mode (connects to existing opencode)\n')

  await cleanupPorts()

  const opencodeProc = spawn('opencode', ['serve', '--port', OPENCODE_PORT.toString(), '--hostname', '127.0.0.1'], {
    cwd: path.resolve(import.meta.dir, '..'),
    stdio: 'ignore',
    detached: true,
  })

  try {
    await runTest('OpenCode server starts', async () => {
      const healthy = await waitForHealth(`http://127.0.0.1:${OPENCODE_PORT}/doc`, 20, 500)
      if (!healthy) throw new Error('OpenCode server failed to start')
    })

    const backendProc = spawn('bun', ['scripts/start-native.ts', '--client', '--port', BACKEND_PORT.toString()], {
      cwd: path.resolve(import.meta.dir, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENCODE_SERVER_PORT: OPENCODE_PORT.toString(),
        OPENCODE_CLIENT_MODE: 'true',
        NODE_ENV: 'test',
      },
    })

    backendProc.stdin?.write('1\n')
    backendProc.stdin?.end()

    try {
      await runTest('Backend connects in client mode', async () => {
        const healthy = await waitForHealth(`http://localhost:${BACKEND_PORT}/api/health`, 30, 1000)
        if (!healthy) throw new Error('Backend health check failed')
      })

      await runTest('Health shows client connected to opencode', async () => {
        const resp = await fetch(`http://localhost:${BACKEND_PORT}/api/health`)
        const data = await resp.json() as { status: string; opencode: string; opencodePort: number }
        if (data.status !== 'healthy') throw new Error(`Status is ${data.status}`)
        if (data.opencode !== 'healthy') throw new Error(`OpenCode status is ${data.opencode}`)
      })

      await runTest('OpenCode proxy works in client mode', async () => {
        const resp = await fetch(`http://localhost:${BACKEND_PORT}/api/opencode/global/health`)
        if (!resp.ok) throw new Error(`OpenCode health returned ${resp.status}`)
        const data = await resp.json() as { healthy: boolean }
        if (!data.healthy) throw new Error('OpenCode not healthy')
      })

      await runTest('OpenCode directory auto-registered as repo', async () => {
        const resp = await fetch(`http://localhost:${BACKEND_PORT}/api/repos`)
        if (!resp.ok) throw new Error(`Repos endpoint returned ${resp.status}`)
        const repos = await resp.json() as Array<{ fullPath: string; isLocal: boolean }>
        if (!Array.isArray(repos)) throw new Error('Repos is not an array')
        
        const projectDir = path.resolve(import.meta.dir, '..')
        const hasProjectRepo = repos.some(r => r.fullPath === projectDir)
        if (!hasProjectRepo) {
          throw new Error(`Expected repo with fullPath '${projectDir}', got: ${repos.map(r => r.fullPath).join(', ')}`)
        }
      })

    } finally {
      backendProc.kill('SIGTERM')
    }

  } finally {
    try {
      opencodeProc.kill('SIGTERM')
    } catch {}
    await sleep(1000)
    await cleanupPorts()
  }
}

async function testCleanupScript(): Promise<void> {
  console.log('\n📋 Test: Cleanup Script\n')

  await cleanupPorts()

  const dummyProc = spawn('bun', ['-e', `const s = Bun.serve({ port: ${BACKEND_PORT}, fetch: () => new Response('ok') }); console.log('listening'); await Bun.sleep(60000)`], {
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: true,
  })

  await new Promise<void>((resolve) => {
    dummyProc.stdout?.on('data', (data) => {
      if (data.toString().includes('listening')) resolve()
    })
    setTimeout(resolve, 3000)
  })

  try {
    await runTest('Cleanup finds process', async () => {
      const output = execSync('bun scripts/cleanup.ts --dry-run', { encoding: 'utf8' })
      if (!output.includes(`Port ${BACKEND_PORT}`)) {
        throw new Error(`Cleanup did not find process on port ${BACKEND_PORT}`)
      }
    })

    await runTest('Cleanup kills process', async () => {
      execSync(`bun scripts/cleanup.ts -p ${BACKEND_PORT} --all`, { encoding: 'utf8' })
      await sleep(500)
      
      try {
        const pids = execSync(`lsof -ti:${BACKEND_PORT}`, { encoding: 'utf8' }).trim()
        if (pids) throw new Error(`Process still running on port ${BACKEND_PORT}`)
      } catch (e) {
        if (e instanceof Error && e.message.includes('Process still running')) throw e
      }
    })

  } finally {
    try {
      dummyProc.kill('SIGKILL')
    } catch {}
    await cleanupPorts()
  }
}

async function testTunnelMode(): Promise<void> {
  console.log('\n📋 Test: Tunnel Mode (Cloudflare tunnel)\n')

  await cleanupPorts()

  let hasTunnel = true
  try {
    execSync('which cloudflared', { stdio: 'pipe' })
  } catch {
    console.log('  ⚠ cloudflared not installed, skipping tunnel tests')
    hasTunnel = false
    return
  }

  const opencodeProc = spawn('opencode', ['serve', '--port', OPENCODE_PORT.toString(), '--hostname', '127.0.0.1'], {
    cwd: path.resolve(import.meta.dir, '..'),
    stdio: 'ignore',
    detached: true,
  })

  await waitForHealth(`http://127.0.0.1:${OPENCODE_PORT}/doc`, 20, 500)

  const proc = spawn('bun', ['scripts/start-native.ts', '--client', '--tunnel', '--port', BACKEND_PORT.toString()], {
    cwd: path.resolve(import.meta.dir, '..'),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OPENCODE_SERVER_PORT: OPENCODE_PORT.toString(),
      OPENCODE_CLIENT_MODE: 'true',
      NODE_ENV: 'test',
    },
  })

  proc.stdin?.write('1\n')
  proc.stdin?.end()

  let output = ''
  let tunnelUrl = ''
  proc.stdout?.on('data', (data) => { 
    output += data.toString()
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
    if (match && !tunnelUrl) tunnelUrl = match[0]
  })
  proc.stderr?.on('data', (data) => { output += data.toString() })

  try {
    await runTest('Tunnel URL is captured', async () => {
      for (let i = 0; i < 30 && !tunnelUrl; i++) {
        await sleep(1000)
      }
      if (!tunnelUrl) throw new Error('Tunnel URL not found in output')
    })

    await runTest('Local backend is accessible', async () => {
      const healthy = await waitForHealth(`http://localhost:${BACKEND_PORT}/api/health`, 30, 1000)
      if (!healthy) throw new Error('Backend health check failed')
    })

    await runTest('Tunnel URL is reachable', async () => {
      if (!tunnelUrl) throw new Error('No tunnel URL')
      
      let reached = false
      for (let i = 0; i < 10; i++) {
        try {
          const resp = await fetch(tunnelUrl, { signal: AbortSignal.timeout(5000) })
          if (resp.ok || resp.status === 200) {
            reached = true
            break
          }
        } catch {}
        await sleep(2000)
      }
      if (!reached) throw new Error(`Tunnel URL ${tunnelUrl} not reachable`)
    })

    await runTest('API accessible via tunnel', async () => {
      if (!tunnelUrl) throw new Error('No tunnel URL')
      
      let success = false
      for (let i = 0; i < 5; i++) {
        try {
          const resp = await fetch(`${tunnelUrl}/api/health`, { signal: AbortSignal.timeout(5000) })
          if (resp.ok) {
            const data = await resp.json() as { status: string }
            if (data.status === 'healthy') {
              success = true
              break
            }
          }
        } catch {}
        await sleep(2000)
      }
      if (!success) throw new Error('API health check via tunnel failed')
    })

  } finally {
    proc.kill('SIGTERM')
    try {
      opencodeProc.kill('SIGTERM')
    } catch {}
    await sleep(1000)
    await cleanupPorts()
  }
}

interface EndpointEntry {
  type: 'local' | 'tunnel'
  url: string
  timestamp: string
}

interface EndpointsConfig {
  endpoints: EndpointEntry[]
}

async function testEndpointsFile(): Promise<void> {
  console.log('\n📋 Test: Endpoints File (regression test for tunnel URL persistence)\n')

  const fs = await import('fs')
  const os = await import('os')
  const endpointsPath = path.join(os.homedir(), '.local', 'run', 'opencode-manager', 'endpoints.json')
  const authPath = path.join(os.homedir(), '.local', 'run', 'opencode-manager', 'auth.json')

  await runTest('Endpoints file exists', async () => {
    if (!fs.existsSync(endpointsPath)) {
      throw new Error(`Endpoints file not found at ${endpointsPath}`)
    }
  })

  let config: EndpointsConfig | null = null

  await runTest('Endpoints file has valid JSON structure', async () => {
    const content = fs.readFileSync(endpointsPath, 'utf8')
    config = JSON.parse(content) as EndpointsConfig
    
    if (!config.endpoints || !Array.isArray(config.endpoints)) {
      throw new Error('endpoints.json missing "endpoints" array')
    }
  })

  await runTest('Endpoints file contains local endpoint', async () => {
    if (!config) throw new Error('Config not loaded')
    
    const localEndpoint = config.endpoints.find(e => e.type === 'local')
    if (!localEndpoint) {
      throw new Error('No local endpoint found')
    }
    if (!localEndpoint.url.startsWith('http://localhost:')) {
      throw new Error(`Invalid local URL: ${localEndpoint.url}`)
    }
    if (!localEndpoint.timestamp) {
      throw new Error('Local endpoint missing timestamp')
    }
  })

  await runTest('Endpoints file contains tunnel endpoint', async () => {
    if (!config) throw new Error('Config not loaded')
    
    const tunnelEndpoint = config.endpoints.find(e => e.type === 'tunnel')
    if (!tunnelEndpoint) {
      throw new Error('No tunnel endpoint found - this was the bug we fixed!')
    }
    if (!tunnelEndpoint.url.includes('.trycloudflare.com')) {
      throw new Error(`Invalid tunnel URL: ${tunnelEndpoint.url}`)
    }
    if (!tunnelEndpoint.timestamp) {
      throw new Error('Tunnel endpoint missing timestamp')
    }
  })

  await runTest('Tunnel endpoint timestamp is recent (within 24h)', async () => {
    if (!config) throw new Error('Config not loaded')
    
    const tunnelEndpoint = config.endpoints.find(e => e.type === 'tunnel')
    if (!tunnelEndpoint) throw new Error('No tunnel endpoint')
    
    const timestamp = new Date(tunnelEndpoint.timestamp)
    const now = new Date()
    const hoursDiff = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60)
    
    if (hoursDiff > 24) {
      throw new Error(`Tunnel timestamp is ${hoursDiff.toFixed(1)} hours old - endpoints may not be updating properly`)
    }
  })

  let authConfig: { username?: string; password?: string } | null = null
  
  await runTest('Auth file exists and has credentials', async () => {
    if (!fs.existsSync(authPath)) {
      throw new Error(`Auth file not found at ${authPath}`)
    }
    const content = fs.readFileSync(authPath, 'utf8')
    authConfig = JSON.parse(content)
    
    if (!authConfig?.username || !authConfig?.password) {
      throw new Error('Auth file missing username or password')
    }
  })

  await runTest('Tunnel URL is accessible and returns webapp', async () => {
    if (!config) throw new Error('Config not loaded')
    if (!authConfig) throw new Error('Auth not loaded')
    
    const tunnelEndpoint = config.endpoints.find(e => e.type === 'tunnel')
    if (!tunnelEndpoint) throw new Error('No tunnel endpoint')
    
    let tunnelUrl = tunnelEndpoint.url
    if (!tunnelUrl.includes('@')) {
      const urlObj = new URL(tunnelUrl)
      urlObj.username = authConfig.username!
      urlObj.password = authConfig.password!
      tunnelUrl = urlObj.toString()
    }
    
    let success = false
    let lastError = ''
    
    for (let i = 0; i < 5; i++) {
      try {
        const resp = await fetch(`${tunnelUrl}/api/health`, { 
          signal: AbortSignal.timeout(10000),
          headers: {
            'Authorization': `Basic ${Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64')}`
          }
        })
        
        if (resp.ok) {
          const data = await resp.json() as { status: string }
          if (data.status === 'healthy') {
            success = true
            break
          }
          lastError = `Status: ${data.status}`
        } else {
          lastError = `HTTP ${resp.status}`
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
      await sleep(2000)
    }
    
    if (!success) {
      throw new Error(`Tunnel URL not accessible: ${lastError}. URL: ${tunnelUrl.replace(/:[^:@]+@/, ':***@')}`)
    }
  })

  await runTest('Tunnel serves HTML for root path (webapp)', async () => {
    if (!config) throw new Error('Config not loaded')
    if (!authConfig) throw new Error('Auth not loaded')
    
    const tunnelEndpoint = config.endpoints.find(e => e.type === 'tunnel')
    if (!tunnelEndpoint) throw new Error('No tunnel endpoint')
    
    let tunnelUrl = tunnelEndpoint.url
    if (!tunnelUrl.includes('@')) {
      const urlObj = new URL(tunnelUrl)
      urlObj.username = authConfig.username!
      urlObj.password = authConfig.password!
      tunnelUrl = urlObj.toString()
    }
    
    const resp = await fetch(tunnelUrl, { 
      signal: AbortSignal.timeout(10000),
      headers: {
        'Authorization': `Basic ${Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64')}`
      }
    })
    
    if (!resp.ok) {
      throw new Error(`Root path returned HTTP ${resp.status}`)
    }
    
    const contentType = resp.headers.get('content-type') || ''
    const body = await resp.text()
    
    if (!contentType.includes('text/html') && !body.includes('<!DOCTYPE') && !body.includes('<html')) {
      throw new Error(`Root path did not return HTML. Content-Type: ${contentType}`)
    }
  })
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════╗')
  console.log('║   OpenCode Manager - Native Start E2E Tests           ║')
  console.log('╚═══════════════════════════════════════════════════════╝')

  const startTime = Date.now()

  try {
    await testEndpointsFile()
    await testCleanupScript()
    await testNormalMode()
    await testClientMode()
    await testTunnelMode()
  } catch (error) {
    console.error('\n❌ Test suite failed:', error)
  }

  await cleanupPorts()

  console.log('\n═══════════════════════════════════════════════════════')
  console.log('                      RESULTS                          ')
  console.log('═══════════════════════════════════════════════════════\n')

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  for (const result of results) {
    const status = result.passed ? '✓' : '✗'
    const error = result.error ? ` - ${result.error}` : ''
    console.log(`  ${status} ${result.name} (${result.duration}ms)${error}`)
  }

  console.log(`\n  Total: ${passed} passed, ${failed} failed`)
  console.log(`  Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`)

  process.exit(failed > 0 ? 1 : 0)
}

main()
