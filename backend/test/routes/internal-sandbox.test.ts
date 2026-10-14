import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { SettingsService } from '../../src/services/settings'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import {
  buildCanonicalSandboxSpec,
  parseMemoryMib,
  resolveExpectedSandboxNetworkPolicy,
  resolveSandboxRuntimeTmpfsSizeMib,
  sessionSandboxName,
  type SandboxVmSpec,
} from '../../src/services/sandbox/command'
import { executeCommand } from '../../src/utils/process'
import { detectSandboxCapability } from '../../src/services/sandbox/capability'
import { forceProcessAttestation } from '../../src/services/opencode/process-identity'
import { SessionAncestry } from '../../src/services/session-ancestry'
import { SessionSandboxService } from '../../src/services/session-sandbox'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { getReposPath, ENV } from '@opencode-manager/shared/config/env'
import { createInternalTestApp } from '../helpers/internal-test-app'

const ROOT_SESSION_ID = 'ses_root'
const VM_NAME = sessionSandboxName(ROOT_SESSION_ID)
const REPO_DIR = path.join(getReposPath(), 'sandbox-route-test')

function vmSpec(): SandboxVmSpec {
  return {
    name: VM_NAME,
    rootSessionId: ROOT_SESSION_ID,
    projectMounts: [REPO_DIR],
    cpus: ENV.SANDBOX.CPUS,
    memoryMib: parseMemoryMib(ENV.SANDBOX.MEMORY) ?? 0,
  }
}

function trustedRunningInspect(): { exitCode: number; stdout: string; stderr: string } {
  const canonical = buildCanonicalSandboxSpec(vmSpec())
  const { memory_mib: memoryMib } = canonical.resources as { memory_mib: number }
  const config = {
    ...canonical,
    mounts: [
      ...(canonical.mounts as unknown[]),
      {
        type: 'Tmpfs',
        guest: '/tmp',
        size_mib: resolveSandboxRuntimeTmpfsSizeMib(memoryMib),
        options: { readonly: false, noexec: false, nosuid: false, nodev: false },
      },
    ],
    network: {
      enabled: true,
      ports: [],
      policy: resolveExpectedSandboxNetworkPolicy(ENV.SANDBOX.NET),
    },
  }
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      name: VM_NAME,
      status: 'Running',
      config,
      created_at: '2026-08-12T00:00:00Z',
      updated_at: '2026-08-12T00:00:00Z',
      active_config: config,
      pending_changes: [],
    }),
    stderr: '',
  }
}

mock.module('../../src/utils/process', () => ({
  executeCommand: vi.fn(async (args: string[]) => {
    if (args.includes('inspect')) return trustedRunningInspect()
    return { exitCode: 0, stdout: '[]', stderr: '' }
  }),
}))

mock.module('../../src/services/sandbox/capability', () => ({
  detectSandboxCapability: vi.fn(() => ({ available: true, msbVersion: 'msb 0.3.1' })),
  resetSandboxCapabilityCache: () => {},
}))

const mockExecuteCommand = executeCommand as ReturnType<typeof vi.fn>
const mockDetectSandboxCapability = detectSandboxCapability as ReturnType<typeof vi.fn>

