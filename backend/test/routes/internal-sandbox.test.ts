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
import {
  buildCanonicalSandboxSpec,
  resolveExpectedSandboxNetworkPolicy,
  resolveSandboxRuntimeTmpfsSizeMib,
  WORKSPACE_SANDBOX_NAME,
} from '../../src/services/sandbox/command'
import { executeCommand } from '../../src/utils/process'
import { detectSandboxCapability } from '../../src/services/sandbox/capability'
import { forceProcessAttestation } from '../../src/services/opencode/process-identity'
import { getReposPath, ENV } from '@opencode-manager/shared/config/env'
import type { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'

function trustedRunningInspect(): { exitCode: number; stdout: string; stderr: string } {
  const canonical = buildCanonicalSandboxSpec()
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
    forceProcessAttestation(true)
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
    forceProcessAttestation(null)
    db.close()
    rmSync(repoDir, { recursive: true, force: true })
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

  it('POST /shell returns 401 without bearer token', async () => {
    const res = await postShell({ directory: repoDir }, false)

    expect(res.status).toBe(401)
  })

  it('POST /shell returns host mode when the sandbox preference is off', async () => {
    const res = await postShell({ directory: repoDir })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mode: 'host' })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('POST /shell returns the mapped sandbox working directory when enforcement is on', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })

    const res = await postShell({ directory: repoDir })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'sandbox',
      workdir: repoDir,
    })
  })

  it('POST /shell returns 400 for a malformed body', async () => {
    const res = await postShell({ directory: '' })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
  })

  it('POST /shell blocks an enabled request when the capability is unavailable instead of running on the host', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })

    const res = await postShell({ directory: repoDir })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mode: 'blocked', reason: '/dev/kvm is not available' })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('POST /shell never returns host mode for an enforced request even when the preference is off', async () => {
    const res = await postShell({ directory: repoDir, enforced: true })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'sandbox',
      workdir: repoDir,
    })
  })

  it('POST /shell blocks an enforced request for a directory outside the project roots', async () => {
    const res = await postShell({ directory: '/etc', enforced: true })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { mode: string; reason?: string }
    expect(body.mode).toBe('blocked')
    expect(String(body.reason)).toContain('outside the sandboxed project roots')
  })
})
