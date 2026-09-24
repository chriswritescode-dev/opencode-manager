import { spawn, spawnSync } from 'child_process'
import { once } from 'events'
import { mkdir, mkdtemp, rm } from 'fs/promises'
import { createServer } from 'net'
import type { AddressInfo } from 'net'
import { randomBytes } from 'crypto'
import os from 'os'
import path from 'path'
import { buildOpenCodeBasicAuth, isSupportedOpenCodeVersion } from '@opencode-manager/shared/opencode'

const VERSION_TIMEOUT_MS = 5000
const SERVE_READY_TIMEOUT_MS = 60000
const SERVE_POLL_INTERVAL_MS = 250
const RUN_TIMEOUT_MS = 90000
const STOP_TIMEOUT_MS = 5000

const OPENCODE_BINARY_CANDIDATES = ['opencode', '/usr/local/bin/opencode', '/opt/opencode/bin/opencode']

export type OpenCodeRunResult = {
  status: number | null
  stdout: string
  stderr: string
}

export type OpenCodeServe = {
  baseUrl: string
  password: string
  homeDirectory: string
  configHome: string
  stop: () => Promise<void>
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readOpenCodeVersion(binary: string): string | null {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: VERSION_TIMEOUT_MS })
  if (result.status !== 0) return null
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(`${result.stdout ?? ''}${result.stderr ?? ''}`)
  return match ? match[1]! : null
}

export function resolveOpenCode2Binary(): string | null {
  const candidates = [process.env.OPENCODE_BIN, ...OPENCODE_BINARY_CANDIDATES].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
  )
  for (const candidate of candidates) {
    const version = readOpenCodeVersion(candidate)
    if (version && isSupportedOpenCodeVersion(version)) return candidate
  }
  return null
}

export async function runOpenCodeStandalone(options: { cwd: string; env: NodeJS.ProcessEnv; message: string }): Promise<OpenCodeRunResult> {
  const binary = resolveOpenCode2Binary()
  if (!binary) throw new Error('no OpenCode 2 binary is available for the binary-backed test')
  return new Promise<OpenCodeRunResult>((resolve, reject) => {
    const child = spawn(binary, ['run', '--standalone', '--auto', '--format', 'json', options.message], {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ status: null, stdout, stderr })
    }, RUN_TIMEOUT_MS)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ status: code, stdout, stderr })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function getFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}

async function waitForServerInfo(baseUrl: string, password: string, child: ReturnType<typeof spawn>, readStderr: () => string): Promise<void> {
  const deadline = Date.now() + SERVE_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`OpenCode server exited before becoming ready: ${readStderr()}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/info`, { headers: { Authorization: buildOpenCodeBasicAuth(password) } })
      if (response.ok) return
    } catch {
      // the server is not listening yet
    }
    await delay(SERVE_POLL_INTERVAL_MS)
  }
  throw new Error(`OpenCode server did not become ready: ${readStderr()}`)
}

export async function startOpenCodeServe(options: { env?: NodeJS.ProcessEnv } = {}): Promise<OpenCodeServe> {
  const binary = resolveOpenCode2Binary()
  if (!binary) throw new Error('no OpenCode 2 binary is available for the binary-backed test')
  const root = await mkdtemp(path.join(os.tmpdir(), 'ocm-opencode-serve-'))
  const password = randomBytes(24).toString('base64url')
  const homeDirectory = options.env?.HOME ?? path.join(root, 'home')
  const configHome = options.env?.XDG_CONFIG_HOME ?? path.join(root, 'config')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDirectory,
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: path.join(root, 'data'),
    XDG_STATE_HOME: path.join(root, 'state'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    ...options.env,
    OPENCODE_SERVER_PASSWORD: password,
  }
  for (const directory of new Set([env.HOME, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME])) {
    if (typeof directory === 'string' && directory.length > 0) await mkdir(directory, { recursive: true })
  }

  const port = await getFreePort()
  const child = spawn(binary, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  const baseUrl = `http://127.0.0.1:${port}`
  try {
    await waitForServerInfo(baseUrl, password, child, () => stderr)
  } catch (error) {
    child.kill('SIGKILL')
    await rm(root, { recursive: true, force: true })
    throw error
  }

  return {
    baseUrl,
    password,
    homeDirectory,
    configHome,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        await Promise.race([once(child, 'close'), delay(STOP_TIMEOUT_MS)])
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }
      await rm(root, { recursive: true, force: true })
    },
  }
}
