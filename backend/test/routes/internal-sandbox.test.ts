import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { ENV, getReposPath } from '@opencode-manager/shared/config/env'
import type { SessionSandboxState } from '@opencode-manager/shared/schemas'
import { SettingsService } from '../../src/services/settings'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import {
  buildCanonicalSandboxSpec,
  checkoutSandboxName,
  overrideSandboxExecutableTrustValidator,
  parseMemoryMib,
  resolveExpectedSandboxNetworkPolicy,
  resolveSandboxRuntimeTmpfsSizeMib,
  sandboxNetworkGroups,
} from '../../src/services/sandbox/command'
import type { SandboxVmSpec } from '../../src/services/sandbox/command'
import { resetSandboxRuntimeState, waitForGuestProbesForTests } from '../../src/services/sandbox/runtime'
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
const ClaimSchema = z.object({ sandboxed: z.boolean() })

const SandboxResourcesSchema = z.object({ cpus: z.number(), memoryMib: z.number() })

const EnvironmentSchema = z.object({
  sandboxed: z.literal(true),
  vmName: z.string(),
  resources: z.object({
    effective: SandboxResourcesSchema,
    running: SandboxResourcesSchema.nullable(),
  }),
  pendingResources: SandboxResourcesSchema.nullable(),
  network: z.array(z.string()),
  idleMinutes: z.number(),
  guest: z.string().nullable(),
})

