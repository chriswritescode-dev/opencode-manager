import { spawn } from 'child_process'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { createConnection } from 'net'
import type { VecService, VecSearchResult } from './vec-types'

function sendRequest(socketPath: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const client = createConnection({ path: socketPath })
    let data = ''

    const timeout = setTimeout(() => {
      client.destroy()
      reject(new Error('Vec worker timeout'))
    }, 10000)

    client.on('connect', () => {
      client.write(JSON.stringify(request) + '\n')
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
          if (response.error) {
            reject(new Error(response.error))
          } else {
            resolve(response)
          }
          return
        } catch {
          // keep reading
        }
      }
    })

    client.on('error', (err: Error) => {
      clearTimeout(timeout)
      client.destroy()
      reject(err)
    })
  })
}

function isWorkerRunning(pidPath: string, socketPath: string): boolean {
  if (!existsSync(pidPath) || !existsSync(socketPath)) return false
  try {
    const pid = parseInt(readFileSync(pidPath, 'utf-8'), 10)
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function cleanupStale(pidPath: string, socketPath: string): void {
  try {
    if (existsSync(pidPath)) {
      const pid = parseInt(readFileSync(pidPath, 'utf-8'), 10)
      try { process.kill(pid, 0) } catch { unlinkSync(pidPath) }
    }
  } catch {}
  try {
    if (existsSync(socketPath)) unlinkSync(socketPath)
  } catch {}
}

async function startWorker(config: {
  dbPath: string
  dataDir: string
  dimensions: number
}): Promise<string> {
  const socketPath = join(config.dataDir, 'vec-worker.sock')
  const pidPath = join(config.dataDir, 'vec-worker.pid')

  if (isWorkerRunning(pidPath, socketPath)) {
    return socketPath
  }

  cleanupStale(pidPath, socketPath)

  const workerScript = join(__dirname, 'vec-worker.ts')
  const proc = spawn('bun', [
    workerScript,
    '--db', config.dbPath,
    '--socket', socketPath,
    '--pid', pidPath,
    '--dimensions', String(config.dimensions),
  ], {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 250))
    if (existsSync(socketPath)) {
      try {
        const resp = await sendRequest(socketPath, { action: 'health' })
        if (resp.status === 'ok') return socketPath
      } catch {
        // keep waiting
      }
    }
  }

  throw new Error('Failed to start vec worker')
}

export async function createWorkerVecService(config: {
  dbPath: string
  dataDir: string
  dimensions: number
}): Promise<VecService> {
  let socketPath: string
  let isAvailable = false

  try {
    socketPath = await startWorker(config)
    isAvailable = true
  } catch {
    socketPath = ''
    isAvailable = false
  }

  async function req(action: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (!isAvailable) return null
    try {
      return await sendRequest(socketPath, action)
    } catch {
      return null
    }
  }

  return {
    get available() {
      return isAvailable
    },

    async initialize(dimensions: number) {
      await req({ action: 'init', dimensions })
    },

    async insert(embedding: number[], memoryId: number, projectId: string) {
      await req({ action: 'insert', embedding, memoryId, projectId })
    },

    async delete(memoryId: number) {
      await req({ action: 'delete', memoryId })
    },

    async deleteByProject(projectId: string) {
      await req({ action: 'deleteByProject', projectId })
    },

    async deleteByMemoryIds(memoryIds: number[]) {
      await req({ action: 'deleteByMemoryIds', memoryIds })
    },

    async search(embedding: number[], projectId?: string, scope?: string, limit: number = 10): Promise<VecSearchResult[]> {
      const resp = await req({ action: 'search', embedding, projectId, scope, limit })
      if (!resp?.results) return []
      return resp.results as VecSearchResult[]
    },

    async findSimilar(embedding: number[], projectId: string, threshold: number, limit: number): Promise<VecSearchResult[]> {
      const resp = await req({ action: 'findSimilar', embedding, projectId, threshold, limit })
      if (!resp?.results) return []
      return resp.results as VecSearchResult[]
    },

    dispose() {
      const pidPath = join(config.dataDir, 'vec-worker.pid')
      if (existsSync(pidPath)) {
        try {
          const pid = parseInt(readFileSync(pidPath, 'utf-8'), 10)
          process.kill(pid, 'SIGTERM')
        } catch {}
      }
    },
  }
}
