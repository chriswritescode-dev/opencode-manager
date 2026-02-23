import { existsSync, mkdirSync, rmSync, readFileSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import * as net from 'net'

export interface SharedEmbeddingConfig {
  dataDir: string
  model: string
  dimensions: number
  gracePeriod?: number
}

export async function isServerRunning(dataDir: string): Promise<boolean> {
  const pidPath = join(dataDir, 'embedding.pid')
  const socketPath = join(dataDir, 'embedding.sock')

  if (!existsSync(pidPath) || !existsSync(socketPath)) {
    return false
  }

  try {
    const pid = parseInt(readFileSync(pidPath, 'utf-8'), 10)
    
    try {
      process.kill(pid, 0)
    } catch {
      return false
    }

    const health = await checkServerHealth(socketPath)
    return health !== null
  } catch {
    return false
  }
}

export async function checkServerHealth(socketPath: string): Promise<{ status: string; clients: number; uptime: number; dimensions: number; model?: string } | null> {
  return new Promise((resolve) => {
    const client = net.createConnection({ path: socketPath })

    let data = ''

    const timeout = setTimeout(() => {
      client.destroy()
      resolve(null)
    }, 3000)

    client.on('connect', () => {
      client.write(JSON.stringify({ action: 'health' }) + '\n')
    })

    client.on('data', (chunk: Buffer) => {
      data += chunk.toString()
      const lines = data.split('\n')
      
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const response = JSON.parse(line)
          clearTimeout(timeout)
          client.end()
          if (response.status === 'ok') {
            resolve(response)
          } else {
            resolve(null)
          }
          return
        } catch {
          // Continue waiting
        }
      }
    })

    client.on('error', () => {
      clearTimeout(timeout)
      client.destroy()
      resolve(null)
    })
  })
}

export async function acquireEmbeddingServer(config: SharedEmbeddingConfig): Promise<boolean> {
  const { dataDir, model, dimensions, gracePeriod = 30000 } = config
  
  const socketPath = join(dataDir, 'embedding.sock')
  const pidPath = join(dataDir, 'embedding.pid')
  const lockPath = join(dataDir, 'embedding.startup.lock')

  const running = await isServerRunning(dataDir)
  
  if (running) {
    const health = await checkServerHealth(socketPath)
    if (health !== null) {
      const serverModel = health.model
      const dimensionsMatch = health.dimensions === dimensions
      
      let modelMatches: boolean
      if (serverModel === undefined) {
        modelMatches = dimensionsMatch
      } else {
        modelMatches = serverModel === model
      }
      
      if (modelMatches && dimensionsMatch) {
        return true
      }
      
      await killEmbeddingServer(dataDir)
    }
  }

  const lockAcquired = await acquireLock(lockPath)
  if (!lockAcquired) {
    for (let i = 0; i < 10; i++) {
      await sleep(500)
      const health = await checkServerHealth(socketPath)
      if (health !== null) {
        const serverModel = health.model
        const dimensionsMatch = health.dimensions === dimensions
        
        let modelMatches: boolean
        if (serverModel === undefined) {
          modelMatches = dimensionsMatch
        } else {
          modelMatches = serverModel === model
        }
        
        if (modelMatches && dimensionsMatch) {
          return true
        }
      }
    }
    return false
  }

  try {
    if (await isServerRunning(dataDir)) {
      const health = await checkServerHealth(socketPath)
      if (health !== null) {
        const serverModel = health.model
        const dimensionsMatch = health.dimensions === dimensions
        
        let modelMatches: boolean
        if (serverModel === undefined) {
          modelMatches = dimensionsMatch
        } else {
          modelMatches = serverModel === model
        }
        
        if (modelMatches && dimensionsMatch) {
          return true
        }
        
        await killEmbeddingServer(dataDir)
      }
    }

    cleanupStaleFiles(dataDir)

    const serverScriptPath = join(__dirname, 'server.js')
    
    if (!existsSync(serverScriptPath)) {
      console.error('[memory] Server script not found:', serverScriptPath)
      return false
    }

    const serverProcess = spawn(
      'bun',
      [
        serverScriptPath,
        '--socket', socketPath,
        '--pid', pidPath,
        '--model', model,
        '--dimensions', String(dimensions),
        '--grace-period', String(gracePeriod),
      ],
      {
        detached: true,
        stdio: 'ignore',
      }
    )

    serverProcess.unref()

    for (let i = 0; i < 30; i++) {
      await sleep(500)
      const health = await checkServerHealth(socketPath)
      if (health !== null) {
        return true
      }
    }

    return false
  } catch (error) {
    console.error('[memory] Failed to start embedding server:', error)
    return false
  } finally {
    releaseLock(lockPath)
  }
}

async function acquireLock(lockPath: string): Promise<boolean> {
  try {
    if (existsSync(lockPath)) {
      const lockAge = Date.now() - (statSync(lockPath).mtimeMs)
      if (lockAge > 30000) {
        rmSync(lockPath, { recursive: true, force: true })
      } else {
        return false
      }
    }

    const lockDir = join(lockPath, '..')
    if (!existsSync(lockDir)) {
      mkdirSync(lockDir, { recursive: true })
    }
    mkdirSync(lockPath)
    return true
  } catch {
    return false
  }
}

function releaseLock(lockPath: string): void {
  try {
    if (existsSync(lockPath)) {
      rmSync(lockPath, { recursive: true, force: true })
    }
  } catch {
    // Ignore errors
  }
}

export function cleanupStaleFiles(dataDir: string): void {
  const pidPath = join(dataDir, 'embedding.pid')
  const socketPath = join(dataDir, 'embedding.sock')

  try {
    if (existsSync(pidPath)) {
      const pid = parseInt(readFileSync(pidPath, 'utf-8'), 10)
      try {
        process.kill(pid, 0)
      } catch {
        if (existsSync(pidPath)) {
          unlinkSync(pidPath)
        }
      }
    }
  } catch {
    // Ignore errors
  }

  try {
    if (existsSync(socketPath)) {
      unlinkSync(socketPath)
    }
  } catch {
    // Ignore errors
  }
}

export async function killEmbeddingServer(dataDir: string): Promise<boolean> {
  const pidPath = join(dataDir, 'embedding.pid')
  const socketPath = join(dataDir, 'embedding.sock')

  let pid: number | null = null

  try {
    if (existsSync(pidPath)) {
      pid = parseInt(readFileSync(pidPath, 'utf-8'), 10)
    }
  } catch {
    // Ignore read errors
  }

  if (pid === null) {
    return false
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Process may already be dead
  }

  for (let i = 0; i < 20; i++) {
    await sleep(250)
    try {
      process.kill(pid, 0)
    } catch {
      break
    }
  }

  try {
    if (existsSync(pidPath)) {
      unlinkSync(pidPath)
    }
  } catch {
    // Ignore cleanup errors
  }

  try {
    if (existsSync(socketPath)) {
      unlinkSync(socketPath)
    }
  } catch {
    // Ignore cleanup errors
  }

  return true
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
