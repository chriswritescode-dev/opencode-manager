import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as http from 'http'
import { randomUUID } from 'crypto'
import { createIPCServer } from '../../src/ipc/ipcServer'
import type { IPCServer } from '../../src/ipc/ipcServer'
import { repoRoot } from '../helpers/repo-root'

interface CapturedRequest {
  askpassType: string
  argv: string[]
  cwd?: string
  repoId?: number
}

const scriptPath = join(repoRoot, 'backend/scripts/askpass-main.ts')

let dir: string
let outputPath: string

const servers: IPCServer[] = []
const rawServers: http.Server[] = []

function buildEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env['VSCODE_GIT_ASKPASS_PIPE']
  delete env['VSCODE_GIT_ASKPASS_TYPE']
  delete env['VSCODE_GIT_IPC_HANDLE']
  delete env['OCM_GIT_REPO_ID']
  delete env['OCM_GIT_REPO_CWD']
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key]
    } else {
      env[key] = value
    }
  }
  return env
}

interface AskpassRun {
  status: number | null
  stdout: string
  stderr: string
}

function runAskpass(env: NodeJS.ProcessEnv): Promise<AskpassRun> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', [scriptPath], { env })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
}

function readOutput(): string {
  return readFileSync(outputPath, 'utf-8')
}

async function startIPCServer(): Promise<IPCServer> {
  const server = await createIPCServer(randomUUID())
  servers.push(server)
  return server
}

