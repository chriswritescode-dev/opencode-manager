#!/usr/bin/env bun
import { spawn, execSync } from 'child_process'
import { createInterface } from 'readline'
import path from 'path'

interface OpenCodeInstance {
  pid: number
  port: number
  cwd: string
  healthy: boolean
  version?: string
}

interface ParsedArgs {
  client: boolean
  tunnel: boolean
  port: number
  help: boolean
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2)
  return {
    client: args.includes('--client') || args.includes('-c'),
    tunnel: args.includes('--tunnel') || args.includes('-t'),
    port: parseInt(args.find((_, i, arr) => arr[i - 1] === '--port' || arr[i - 1] === '-p') || '5001'),
    help: args.includes('--help') || args.includes('-h'),
  }
}

function printHelp() {
  console.log(`
opencode-manager native start

Usage: bun scripts/start-native.ts [options]

Options:
  --client, -c    Connect to an existing opencode server instead of starting one
  --tunnel, -t    Start a Cloudflare tunnel to expose the API publicly
  --port, -p      Port for the backend API (default: 5001)
  --help, -h      Show this help message

Examples:
  # Start normally (spawns opencode serve internally)
  bun scripts/start-native.ts

  # Connect to existing opencode instance
  bun scripts/start-native.ts --client

  # Start with Cloudflare tunnel
  bun scripts/start-native.ts --tunnel

  # Connect to existing instance with tunnel
  bun scripts/start-native.ts --client --tunnel
`)
}

async function findOpenCodeInstances(): Promise<OpenCodeInstance[]> {
  const instances: OpenCodeInstance[] = []

  try {
    const lsofOutput = execSync('lsof -i -P | grep opencode | grep LISTEN', { encoding: 'utf8' })
    const lines = lsofOutput.trim().split('\n').filter(Boolean)

    for (const line of lines) {
      const parts = line.split(/\s+/)
      const pid = parseInt(parts[1] || '0')
      const portMatch = line.match(/:(\d+)\s+\(LISTEN\)/)
      const port = portMatch ? parseInt(portMatch[1]) : 0

      if (!pid || !port) continue

      let cwd = ''
      try {
        cwd = execSync(`lsof -p ${pid} | grep cwd | awk '{print $NF}'`, { encoding: 'utf8' }).trim()
      } catch {
        cwd = 'unknown'
      }

      const healthy = await checkServerHealth(port)

      let version: string | undefined
      if (healthy) {
        try {
          const resp = await fetch(`http://127.0.0.1:${port}/global/health`, { signal: AbortSignal.timeout(2000) })
          if (resp.ok) {
            const data = await resp.json() as { version?: string }
            version = data.version
          }
        } catch {}
      }

      instances.push({ pid, port, cwd, healthy, version })
    }
  } catch {
    // No opencode processes found
  }

  return instances
}

