import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { createInternalRoutes } from '../../src/routes/internal'
import { ScheduleService } from '../../src/services/schedules'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import { buildSandboxExecCommandString, resolveSandboxExecUser, WORKSPACE_SANDBOX_NAME, sandboxSecretMaskPath } from '../../src/services/sandbox/command'
import { executeCommand } from '../../src/utils/process'
import { detectSandboxCapability } from '../../src/services/sandbox/capability'
import { getReposPath, getScheduleWorktreesPath, ENV } from '@opencode-manager/shared/config/env'
import type { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'

function trustedRunningInspect(): { exitCode: number; stdout: string; stderr: string } {
  const memoryMatch = /^(\d+(?:\.\d+)?)([gGmM])?$/.exec(ENV.SANDBOX.MEMORY)
  const memoryMib = memoryMatch
    ? memoryMatch[2] === undefined || memoryMatch[2] === 'M' || memoryMatch[2] === 'm'
      ? Math.floor(Number(memoryMatch[1]))
      : Math.floor(Number(memoryMatch[1]) * 1024)
    : 0
  const bindMount = (host: string) => ({
    type: 'Bind',
    host,
    guest: host,
    options: { readonly: false, noexec: false, nosuid: false, nodev: false },
    stat_virtualization: 'strict',
    host_permissions: 'private',
    follow_root_symlinks: false,
    quota_mib: null,
  })
  const config = {
    name: WORKSPACE_SANDBOX_NAME,
    image: { Oci: { reference: ENV.SANDBOX.IMAGE, root_disk: { kind: 'managed', size_mib: 4096 } } },
    resources: { cpus: ENV.SANDBOX.CPUS, memory_mib: memoryMib, max_cpus: ENV.SANDBOX.CPUS, max_memory_mib: memoryMib },
    runtime: {
      workdir: getReposPath(),
      shell: null,
      scripts: {},
      entrypoint: null,
      cmd: ['sleep', 'infinity'],
      hostname: null,
      user: resolveSandboxExecUser(),
      log_level: null,
      metrics_sample_interval_ms: null,
      disable_metrics_sample: false,
    },
    env: [],
    labels: { 'ocm.managed': 'true', 'ocm.net': ENV.SANDBOX.NET },
    rlimits: [],
    mounts: [
      bindMount(getReposPath()),
      bindMount(getScheduleWorktreesPath()),
      { type: 'Tmpfs', guest: sandboxSecretMaskPath(), size_mib: null, options: { readonly: false, noexec: false, nosuid: false, nodev: false } },
    ],
    patches: [],
    network: {
      enabled: true,
      ports: [],
      policy: {
        default_egress: 'deny',
        default_ingress: 'allow',
        rules: [
          { direction: 'egress', destination: { group: 'dns' }, protocols: [], ports: [], action: 'allow' },
          { direction: 'egress', destination: { group: 'public' }, protocols: [], ports: [], action: 'allow' },
        ],
      },
      max_connections: null,
      trust_host_cas: false,
    },
    init: null,
    pull_policy: 'IfMissing',
    security_profile: 'default',
    lifecycle: { ephemeral: false, max_duration_secs: null, idle_timeout_secs: null },
    manifest_digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  }
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      name: WORKSPACE_SANDBOX_NAME,
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
  let repoDir: string

  beforeEach(() => {
    mockExecuteCommand.mockClear()
    mockDetectSandboxCapability.mockReset()
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.3.1' })
    db = new Database(':memory:')
    migrate(db, allMigrations)
    const openCodeClient = createOpenCodeClient()
    const stubWorktreeManager = { prepare: () => Promise.resolve(null), finalize: () => Promise.resolve({ commitHash: null }) } as unknown as ScheduleWorktreeManager
    const scheduleService = new ScheduleService(db, openCodeClient, stubWorktreeManager)
    const notificationService = new NotificationService(db)
    settingsService = new SettingsService(db)
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService, openCodeClient))
    token = getOrCreateInternalToken(db)
    repoDir = path.join(getReposPath(), 'sandbox-route-test')
    mkdirSync(repoDir, { recursive: true })
  })

  afterEach(() => {
    db.close()
    rmSync(repoDir, { recursive: true, force: true })
  })

  function postCommand(body: unknown, auth = true) {
    return app.request('/api/internal/sandbox/command', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
    })
  }

  it('POST /command returns 401 without bearer token', async () => {
    const res = await postCommand({ directory: repoDir, command: 'echo hi' }, false)

    expect(res.status).toBe(401)
  })

  it('POST /command returns host mode when the sandbox preference is off', async () => {
    const res = await postCommand({ directory: repoDir, command: 'echo hi' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mode: 'host' })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('POST /command returns a wrapped sandbox command when enforcement is on', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

    const res = await postCommand({ directory: repoDir, command: 'echo hi' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'sandbox',
      command: buildSandboxExecCommandString(repoDir, 'echo hi'),
    })
  })

  it('POST /command returns 400 for a malformed body', async () => {
    const res = await postCommand({ directory: '', command: 'echo hi' })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
  })

  it('POST /command blocks an enabled request when the capability is unavailable instead of running on the host', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })

    const res = await postCommand({ directory: repoDir, command: 'echo hi' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mode: 'blocked', reason: '/dev/kvm is not available' })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('POST /command never returns host mode for an enforced request even when the preference is off', async () => {
    const res = await postCommand({ directory: repoDir, command: 'echo hi', enforced: true })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'sandbox',
      command: buildSandboxExecCommandString(repoDir, 'echo hi'),
    })
  })

  it('POST /command blocks an enforced request for a directory outside the project roots', async () => {
    const res = await postCommand({ directory: '/etc', command: 'echo hi', enforced: true })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { mode: string; reason?: string }
    expect(body.mode).toBe('blocked')
    expect(String(body.reason)).toContain('outside the sandboxed project roots')
  })
})