async function startRawServer(socketPath: string, body: string): Promise<void> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200)
    res.end(body)
  })
  rawServers.push(server)
  await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ocm-askpass-'))
  outputPath = join(dir, 'askpass.out')
})

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.dispose()
  }
  for (const server of rawServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('askpass-main', () => {
  it('exits 1 when the askpass pipe is missing', async () => {
    const result = await runAskpass(buildEnv({}))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Missing pipe')
  })

  it('exits 1 when the askpass type is missing', async () => {
    const result = await runAskpass(buildEnv({ VSCODE_GIT_ASKPASS_PIPE: outputPath }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Missing type')
  })

  it('exits 1 for an invalid askpass type', async () => {
    const result = await runAskpass(buildEnv({ VSCODE_GIT_ASKPASS_PIPE: outputPath, VSCODE_GIT_ASKPASS_TYPE: 'ftp' }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Invalid type: ftp')
  })

  it('writes a newline and exits 0 when no IPC handle is configured', async () => {
    const result = await runAskpass(buildEnv({ VSCODE_GIT_ASKPASS_PIPE: outputPath, VSCODE_GIT_ASKPASS_TYPE: 'https' }))

    expect(result.status).toBe(0)
    expect(readOutput()).toBe('\n')
  })

  it('writes the handler result and exits 0 on IPC success', async () => {
    const server = await startIPCServer()
    let received: CapturedRequest | undefined
    server.registerHandler('askpass', {
      handle: async (request) => {
        received = request as CapturedRequest
        return 'secret-token'
      },
    })

    const result = await runAskpass(buildEnv({
      VSCODE_GIT_ASKPASS_PIPE: outputPath,
      VSCODE_GIT_ASKPASS_TYPE: 'ssh',
      VSCODE_GIT_IPC_HANDLE: server.ipcHandlePath,
      OCM_GIT_REPO_ID: '42',
      OCM_GIT_REPO_CWD: '/tmp/repo',
    }))

    expect(result.status).toBe(0)
    expect(readOutput()).toBe('secret-token\n')
    expect(received?.askpassType).toBe('ssh')
    expect(received?.cwd).toBe('/tmp/repo')
    expect(received?.repoId).toBe(42)
    expect(received?.argv[1]).toBe(scriptPath)
  })

  it('writes a newline and exits 0 when the handler returns an empty body', async () => {
    const server = await startIPCServer()
    server.registerHandler('askpass', { handle: async () => undefined })

    const result = await runAskpass(buildEnv({
      VSCODE_GIT_ASKPASS_PIPE: outputPath,
      VSCODE_GIT_ASKPASS_TYPE: 'https',
      VSCODE_GIT_IPC_HANDLE: server.ipcHandlePath,
    }))

    expect(result.status).toBe(0)
    expect(readOutput()).toBe('\n')
  })

  it('writes a newline and exits 1 when the IPC server returns a non-200 status', async () => {
    const server = await startIPCServer()

    const result = await runAskpass(buildEnv({
      VSCODE_GIT_ASKPASS_PIPE: outputPath,
      VSCODE_GIT_ASKPASS_TYPE: 'https',
      VSCODE_GIT_IPC_HANDLE: server.ipcHandlePath,
    }))

    expect(result.status).toBe(1)
    expect(readOutput()).toBe('\n')
    expect(result.stderr).toContain('IPC error response')
  })

  it('writes a newline and exits 1 when the response body is not JSON', async () => {
    const socketPath = join(dir, 'raw.sock')
    await startRawServer(socketPath, 'not-json')

    const result = await runAskpass(buildEnv({
      VSCODE_GIT_ASKPASS_PIPE: outputPath,
      VSCODE_GIT_ASKPASS_TYPE: 'https',
      VSCODE_GIT_IPC_HANDLE: socketPath,
    }))

    expect(result.status).toBe(1)
    expect(readOutput()).toBe('\n')
    expect(result.stderr).toContain('JSON parse error')
  })

  it('writes a newline and exits 1 when the IPC connection fails', async () => {
    const result = await runAskpass(buildEnv({
      VSCODE_GIT_ASKPASS_PIPE: outputPath,
      VSCODE_GIT_ASKPASS_TYPE: 'https',
      VSCODE_GIT_IPC_HANDLE: join(dir, 'missing.sock'),
    }))

    expect(result.status).toBe(1)
    expect(readOutput()).toBe('\n')
    expect(result.stderr).toContain('IPC request error')
  })
})

const askpassEnvKeys = [
  'VSCODE_GIT_ASKPASS_PIPE',
  'VSCODE_GIT_ASKPASS_TYPE',
  'VSCODE_GIT_IPC_HANDLE',
  'OCM_GIT_REPO_ID',
  'OCM_GIT_REPO_CWD',
] as const

async function runAskpassInProcess(overrides: Record<string, string | undefined>): Promise<{ code: number | undefined; output: string | undefined }> {
  const nextEnv = buildEnv(overrides)
  const previousEnv: Record<string, string | undefined> = {}
  for (const key of askpassEnvKeys) {
    previousEnv[key] = process.env[key]
    const next = nextEnv[key]
    if (next === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = next
    }
  }

  let resolveExit: (code: number | undefined) => void = () => {}
  const exitPromise = new Promise<number | undefined>((resolve) => {
    resolveExit = resolve
  })
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    resolveExit(code)
    return undefined as never
  }) as typeof process.exit)

  vi.resetModules()
  try {
    await import('../../scripts/askpass-main')
    const code = await exitPromise
    return { code, output: existsSync(outputPath) ? readFileSync(outputPath, 'utf-8') : undefined }
  } finally {
    exitSpy.mockRestore()
    errorSpy.mockRestore()
    for (const key of askpassEnvKeys) {
      const previous = previousEnv[key]
      if (previous === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previous
      }
    }
  }
}

describe('askpass-main in-process', () => {
  it('exits 1 when the askpass pipe is missing', async () => {
    const result = await runAskpassInProcess({})

    expect(result.code).toBe(1)
    expect(result.output).toBeUndefined()
  })

  it('exits 1 when the askpass type is missing', async () => {
    const result = await runAskpassInProcess({ VSCODE_GIT_ASKPASS_PIPE: outputPath })

    expect(result.code).toBe(1)
    expect(result.output).toBeUndefined()
  })

  it('exits 1 for an invalid askpass type', async () => {
    const result = await runAskpassInProcess({ VSCODE_GIT_ASKPASS_PIPE: outputPath, VSCODE_GIT_ASKPASS_TYPE: 'ftp' })

    expect(result.code).toBe(1)
    expect(result.output).toBeUndefined()
  })

  it('writes a newline and exits 0 when no IPC handle is configured', async () => {
    const result = await runAskpassInProcess({ VSCODE_GIT_ASKPASS_PIPE: outputPath, VSCODE_GIT_ASKPASS_TYPE: 'https' })

    expect(result.code).toBe(0)
    expect(result.output).toBe('\n')
  })

  it('writes the handler result and exits 0 on IPC success', async () => {
    const server = await startIPCServer()
    server.registerHandler('askpass', { handle: async () => 'in-process-token' })

    const result = await runAskpassInProcess({
      VSCODE_GIT_ASKPASS_PIPE: outputPath,
      VSCODE_GIT_ASKPASS_TYPE: 'https',
      VSCODE_GIT_IPC_HANDLE: server.ipcHandlePath,
    })

    expect(result.code).toBe(0)
    expect(result.output).toBe('in-process-token\n')
  })

  it('writes a newline and exits 0 when the handler returns an empty body', async () => {
    const server = await startIPCServer()
    server.registerHandler('askpass', { handle: async () => undefined })

    const result = await runAskpassInProcess({
      VSCODE_GIT_ASKPASS_PIPE: outputPath,
      VSCODE_GIT_ASKPASS_TYPE: 'https',
      VSCODE_GIT_IPC_HANDLE: server.ipcHandlePath,
    })

    expect(result.code).toBe(0)
    expect(result.output).toBe('\n')
  })

  it('writes a newline and exits 1 when the IPC server returns a non-200 status', async () => {
    const server = await startIPCServer()

    const result = await runAskpassInProcess({
      VSCODE_GIT_ASKPASS_PIPE: outputPath,
      VSCODE_GIT_ASKPASS_TYPE: 'https',
      VSCODE_GIT_IPC_HANDLE: server.ipcHandlePath,
    })

    expect(result.code).toBe(1)
    expect(result.output).toBe('\n')
  })

  it('writes a newline and exits 1 when the response body is not JSON', async () => {
    const socketPath = join(dir, 'raw-in-process.sock')
    await startRawServer(socketPath, 'not-json')

    const result = await runAskpassInProcess({
      VSCODE_GIT_ASKPASS_PIPE: outputPath,
      VSCODE_GIT_ASKPASS_TYPE: 'https',
      VSCODE_GIT_IPC_HANDLE: socketPath,
    })

    expect(result.code).toBe(1)
    expect(result.output).toBe('\n')
  })

  it('writes a newline and exits 1 when the IPC connection fails', async () => {
    const result = await runAskpassInProcess({
      VSCODE_GIT_ASKPASS_PIPE: outputPath,
      VSCODE_GIT_ASKPASS_TYPE: 'https',
      VSCODE_GIT_IPC_HANDLE: join(dir, 'missing-in-process.sock'),
    })

    expect(result.code).toBe(1)
    expect(result.output).toBe('\n')
  })
})
