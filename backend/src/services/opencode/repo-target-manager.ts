import { spawn } from 'child_process'
import path from 'path'
import { promises as fs } from 'fs'
import { logger } from '../../utils/logger'
import { getWorkspacePath, getOpenCodeConfigFilePath, ENV } from '@opencode-manager/shared/config/env'
import type { EnsureOpenCodeTargetResponse, OpenCodeTargetState } from '@opencode-manager/shared/types'
import { createRepoTargetToken } from './repo-target-token'
import type { Repo } from '../../types/repo'

const HEALTH_CHECK_TIMEOUT_MS = 3000
const HEALTH_CHECK_INTERVAL_MS = 500
const TARGET_BASE_DIR = 'opencode-targets'
const PROXY_PATH_PREFIX = '/api/opencode-targets/repo'

interface RepoOpenCodeTargetRuntime {
  repoId: number
  directory: string
  port: number
  process: ReturnType<typeof spawn> | null
  state: OpenCodeTargetState
  token: string
  startedAt: number
  lastUsedAt: number
  lastError?: string
}

async function allocateFreePort(): Promise<number> {
  const { createServer } = await import('net')
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to get allocated port'))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

async function healthCheck(url: string, timeoutMs: number, credentials?: { username: string; password: string }): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const headers: Record<string, string> = {}
    if (credentials) {
      const token = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')
      headers.Authorization = `Basic ${token}`
    }
    const response = await fetch(`${url}/doc`, { signal: controller.signal, headers })
    clearTimeout(timer)
    return response.ok
  } catch {
    return false
  }
}

export class RepoOpenCodeTargetManager {
  private targets: Map<number, RepoOpenCodeTargetRuntime> = new Map()
  private inFlight: Map<number, Promise<EnsureOpenCodeTargetResponse>> = new Map()

  async ensureTarget(repo: Repo): Promise<EnsureOpenCodeTargetResponse> {
    const existingInFlight = this.inFlight.get(repo.id)
    if (existingInFlight) {
      return existingInFlight
    }

    const existing = this.targets.get(repo.id)

    if (existing && existing.state === 'healthy' && existing.process) {
      existing.lastUsedAt = Date.now()
      const openCodeUrl = `http://127.0.0.1:${existing.port}`
      const healthy = await healthCheck(openCodeUrl, HEALTH_CHECK_TIMEOUT_MS, { username: 'opencode', password: existing.token })
      if (healthy) {
        return {
          repoId: repo.id,
          state: 'healthy',
          openCodeUrl: `${PROXY_PATH_PREFIX}/${repo.id}`,
          headers: { Authorization: `Bearer ${existing.token}` },
          reused: true,
        }
      }
      logger.warn(`Target for repo ${repo.id} failed health check, restarting`)
      await this.killProcess(existing)
      existing.process = null
      existing.state = 'failed'
    }

    if (existing && (existing.state === 'starting' || existing.state === 'unhealthy')) {
      const openCodeUrl = `http://127.0.0.1:${existing.port}`
      const healthy = await healthCheck(openCodeUrl, HEALTH_CHECK_TIMEOUT_MS, { username: 'opencode', password: existing.token })
      if (healthy) {
        existing.state = 'healthy'
        existing.lastUsedAt = Date.now()
        return {
          repoId: repo.id,
          state: 'healthy',
          openCodeUrl: `${PROXY_PATH_PREFIX}/${repo.id}`,
          headers: { Authorization: `Bearer ${existing.token}` },
          reused: true,
        }
      }
    }

    const startPromise = this.startTarget(repo, existing)

    try {
      this.inFlight.set(repo.id, startPromise)
      const result = await startPromise
      return result
    } finally {
      this.inFlight.delete(repo.id)
    }
  }

  private async startTarget(repo: Repo, existing: RepoOpenCodeTargetRuntime | undefined): Promise<EnsureOpenCodeTargetResponse> {
    const directory = path.join(getWorkspacePath(), TARGET_BASE_DIR, `repo-${repo.id}`)
    await fs.mkdir(path.join(directory, 'state'), { recursive: true })
    await fs.mkdir(path.join(directory, 'config'), { recursive: true })

    const port = existing?.port ?? await allocateFreePort()
    const token = existing?.token ?? createRepoTargetToken(repo.id)

    const runtime: RepoOpenCodeTargetRuntime = {
      repoId: repo.id,
      directory,
      port,
      process: null,
      state: 'starting',
      token,
      startedAt: Date.now(),
      lastUsedAt: Date.now(),
      lastError: undefined,
    }

    this.targets.set(repo.id, runtime)

    await this.startProcess(runtime, repo.fullPath)

    return {
      repoId: repo.id,
      state: runtime.state,
      openCodeUrl: `${PROXY_PATH_PREFIX}/${repo.id}`,
      headers: { Authorization: `Bearer ${token}` },
      reused: false,
    }
  }

