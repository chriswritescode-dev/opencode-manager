import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { ENV, getReposPath } from '@opencode-manager/shared/config/env'
import type { SessionSandboxState } from '@opencode-manager/shared/schemas'
import { SettingsService } from '../../src/services/settings'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import {
  buildCanonicalSandboxSpec,
  overrideSandboxExecutableTrustValidator,
  parseMemoryMib,
  resolveExpectedSandboxNetworkPolicy,
  resolveSandboxRuntimeTmpfsSizeMib,
  sessionSandboxName,
} from '../../src/services/sandbox/command'
import type { SandboxVmSpec } from '../../src/services/sandbox/command'
import { detectSandboxCapability, resetSandboxCapabilityCache } from '../../src/services/sandbox/capability'
import type { SandboxCapabilityProbes } from '../../src/services/sandbox/capability'
import { forceProcessAttestation } from '../../src/services/opencode/process-identity'
import { SessionAncestry } from '../../src/services/session-ancestry'
import { SessionSandboxService } from '../../src/services/session-sandbox'
import type { SessionSandboxRoutesService } from '../../src/routes/session-sandbox'
import { createStubOpenCodeClient, sessionInfo } from '../helpers/stub-opencode-client'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createTestDatabase } from '../helpers/test-database'
import { applyTestEnv, createTempWorkspace } from '../helpers/test-env'
import type { TempWorkspace } from '../helpers/test-env'
import { readJson } from '../helpers/read-json'

const ROOT_SESSION_ID = 'ses_root'
const VM_NAME = sessionSandboxName(ROOT_SESSION_ID)

const SandboxPlanSchema = z.union([
  z.object({ mode: z.literal('host') }),
  z.object({
    mode: z.literal('sandbox'),
    name: z.string(),
    workdir: z.string(),
    env: z.record(z.string(), z.string()).optional(),
    mask: z.array(z.string()).optional(),
  }),
  z.object({ mode: z.literal('blocked'), reason: z.string() }),
])

const BlockedPlanSchema = z.object({ mode: z.literal('blocked'), reason: z.string() })
const ErrorResponseSchema = z.object({ error: z.string() })
const ClaimSchema = z.object({ sandboxed: z.boolean(), source: z.string(), since: z.number() })

interface ShellRequestBody {
  directory: string
  sessionId: string
  locationDirectory: string
  enforced?: boolean
}

