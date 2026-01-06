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

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════╗')
  console.log('║   OpenCode Manager - Native Start E2E Tests           ║')
  console.log('╚═══════════════════════════════════════════════════════╝')

  const startTime = Date.now()

  try {
    await testCleanupScript()
    await testNormalMode()
    await testClientMode()
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