  getTarget(repoId: number): RepoOpenCodeTargetRuntime | null {
    return this.targets.get(repoId) ?? null
  }

  async stopTarget(repoId: number, reason: 'idle' | 'manual' | 'shutdown'): Promise<void> {
    const runtime = this.targets.get(repoId)
    if (!runtime) return

    logger.info(`Stopping target for repo ${repoId} (reason: ${reason})`)
    await this.killProcess(runtime)
    runtime.process = null
    runtime.state = 'stopped'

    if (reason === 'shutdown') {
      this.targets.delete(repoId)
    }
  }

  private async startProcess(runtime: RepoOpenCodeTargetRuntime, cwd: string): Promise<void> {
    const isDevelopment = ENV.SERVER.NODE_ENV !== 'production'
    const password = runtime.token
    const openCodeConfigPath = getOpenCodeConfigFilePath()

    let stderrOutput = ''

    const cleanEnv = { ...process.env }
    delete cleanEnv.OPENCODE_SERVER_PASSWORD
    delete cleanEnv.OPENCODE_RUN_ID
    delete cleanEnv.OPENCODE_PROCESS_ROLE
    delete cleanEnv.OPENCODE_PID
    delete cleanEnv.OPENCODE

    const child = spawn(
      'opencode',
      ['serve', '--port', runtime.port.toString(), '--hostname', '127.0.0.1'],
      {
        cwd,
        detached: !isDevelopment,
        stdio: isDevelopment ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        env: {
          ...cleanEnv,
          XDG_DATA_HOME: path.join(runtime.directory, 'state'),
          XDG_STATE_HOME: path.join(runtime.directory, 'state'),
          XDG_CONFIG_HOME: path.join(runtime.directory, 'config'),
          OPENCODE_CONFIG: openCodeConfigPath,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_SERVER_USERNAME: 'opencode',
        }
      }
    )

    if (!isDevelopment && child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        stderrOutput += data.toString()
        if (stderrOutput.length > 10240) {
          stderrOutput = stderrOutput.slice(-10240)
        }
      })
    }

    child.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        runtime.lastError = `Process exited with code ${code}${stderrOutput ? `: ${stderrOutput.slice(-500)}` : ''}`
        logger.error(`Target for repo ${runtime.repoId} exited:`, runtime.lastError)
        runtime.state = 'failed'
      } else if (signal) {
        runtime.lastError = `Process terminated by signal ${signal}`
        logger.error(`Target for repo ${runtime.repoId} terminated:`, runtime.lastError)
        runtime.state = 'stopped'
      }
      runtime.process = null
    })

    runtime.process = child

    logger.info(`Target for repo ${runtime.repoId} started on port ${runtime.port}`)

    const healthy = await this.waitForHealth(runtime, 30000)
    if (!healthy) {
      runtime.state = 'failed'
      runtime.lastError = runtime.lastError || 'Failed to become healthy within timeout'
      logger.error(`Target for repo ${runtime.repoId} failed health check`)
      await this.killProcess(runtime)
      runtime.process = null
      return
    }

    runtime.state = 'healthy'
    logger.info(`Target for repo ${runtime.repoId} is healthy`)
  }

  private async waitForHealth(runtime: RepoOpenCodeTargetRuntime, timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    const openCodeUrl = `http://127.0.0.1:${runtime.port}`
    while (Date.now() - start < timeoutMs) {
      if (await healthCheck(openCodeUrl, HEALTH_CHECK_TIMEOUT_MS, { username: 'opencode', password: runtime.token })) {
        return true
      }
      await new Promise(r => setTimeout(r, HEALTH_CHECK_INTERVAL_MS))
    }
    return false
  }

  private async killProcess(runtime: RepoOpenCodeTargetRuntime): Promise<void> {
    if (!runtime.process) return
    const pid = runtime.process.pid
    if (!pid) return

    try {
      process.kill(pid, 'SIGTERM')
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
      if (errorCode !== 'ESRCH') {
        logger.warn(`Failed to send SIGTERM to ${pid}:`, error)
      }
    }

    await new Promise(r => setTimeout(r, 2000))

    try {
      process.kill(pid, 'SIGKILL')
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
      if (errorCode !== 'ESRCH') {
        logger.warn(`Failed to send SIGKILL to ${pid}:`, error)
      }
    }
  }
}