describe('internal sandbox routes', () => {
  let workspace: TempWorkspace
  let binDirectory: string
  let repoDirectory: string
  let restorePath: (() => void) | undefined
  let db: ReturnType<typeof createTestDatabase>
  let settingsService: SettingsService
  let sessionSandboxService: SessionSandboxService
  let app: Hono
  let token: string

  function vmSpec(): SandboxVmSpec {
    return {
      name: VM_NAME,
      rootSessionId: ROOT_SESSION_ID,
      projectMounts: [repoDirectory],
      cpus: ENV.SANDBOX.CPUS,
      memoryMib: parseMemoryMib(ENV.SANDBOX.MEMORY) ?? 0,
    }
  }

  function trustedInspectPayload(): string {
    const canonical = buildCanonicalSandboxSpec(vmSpec())
    const config = {
      ...canonical,
      mounts: [
        ...canonical.mounts,
        {
          type: 'Tmpfs',
          guest: '/tmp',
          size_mib: resolveSandboxRuntimeTmpfsSizeMib(canonical.resources.memory_mib),
          options: { readonly: false, noexec: false, nosuid: false, nodev: false },
        },
      ],
      network: {
        enabled: true,
        ports: [],
        policy: resolveExpectedSandboxNetworkPolicy(ENV.SANDBOX.NET),
      },
    }
    return JSON.stringify({
      name: VM_NAME,
      status: 'Running',
      config,
      created_at: '2026-08-12T00:00:00Z',
      updated_at: '2026-08-12T00:00:00Z',
      active_config: config,
      pending_changes: [],
    })
  }

  function writeFakeMsb(directory: string, inspectPayload: string): void {
    const binary = path.join(directory, 'msb')
    const script = [
      `#!${process.execPath}`,
      'const args = process.argv.slice(2)',
      `if (args[0] === 'inspect') { process.stdout.write(${JSON.stringify(inspectPayload)}); process.exit(0) }`,
      "if (args[0] === 'ls') { process.stdout.write('[]'); process.exit(0) }",
      'process.exit(0)',
    ].join('\n')
    writeFileSync(binary, script, { mode: 0o755 })
    chmodSync(binary, 0o755)
  }

  function sandboxProbes(overrides: Partial<SandboxCapabilityProbes> = {}): SandboxCapabilityProbes {
    return {
      isKvmAccessible: () => true,
      readMsbVersion: () => ({ status: 0, stdout: 'msb 0.3.1\n', stderr: '' }),
      resolveExecUserUid: () => null,
      currentUid: () => 1000,
      currentGid: () => 1000,
      ...overrides,
    }
  }

  function primeSandboxCapability(available: boolean): void {
    resetSandboxCapabilityCache()
    detectSandboxCapability(
      available
        ? sandboxProbes()
        : sandboxProbes({ isKvmAccessible: () => false }),
    )
  }

  function createSessionSandboxFakes(overrides: Partial<SessionSandboxRoutesService> = {}): SessionSandboxRoutesService {
    const state: SessionSandboxState = {
      sessionId: ROOT_SESSION_ID,
      rootSessionId: ROOT_SESSION_ID,
      sandboxed: false,
      source: 'default',
      resources: null,
      effectiveResources: { cpus: ENV.SANDBOX.CPUS, memoryMib: parseMemoryMib(ENV.SANDBOX.MEMORY) ?? 0 },
      lockedReason: null,
      available: true,
    }
    return {
      getClaim: async () => ({ sandboxed: false, source: 'default', since: 0 }),
      getState: async () => state,
      resolveShellTarget: async () => ({
        rootSessionId: ROOT_SESSION_ID,
        resources: { cpus: ENV.SANDBOX.CPUS, memoryMib: parseMemoryMib(ENV.SANDBOX.MEMORY) ?? 0 },
      }),
      update: async () => state,
      ...overrides,
    }
  }

  function shellBody(overrides: Partial<ShellRequestBody> = {}): ShellRequestBody {
    return { directory: repoDirectory, sessionId: ROOT_SESSION_ID, locationDirectory: repoDirectory, ...overrides }
  }

  function shellHeaders(auth: boolean) {
    const headers = new Headers({ 'content-type': 'application/json' })
    if (auth) headers.set('authorization', `Bearer ${token}`)
    return headers
  }

  function postShell(body: Partial<ShellRequestBody>, auth = true) {
    return app.request('/api/internal/sandbox/shell', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: shellHeaders(auth),
    })
  }

  function getSessionSandbox(sessionId: string, auth = true) {
    return app.request(`/api/internal/sandbox/sessions/${sessionId}`, {
      headers: shellHeaders(auth),
    })
  }

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-sandbox-routes-')
    binDirectory = mkdtempSync(path.join(tmpdir(), 'ocm-sandbox-msb-'))
    repoDirectory = path.join(getReposPath(), 'sandbox-route-test')
    mkdirSync(repoDirectory, { recursive: true })
    writeFakeMsb(binDirectory, trustedInspectPayload())
    const emptyGitConfig = path.join(workspace.path, 'gitconfig')
    writeFileSync(emptyGitConfig, '')
    restorePath = applyTestEnv({
      PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      GIT_CONFIG_GLOBAL: emptyGitConfig,
      GIT_CONFIG_NOSYSTEM: '1',
    })
    overrideSandboxExecutableTrustValidator(() => true)
    forceProcessAttestation(true)
    primeSandboxCapability(true)

    db = createTestDatabase()
    settingsService = new SettingsService(db)
    const ancestry = new SessionAncestry(createStubOpenCodeClient({
      api: { session: { get: mock(async () => sessionInfo({ id: ROOT_SESSION_ID })) } },
    }))
    sessionSandboxService = new SessionSandboxService(db, ancestry, settingsService, {
      removeSessionSandbox: async () => undefined,
    })
    token = getOrCreateInternalToken(db)
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { sessionSandbox: sessionSandboxService }))
  })

  afterEach(() => {
    resetSandboxCapabilityCache()
    overrideSandboxExecutableTrustValidator(null)
    forceProcessAttestation(null)
    restorePath?.()
    db.close()
    rmSync(binDirectory, { recursive: true, force: true })
    workspace.restore()
  })

  it('POST /shell returns 401 without bearer token', async () => {
    const res = await postShell(shellBody(), false)

    expect(res.status).toBe(401)
  })

  it('POST /shell returns host mode when the sandbox preference is off', async () => {
    const res = await postShell(shellBody())
    const body = await readJson(res, SandboxPlanSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({ mode: 'host' })
  })

  it('POST /shell returns the named sandbox plan when enforcement is on', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

    const res = await postShell(shellBody())
    const body = await readJson(res, SandboxPlanSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoDirectory })
  })

  it.each([
    { label: 'an empty directory', body: { directory: '', sessionId: ROOT_SESSION_ID, locationDirectory: '/tmp' } },
    { label: 'a missing sessionId', body: { directory: '/tmp', locationDirectory: '/tmp' } },
    { label: 'a missing locationDirectory', body: { directory: '/tmp', sessionId: ROOT_SESSION_ID } },
  ])('POST /shell returns 400 for $label', async ({ body }) => {
    const res = await postShell(body)
    const parsed = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(400)
    expect(parsed.error).toBe('Invalid request')
  })

  it('POST /shell blocks an enabled request when the capability is unavailable instead of running on the host', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    primeSandboxCapability(false)

    const res = await postShell(shellBody())
    const body = await readJson(res, BlockedPlanSchema)

    expect(res.status).toBe(200)
    expect(body.mode).toBe('blocked')
    expect(body.reason).toContain('/dev/kvm')
  })

  it('POST /shell never returns host mode for an enforced request even when the preference is off', async () => {
    const res = await postShell(shellBody({ enforced: true }))
    const body = await readJson(res, SandboxPlanSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoDirectory })
  })

  it('POST /shell blocks an enforced request for a directory outside the session mounts', async () => {
    const res = await postShell(shellBody({ directory: '/etc', enforced: true }))
    const body = await readJson(res, BlockedPlanSchema)

    expect(res.status).toBe(200)
    expect(body.mode).toBe('blocked')
    expect(body.reason).toContain("outside this session's sandbox")
  })

  it('POST /shell returns a blocked plan when the session target cannot be resolved', async () => {
    const failingApp = new Hono()
    failingApp.route(
      '/api/internal',
      createInternalTestApp(db, {
        sessionSandbox: createSessionSandboxFakes({
          resolveShellTarget: async () => {
            throw new Error('session ancestry unavailable')
          },
        }),
      }),
    )

    const res = await failingApp.request('/api/internal/sandbox/shell', {
      method: 'POST',
      body: JSON.stringify(shellBody({ enforced: true })),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    })
    const body = await readJson(res, BlockedPlanSchema)

    expect(res.status).toBe(500)
    expect(body).toEqual({ mode: 'blocked', reason: 'session ancestry unavailable' })
  })

  it('GET /sessions/:sessionId returns 401 without bearer token', async () => {
    const res = await getSessionSandbox('ses_root', false)

    expect(res.status).toBe(401)
  })

  it('GET /sessions/:sessionId reports unsandboxed when the sandbox preference is off', async () => {
    const res = await getSessionSandbox('ses_root')
    const body = await readJson(res, ClaimSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({ sandboxed: false, source: 'default', since: 0 })
  })

  it('GET /sessions/:sessionId reports sandboxed when the sandbox preference is on', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

    const res = await getSessionSandbox('ses_root')
    const body = await readJson(res, ClaimSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({ sandboxed: true, source: 'default', since: 0 })
  })

  it('GET /sessions/:sessionId returns 500 with an error when the service fails', async () => {
    const failingApp = new Hono()
    failingApp.route(
      '/api/internal',
      createInternalTestApp(db, {
        sessionSandbox: createSessionSandboxFakes({
          getClaim: async () => {
            throw new Error('lookup failed')
          },
        }),
      }),
    )

    const res = await failingApp.request('/api/internal/sandbox/sessions/ses_root', {
      headers: { authorization: `Bearer ${token}` },
    })
    const body = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'lookup failed' })
  })
})