async function checkServerHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/doc`, {
      signal: AbortSignal.timeout(2000)
    })
    return response.ok
  } catch {
    return false
  }
}

async function waitForBackendHealth(port: number, maxSeconds: number): Promise<boolean> {
  for (let i = 0; i < maxSeconds; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2000)
      })
      if (response.ok) {
        const data = await response.json() as { status?: string }
        if (data.status === 'healthy') {
          return true
        }
      }
    } catch {
      // Not ready yet
    }
    if (i > 0 && i % 10 === 0) {
      console.log(`   Still waiting... (${i}s)`)
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

async function promptUserSelection(instances: OpenCodeInstance[]): Promise<OpenCodeInstance | null> {
  const healthyInstances = instances.filter(i => i.healthy)

  if (healthyInstances.length === 0) {
    console.log('\n❌ No healthy opencode servers found.')
    console.log('Start opencode in a terminal first, or run without --client flag.\n')
    return null
  }

  if (healthyInstances.length === 1) {
    const instance = healthyInstances[0]
    console.log(`\n✓ Found 1 opencode server:`)
    console.log(`  Port ${instance.port} - ${instance.cwd} (v${instance.version || 'unknown'})\n`)
    return instance
  }

  console.log('\n📋 Found multiple opencode servers:\n')
  healthyInstances.forEach((instance, index) => {
    console.log(`  [${index + 1}] Port ${instance.port}`)
    console.log(`      Directory: ${instance.cwd}`)
    console.log(`      Version: ${instance.version || 'unknown'}`)
    console.log(`      PID: ${instance.pid}`)
    console.log('')
  })

  const rl = createInterface({ input: process.stdin, output: process.stdout })

  return new Promise((resolve) => {
    rl.question('Select server [1]: ', (answer) => {
      rl.close()
      const selection = parseInt(answer) || 1
      if (selection < 1 || selection > healthyInstances.length) {
        console.log('Invalid selection')
        resolve(null)
      } else {
        resolve(healthyInstances[selection - 1])
      }
    })
  })
}

async function startCloudflaredTunnel(localPort: number): Promise<{ process: ReturnType<typeof spawn>, url: string | null }> {
  console.log('\n🌐 Starting Cloudflare tunnel...')

  const tunnelProcess = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://localhost:${localPort}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let tunnelUrl: string | null = null

  const urlPromise = new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 30000)

    const handleOutput = (data: Buffer) => {
      const output = data.toString()
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
    console.error('\n❌ Failed to start cloudflared:', err.message)
    console.log('Install cloudflared: brew install cloudflared')
  })

  const url = await urlPromise

  if (url) {
    console.log(`✓ Tunnel URL: ${url}\n`)
  }

  return { process: tunnelProcess, url }
}

async function startBackend(port: number, opencodePort?: number): Promise<ReturnType<typeof spawn>> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: port.toString(),
    NODE_ENV: 'development',
  }

  if (opencodePort) {
    env.OPENCODE_SERVER_PORT = opencodePort.toString()
    env.OPENCODE_CLIENT_MODE = 'true'
  }

  console.log(`\n🚀 Starting backend on port ${port}...`)
  if (opencodePort) {
    console.log(`   Connecting to opencode server on port ${opencodePort}`)
  }

  const backendProcess = spawn('bun', ['--watch', 'backend/src/index.ts'], {
    cwd: path.resolve(import.meta.dir, '..'),
    stdio: 'inherit',
    env,
  })

  return backendProcess
}

async function startFrontend(): Promise<{ process: ReturnType<typeof spawn>, port: number }> {
  console.log('🎨 Starting frontend...\n')

  const frontendProcess = spawn('pnpm', ['--filter', 'frontend', 'dev'], {
    cwd: path.resolve(import.meta.dir, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let frontendPort = 5173
  
  const portPromise = new Promise<number>((resolve) => {
    const timeout = setTimeout(() => resolve(5173), 15000)
    
    const handleOutput = (data: Buffer) => {
      const output = data.toString()
      process.stdout.write(output)
      
      const portMatch = output.match(/Local:\s+http:\/\/localhost:(\d+)/)
      if (portMatch) {
        frontendPort = parseInt(portMatch[1])
        clearTimeout(timeout)
        resolve(frontendPort)
      }
    }
    
    frontendProcess.stdout?.on('data', handleOutput)
    frontendProcess.stderr?.on('data', (data: Buffer) => process.stderr.write(data.toString()))
  })

  const port = await portPromise
  return { process: frontendProcess, port }
}

async function main() {
  const args = parseArgs()

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  console.log('\n╔═══════════════════════════════════════╗')
  console.log('║   OpenCode Manager - Native Start     ║')
  console.log('╚═══════════════════════════════════════╝')

  let opencodePort: number | undefined

  if (args.client) {
    console.log('\n🔍 Searching for running opencode servers...')
    const instances = await findOpenCodeInstances()
    const selected = await promptUserSelection(instances)

    if (!selected) {
      process.exit(1)
    }

    opencodePort = selected.port
    console.log(`✓ Will connect to opencode server on port ${opencodePort}`)
  }

  const processes: ReturnType<typeof spawn>[] = []

  const backendProcess = await startBackend(args.port, opencodePort)
  processes.push(backendProcess)

  const frontend = await startFrontend()
  processes.push(frontend.process)

  console.log('\n⏳ Waiting for backend to be ready (this may take ~60s for model loading)...')
  const backendReady = await waitForBackendHealth(args.port, 120)
  if (!backendReady) {
    console.error('❌ Backend failed to start within timeout')
    process.exit(1)
  }
  console.log('✓ Backend is ready!')

  let tunnelProcess: ReturnType<typeof spawn> | null = null
  let tunnelUrl: string | null = null
  if (args.tunnel) {
    const tunnel = await startCloudflaredTunnel(args.port)
    tunnelProcess = tunnel.process
    tunnelUrl = tunnel.url
    processes.push(tunnel.process)

    if (tunnel.url) {
      console.log('\n═══════════════════════════════════════')
      console.log(`🌍 Public URL: ${tunnel.url}`)
      console.log('═══════════════════════════════════════\n')
    }
  }

  console.log('\n📍 Local URLs:')
  console.log(`   Backend:  http://localhost:${args.port}`)
  console.log(`   Frontend: http://localhost:${frontend.port}`)
  if (opencodePort) {
    console.log(`   OpenCode: http://localhost:${opencodePort}`)
  }
  console.log('\nPress Ctrl+C to stop all services\n')

  const cleanup = () => {
    console.log('\n\n🛑 Shutting down...')
    processes.forEach(p => {
      try {
        p.kill('SIGTERM')
      } catch {}
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

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
