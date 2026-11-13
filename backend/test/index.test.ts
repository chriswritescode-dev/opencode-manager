import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'
import { z } from 'zod'
import type { AssistantModeStatus } from '@opencode-manager/shared/types'
import type { OpenCodeLifecycleState, OpenCodeLifecycleStatus } from '@opencode-manager/shared/opencode'
import type {
  BackendApp,
  BackendAppDependencies,
  BackendOpenCodeSupervisor,
  BackendScheduleRunner,
} from '../src/backend-app'
import type { TempWorkspace } from './helpers/test-env'
import { applyTestEnv, createTempWorkspace } from './helpers/test-env'

const RootResponseSchema = z.object({
  name: z.string(),
  version: z.string(),
  status: z.string(),
  endpoints: z.record(z.string(), z.string()),
})

const HealthResponseSchema = z.object({
  status: z.string(),
  database: z.string(),
  opencode: z.string(),
  opencodeMinVersion: z.string(),
})

const ASSISTANT_FILE = { path: '', exists: true, created: false }

const ASSISTANT_STATUS: AssistantModeStatus = {
  repoId: 1,
  directory: 'repos/assistant',
  relativePath: 'repos/assistant',
  files: { agentsMd: ASSISTANT_FILE, opencodeJson: ASSISTANT_FILE },
}

function lifecycleStatus(state: OpenCodeLifecycleState, healthy: boolean): OpenCodeLifecycleStatus {
  return {
    state,
    healthy,
    port: 5551,
    version: '2.2.5',
    minVersion: '2.2.5',
    versionSupported: true,
    lastError: null,
    activeRecoveryAction: null,
    attemptedRecoveryActions: [],
    nextRecoveryAction: null,
    failureCount: 0,
    watching: false,
    updatedAt: new Date(0).toISOString(),
  }
}

function createSupervisor(): BackendOpenCodeSupervisor {
  return {
    start: async () => lifecycleStatus('healthy', true),
    stop: async () => {},
    restart: async () => lifecycleStatus('starting', false),
    getStatus: () => lifecycleStatus('healthy', true),
    checkNow: async () => lifecycleStatus('healthy', true),
  }
}

const scheduleRunner: BackendScheduleRunner = {
  start: async () => {},
  stop: () => {},
}

const backendDependencies: BackendAppDependencies = {
  createSupervisor: () => createSupervisor(),
  createScheduleRunner: () => scheduleRunner,
  installAssistantWorkspace: async () => ASSISTANT_STATUS,
  migrateGlobalSkills: async () => {},
}

let workspace: TempWorkspace
let restoreHomeEnv: () => void
const startedApps: Array<{ backend: BackendApp }> = []

async function startBackendApp(overrides: BackendAppDependencies = {}): Promise<BackendApp> {
  vi.resetModules()
  const { createBackendApp } = await import('../src/backend-app')
  const backend = createBackendApp({ ...backendDependencies, ...overrides })
  startedApps.push({ backend })
  await backend.initialize()
  return backend
}