const UnsandboxedEnvironmentSchema = z.object({ sandboxed: z.literal(false) })

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

  function checkoutKey(): string {
    return realpathSync(repoDirectory)
  }

  function checkoutVmName(): string {
    return checkoutSandboxName(checkoutKey())
  }

  function vmSpec(): SandboxVmSpec {
    return {
      name: checkoutVmName(),
      checkoutKey: checkoutKey(),
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
      name: checkoutVmName(),
      status: 'Running',
      config,
      created_at: '2026-08-12T00:00:00Z',
      updated_at: '2026-08-12T00:00:00Z',
      active_config: config,
      pending_changes: [],
    })
  }

  function callsPath(): string {
    return path.join(binDirectory, 'calls.jsonl')
  }

  function readFakeCalls(): string[][] {
    if (!existsSync(callsPath())) return []
    return readFileSync(callsPath(), 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => z.object({ argv: z.array(z.string()) }).parse(JSON.parse(line)).argv)
  }

  function fakeCalls(subcommand: string): string[][] {
    return readFakeCalls().filter((args) => args[1] === subcommand)
  }

  function writeFakeMsb(directory: string, inspectPayload: string): void {
    const binary = path.join(directory, 'msb')
    const script = [
      `#!${process.execPath}`,
      "const fs = require('node:fs')",
      'const args = process.argv.slice(2)',
      `fs.appendFileSync(${JSON.stringify(callsPath())}, JSON.stringify({ argv: [process.argv[1]].concat(args) }) + '\\n')`,
      `if (args[0] === 'inspect') { process.stdout.write(${JSON.stringify(inspectPayload)}); process.exit(0) }`,
      "if (args[0] === 'ls') { process.stdout.write('[]'); process.exit(0) }",
      "if (args[0] === 'exec' && args.some((arg) => arg.includes('uname -srm'))) { process.stdout.write('Linux 6.8.0-test x86_64\\nDebian GNU/Linux 12 (bookworm)\\n') }",
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
      lockedReason: null,
      available: true,
    }
    return {
      getClaim: async () => ({ sandboxed: false }),
      getState: async () => state,
      resolveShellTarget: async () => ({ sandboxed: true }),
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

  function getEnvironment(directory: string | null, auth = true) {
    const query = directory === null ? '' : `?directory=${encodeURIComponent(directory)}`
    return app.request(`/api/internal/sandbox/sessions/${ROOT_SESSION_ID}/environment${query}`, {
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
    resetSandboxRuntimeState()

    db = createTestDatabase()
    settingsService = new SettingsService(db)
    const ancestry = new SessionAncestry(createStubOpenCodeClient({
      api: { session: { get: mock(async () => sessionInfo({ id: ROOT_SESSION_ID })) } },
    }))
    sessionSandboxService = new SessionSandboxService(db, ancestry, settingsService)
    token = getOrCreateInternalToken(db)
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { sessionSandbox: sessionSandboxService }))
  })

  afterEach(async () => {
    await waitForGuestProbesForTests()
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

  it('POST /shell returns a blocked 409 when the sandbox preference is off', async () => {
    const res = await postShell(shellBody())
    const body = await readJson(res, BlockedPlanSchema)

    expect(res.status).toBe(409)
    expect(body).toEqual({ mode: 'blocked', reason: 'Sandboxing is off for this session' })
  })

  it('POST /shell returns the named sandbox plan when enforcement is on', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

    const res = await postShell(shellBody())
    const body = await readJson(res, SandboxPlanSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({ mode: 'sandbox', name: checkoutVmName(), workdir: repoDirectory })
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

  it('POST /shell returns a blocked 409 for an enforced request when the session is not sandboxed', async () => {
    const res = await postShell(shellBody({ enforced: true }))
    const body = await readJson(res, BlockedPlanSchema)

    expect(res.status).toBe(409)
    expect(body).toEqual({ mode: 'blocked', reason: 'Sandboxing is off for this session' })
  })

  it('POST /shell blocks an enforced request for a directory outside the session mounts', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

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
    expect(body).toEqual({ sandboxed: false })
  })

  it('GET /sessions/:sessionId reports sandboxed when the sandbox preference is on', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

    const res = await getSessionSandbox('ses_root')
    const body = await readJson(res, ClaimSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({ sandboxed: true })
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

  it('GET environment returns 401 without bearer token', async () => {
    const res = await getEnvironment(repoDirectory, false)

    expect(res.status).toBe(401)
  })

  it('GET environment reports unsandboxed when the sandbox preference is off', async () => {
    const res = await getEnvironment(repoDirectory)
    const body = await readJson(res, UnsandboxedEnvironmentSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({ sandboxed: false })
  })

  it('GET environment describes the checkout without booting it', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

    const res = await getEnvironment(repoDirectory)
    const body = await readJson(res, EnvironmentSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({
      sandboxed: true,
      vmName: checkoutVmName(),
      resources: {
        effective: { cpus: vmSpec().cpus, memoryMib: vmSpec().memoryMib },
        running: null,
      },
      pendingResources: null,
      network: sandboxNetworkGroups(ENV.SANDBOX.NET),
      idleMinutes: 30,
      guest: null,
    })
    expect(fakeCalls('run')).toHaveLength(0)
    expect(fakeCalls('start')).toHaveLength(0)
  })

  it('GET environment reports the guest after a shell plan attests the running VM', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

    const shell = await postShell(shellBody())

    expect(shell.status).toBe(200)

    const deadline = Date.now() + 5000
    let guest: string | null = null
    while (Date.now() < deadline) {
      const res = await getEnvironment(repoDirectory)
      const body = await readJson(res, EnvironmentSchema)
      if (body.guest !== null) {
        guest = body.guest
        break
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50)
      })
    }

    expect(guest).toBe('Debian GNU/Linux 12 (bookworm) | Linux 6.8.0-test x86_64')
    expect(fakeCalls('run')).toHaveLength(0)
    expect(fakeCalls('start')).toHaveLength(0)
  })

  it('GET environment returns 400 for a missing directory', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

    const res = await getEnvironment(null)
    const body = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(400)
    expect(body).toEqual({ error: 'Invalid request' })
  })

  it('GET environment returns 400 for a directory outside the project roots', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

    const res = await getEnvironment('/etc')
    const body = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(400)
    expect(body).toEqual({ error: 'could not resolve the checkout for /etc' })
  })
})