describe('internal sandbox routes', () => {
  let db: Database
  let settingsService: SettingsService
  let app: Hono
  let token: string

  beforeEach(() => {
    mockExecuteCommand.mockClear()
    mockDetectSandboxCapability.mockReset()
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.3.1' })
    forceProcessAttestation(true)
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
    const ancestryClient = {
      api: { session: { get: async () => ({ parentID: null }) } },
    } as unknown as OpenCodeClient
    const sessionSandbox = new SessionSandboxService(db, new SessionAncestry(ancestryClient), settingsService, {
      removeSessionSandbox: async () => undefined,
    })
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { sessionSandbox }))
    token = getOrCreateInternalToken(db)
    mkdirSync(REPO_DIR, { recursive: true })
  })

  afterEach(() => {
    forceProcessAttestation(null)
    db.close()
    rmSync(REPO_DIR, { recursive: true, force: true })
  })

  function postShell(body: unknown, auth = true) {
    return app.request('/api/internal/sandbox/shell', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
    })
  }

  function shellBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { directory: REPO_DIR, sessionId: ROOT_SESSION_ID, locationDirectory: REPO_DIR, ...overrides }
  }

  function getSessionSandbox(sessionId: string, auth = true) {
    return app.request(`/api/internal/sandbox/sessions/${sessionId}`, {
      headers: {
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
    })
  }

  it('POST /shell returns 401 without bearer token', async () => {
    const res = await postShell(shellBody(), false)

    expect(res.status).toBe(401)
  })

  it('POST /shell returns host mode when the sandbox preference is off', async () => {
    const res = await postShell(shellBody())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mode: 'host' })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('POST /shell returns the named sandbox plan when enforcement is on', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

    const res = await postShell(shellBody())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'sandbox',
      name: VM_NAME,
      workdir: REPO_DIR,
    })
  })

  it('POST /shell returns 400 for a malformed body', async () => {
    const res = await postShell(shellBody({ directory: '' }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
  })

  it('POST /shell returns 400 when sessionId is missing', async () => {
    const res = await postShell({ directory: REPO_DIR, locationDirectory: REPO_DIR })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
  })

  it('POST /shell returns 400 when locationDirectory is missing', async () => {
    const res = await postShell({ directory: REPO_DIR, sessionId: ROOT_SESSION_ID })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
  })

  it('POST /shell blocks an enabled request when the capability is unavailable instead of running on the host', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })

    const res = await postShell(shellBody())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mode: 'blocked', reason: '/dev/kvm is not available' })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('POST /shell never returns host mode for an enforced request even when the preference is off', async () => {
    const res = await postShell(shellBody({ enforced: true }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'sandbox',
      name: VM_NAME,
      workdir: REPO_DIR,
    })
  })

  it('POST /shell blocks an enforced request for a directory outside the session mounts', async () => {
    const res = await postShell(shellBody({ directory: '/etc', enforced: true }))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { mode: string; reason?: string }
    expect(body.mode).toBe('blocked')
    expect(String(body.reason)).toContain("outside this session's sandbox")
  })

  it('POST /shell returns a blocked plan when the session target cannot be resolved', async () => {
    const failingApp = new Hono()
    failingApp.route(
      '/api/internal',
      createInternalTestApp(db, {
        sessionSandbox: {
          resolveShellTarget: async () => {
            throw new Error('session ancestry unavailable')
          },
        } as unknown as SessionSandboxService,
      }),
    )

    const res = await failingApp.request('/api/internal/sandbox/shell', {
      method: 'POST',
      body: JSON.stringify(shellBody({ enforced: true })),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ mode: 'blocked', reason: 'session ancestry unavailable' })
  })

  it('GET /sessions/:sessionId returns 401 without bearer token', async () => {
    const res = await getSessionSandbox('ses_root', false)

    expect(res.status).toBe(401)
  })

  it('GET /sessions/:sessionId reports unsandboxed when the sandbox preference is off', async () => {
    const res = await getSessionSandbox('ses_root')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sandboxed: false, source: 'default', since: 0 })
  })

  it('GET /sessions/:sessionId reports sandboxed when the sandbox preference is on', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

    const res = await getSessionSandbox('ses_root')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sandboxed: true, source: 'default', since: 0 })
  })

  it('GET /sessions/:sessionId returns 500 with an error when the service fails', async () => {
    const failingApp = new Hono()
    failingApp.route(
      '/api/internal',
      createInternalTestApp(db, {
        sessionSandbox: {
          getClaim: async () => {
            throw new Error('lookup failed')
          },
        } as unknown as SessionSandboxService,
      }),
    )

    const res = await failingApp.request('/api/internal/sandbox/sessions/ses_root', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'lookup failed' })
  })
})