async function reservePort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server: Server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = z.object({ port: z.number() }).parse(server.address())
  return {
    port: address.port,
    release: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

beforeEach(() => {
  workspace = createTempWorkspace('ocm-entrypoint-')
  restoreHomeEnv = applyTestEnv({
    HOME: workspace.path,
    XDG_CONFIG_HOME: join(workspace.path, '.config'),
    XDG_STATE_HOME: join(workspace.path, '.local', 'state'),
    XDG_DATA_HOME: join(workspace.path, '.local', 'share'),
  })
})

afterEach(async () => {
  for (const entry of startedApps.splice(0)) {
    await entry.backend.shutdown()
  }
  restoreHomeEnv()
  workspace.restore()
})

describe('backend app wiring', { timeout: 30000 }, () => {
  it('answers the root route with service metadata outside production', async () => {
    const backend = await startBackendApp()

    const response = await backend.app.request('http://localhost/')

    expect(response.status).toBe(200)
    const body = RootResponseSchema.parse(await response.json())
    expect(body.name).toBe('OpenCode WebUI')
    expect(body.status).toBe('running')
    expect(body.endpoints.repos).toBe('/api/repos')
  })

  it('answers unknown API routes with the not-found handler', async () => {
    const backend = await startBackendApp()

    const response = await backend.app.request('http://localhost/unknown-route')

    expect(response.status).toBe(404)
  })

  it('reports database connectivity and OpenCode availability on the health route', async () => {
    const backend = await startBackendApp()

    const response = await backend.app.request('http://localhost/api/health')

    expect(response.status).toBe(200)
    const body = HealthResponseSchema.parse(await response.json())
    expect(body.database).toBe('connected')
    expect(body.opencodeMinVersion).toBe('2.2.5')
  })

  it('creates the workspace directories, AGENTS.md and a seed OpenCode config on startup', async () => {
    await startBackendApp()

    const configDir = join(workspace.path, '.config', 'opencode')
    expect(await readdir(join(workspace.path, 'repos'))).toEqual([])
    expect(await readdir(configDir)).toEqual(expect.arrayContaining(['AGENTS.md', 'opencode.jsonc']))
    expect(await readFile(join(configDir, 'AGENTS.md'), 'utf-8')).toContain('AGENTS.md')
  })

  it.each(['opencode.jsonc', 'opencode.json'])('preserves an existing %s without seeding', async (name) => {
    const configDir = join(workspace.path, '.config', 'opencode')
    const rawContent = '{\n  // preserve this source\n  "model": "test/model"\n}\n'
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, name), rawContent)

    await startBackendApp()

    expect(await readFile(join(configDir, name), 'utf8')).toBe(rawContent)
  })

  it('promotes a legacy config.json to opencode.json on startup and archives the legacy source', async () => {
    const configDir = join(workspace.path, '.config', 'opencode')
    const rawContent = '{\n  // legacy source\n  "model": "test/model"\n}\n'
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'config.json'), rawContent)

    await startBackendApp()

    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe(rawContent)
    await expect(readFile(join(configDir, 'config.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const archived = await readdir(join(workspace.path, '.config', 'opencode-configs-archive'))
    expect(archived).toHaveLength(1)
    const archivedName = archived[0] ?? ''
    expect(await readFile(join(workspace.path, '.config', 'opencode-configs-archive', archivedName), 'utf8')).toBe(rawContent)
  })

  it('folds legacy config.json keys into an existing opencode.json on startup', async () => {
    const configDir = join(workspace.path, '.config', 'opencode')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'opencode.json'), '{\n  // target source\n  "theme": "dark"\n}\n')
    await writeFile(join(configDir, 'config.json'), '{"model":"test/model"}')

    await startBackendApp()

    const merged = await readFile(join(configDir, 'opencode.json'), 'utf8')
    expect(merged).toContain('// target source')
    expect(merged).toContain('"theme": "dark"')
    expect(merged).toContain('"model": "test/model"')
    await expect(readFile(join(configDir, 'config.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('preview gateway startup', { timeout: 30000 }, () => {
  it('marks the preview gateway available once its port accepts connections', async () => {
    const { port, release } = await reservePort()
    await release()
    const backend = await startBackendApp()
    const { startPreviewGateway } = await import('../src/backend-app')

    const server = startPreviewGateway({ preview: backend.preview, port, hostname: '127.0.0.1' })

    await vi.waitFor(() => expect(backend.preview.availability.isEnabled()).toBe(true))
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('marks the preview gateway unavailable instead of crashing when its port is taken', async () => {
    const { port, release } = await reservePort()
    const backend = await startBackendApp()
    const { startPreviewGateway } = await import('../src/backend-app')

    try {
      const server = startPreviewGateway({ preview: backend.preview, port, hostname: '127.0.0.1' })
      const bindFailure = new Promise<string>((resolve) => {
        server.once('error', (cause: NodeJS.ErrnoException) => resolve(cause.code ?? ''))
      })

      await expect(bindFailure).resolves.toBe('EADDRINUSE')
      expect(backend.preview.availability.isEnabled()).toBe(false)

      const response = await backend.app.request('http://localhost/')
      expect(response.status).toBe(200)
    } finally {
      await release()
    }
  })
})
