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
const HEALTH_CHECK_MAX_WAIT_MS = 30_000
const READINESS_WAIT_TIMEOUT_MS = 60_000
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
  readyPromise: Promise<boolean>
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

async function healthCheckDetailed(
  url: string,
  timeoutMs: number,
  credentials?: { username: string; password: string },
): Promise<{ ok: boolean; detail: string }> {
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
    if (response.ok) return { ok: true, detail: `${response.status}` }
    return { ok: false, detail: `http ${response.status}` }
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}:${err.message}` : String(err)
    return { ok: false, detail: msg }
  }
}

export class RepoOpenCodeTargetManager {
  private targets: Map<number, RepoOpenCodeTargetRuntime> = new Map()
  private inFlight: Map<number, Promise<EnsureOpenCodeTargetResponse>> = new Map()

  async ensureTarget(repo: Repo): Promise<EnsureOpenCodeTargetResponse> {
    const pending = this.inFlight.get(repo.id)
    if (pending) return pending

    const existing = this.targets.get(repo.id)

    if (existing && existing.process && (existing.state === 'healthy' || existing.state === 'starting')) {
      existing.lastUsedAt = Date.now()
      return this.responseFor(existing, true)
    }

    const promise = (async () => {
      if (existing) {
        await this.killProcess(existing)
        existing.process = null
      }
      const runtime = await this.spawnTarget(repo, existing)
      return this.responseFor(runtime, false)
    })()

    this.inFlight.set(repo.id, promise)
    try {
      return await promise
    } finally {
      this.inFlight.delete(repo.id)
    }
  }

  /**
   * Wait until the target's child opencode process is healthy and ready to
   * proxy traffic. Resolves true when ready, false on failure or timeout.
   */
  async awaitReady(repoId: number, timeoutMs: number = READINESS_WAIT_TIMEOUT_MS): Promise<boolean> {
    const runtime = this.targets.get(repoId)
    if (!runtime) return false
    if (runtime.state === 'healthy') return true
    if (runtime.state === 'failed' || runtime.state === 'stopped') return false

    return Promise.race([
      runtime.readyPromise,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ])
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

  private responseFor(runtime: RepoOpenCodeTargetRuntime, reused: boolean): EnsureOpenCodeTargetResponse {
    return {
      repoId: runtime.repoId,
      state: runtime.state,
      openCodeUrl: `${PROXY_PATH_PREFIX}/${runtime.repoId}`,
      headers: { Authorization: `Bearer ${runtime.token}` },
      reused,
    }
  }

  private async spawnTarget(repo: Repo, existing: RepoOpenCodeTargetRuntime | undefined): Promise<RepoOpenCodeTargetRuntime> {
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
      readyPromise: Promise.resolve(false),
    }

    this.targets.set(repo.id, runtime)
    this.startProcess(runtime, repo.fullPath)
    runtime.readyPromise = this.monitorHealth(runtime)

    return runtime
  }

  private startProcess(runtime: RepoOpenCodeTargetRuntime, cwd: string): void {
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
  }

  private async monitorHealth(runtime: RepoOpenCodeTargetRuntime): Promise<boolean> {
    const openCodeUrl = `http://127.0.0.1:${runtime.port}`
    const start = Date.now()
    let attempts = 0
    let lastFailure = ''
    while (Date.now() - start < HEALTH_CHECK_MAX_WAIT_MS) {
      if (!runtime.process) {
        runtime.state = 'failed'
        runtime.lastError = runtime.lastError ?? 'Process exited before becoming healthy'
        return false
      }
      attempts++
      const result = await healthCheckDetailed(openCodeUrl, HEALTH_CHECK_TIMEOUT_MS, { username: 'opencode', password: runtime.token })
      if (result.ok) {
        runtime.state = 'healthy'
        logger.info(`Target for repo ${runtime.repoId} is healthy after ${attempts} attempts (${Date.now() - start}ms)`)
        return true
      }
      lastFailure = result.detail
      await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS))
    }
    runtime.state = 'failed'
    runtime.lastError = runtime.lastError ?? `Failed to become healthy within timeout (last failure: ${lastFailure})`
    logger.error(`Target for repo ${runtime.repoId} failed health check after ${attempts} attempts: ${lastFailure}`)
    await this.killProcess(runtime)
    runtime.process = null
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
