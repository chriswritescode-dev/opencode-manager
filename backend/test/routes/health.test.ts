import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { OPENCODE_LIFECYCLE_STATES } from '@opencode-manager/shared/opencode'
import type { OpenCodeLifecycleStatus } from '@opencode-manager/shared/opencode'
import { DEFAULT_USER_PREFERENCES, healthResponseSchema } from '@opencode-manager/shared/schemas'
import { createHealthRoutes } from '../../src/routes/health'
import type { HealthOpenCodeStatus, HealthSupervisor } from '../../src/routes/health'
import { detectSandboxCapability, resetSandboxCapabilityCache } from '../../src/services/sandbox/capability'
import type { SandboxCapabilityProbes } from '../../src/services/sandbox/capability'
import { overrideSandboxExecutableTrustValidator } from '../../src/services/sandbox/command'
import { forceProcessAttestation } from '../../src/services/opencode/process-identity'
import { createTestDatabase, seedSettings } from '../helpers/test-database'
import { applyTestEnv } from '../helpers/test-env'
import { readJson } from '../helpers/read-json'

const KVM_UNAVAILABLE_REASON = '/dev/kvm is not available or not writable; pass --device /dev/kvm and run on a KVM-capable Linux host'

const LifecycleStatusSchema = z.object({
  state: z.enum(OPENCODE_LIFECYCLE_STATES),
  healthy: z.boolean(),
  port: z.number(),
  lastError: z.string().nullable(),
})

const ProcessesResponseSchema = z.object({
  opencode: z.object({
    port: z.number(),
    healthy: z.boolean(),
    lifecycle: LifecycleStatusSchema.nullable(),
  }),
})

const ErrorResponseSchema = z.object({ error: z.string() })

function createOpenCodeStatus(overrides: Partial<HealthOpenCodeStatus> = {}): HealthOpenCodeStatus {
  return {
    checkHealth: async () => true,
    getLastStartupError: () => null,
    getPort: () => 5551,
    getVersion: () => '1.0.0',
    getMinVersion: () => '2.0.15',
    isVersionSupported: () => true,
    isRestartPending: () => false,
    isSandboxEnforced: () => false,
    ...overrides,
  }
}

function createLifecycleStatus(overrides: Partial<OpenCodeLifecycleStatus> = {}): OpenCodeLifecycleStatus {
  return {
    state: 'healthy',
    healthy: true,
    port: 5551,
    version: '1.0.0',
    minVersion: '2.0.15',
    versionSupported: true,
    lastError: null,
    activeRecoveryAction: null,
    attemptedRecoveryActions: [],
    nextRecoveryAction: null,
    failureCount: 0,
    watching: true,
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function createSandboxProbes(overrides: Partial<SandboxCapabilityProbes> = {}): SandboxCapabilityProbes {
  return {
    isKvmAccessible: () => true,
    readMsbVersion: () => ({ status: 0, stdout: 'msb 0.3.1\n', stderr: '' }),
    resolveExecUserUid: () => null,
    currentUid: () => 1000,
    currentGid: () => 1000,
    ...overrides,
  }
}

describe('health routes', () => {
  let db: Database
  let restoreEnv: (() => void) | undefined
  let binDirectory: string

  function primeSandboxCapability(available: boolean): void {
    resetSandboxCapabilityCache()
    detectSandboxCapability(createSandboxProbes(available ? {} : { isKvmAccessible: () => false }))
  }

  function enableSandboxPreference(): void {
    seedSettings(db, { sandbox: { ...DEFAULT_USER_PREFERENCES.sandbox, enabled: true } })
  }

  beforeEach(() => {
    db = createTestDatabase()
    binDirectory = mkdtempSync(path.join(tmpdir(), 'ocm-health-msb-'))
    const binary = path.join(binDirectory, 'msb')
    writeFileSync(binary, '#!/bin/sh\necho "msb 0.3.1"\n', { mode: 0o755 })
    chmodSync(binary, 0o755)
    restoreEnv = applyTestEnv({ PATH: binDirectory })
    overrideSandboxExecutableTrustValidator(() => true)
    forceProcessAttestation(true)
    resetSandboxCapabilityCache()
    primeSandboxCapability(false)
  })

  afterEach(() => {
    resetSandboxCapabilityCache()
    overrideSandboxExecutableTrustValidator(null)
    forceProcessAttestation(null)
    restoreEnv?.()
    rmSync(binDirectory, { recursive: true, force: true })
    db.close()
  })

  it('reports healthy when the database and OpenCode are healthy', async () => {
    const app = createHealthRoutes(db, undefined, createOpenCodeStatus())

    const response = await app.request('/')
    const body = await readJson(response, healthResponseSchema)

    expect(response.status).toBe(200)
    expect(body.status).toBe('healthy')
    expect(body.database).toBe('connected')
    expect(body.opencode).toBe('healthy')
    expect(body.opencodePort).toBe(5551)
  })

  it('reports degraded when OpenCode is unhealthy without a startup error', async () => {
    const app = createHealthRoutes(db, undefined, createOpenCodeStatus({ checkHealth: async () => false }))

    const response = await app.request('/')
    const body = await readJson(response, healthResponseSchema)

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.opencode).toBe('unhealthy')
  })

  it('reports unhealthy with 503 when OpenCode is unhealthy and a startup error exists', async () => {
    const app = createHealthRoutes(
      db,
      undefined,
      createOpenCodeStatus({
        checkHealth: async () => false,
        getLastStartupError: () => 'Failed to start OpenCode server',
      }),
    )

    const response = await app.request('/')
    const body = await readJson(response, healthResponseSchema)

    expect(response.status).toBe(503)
    expect(body.status).toBe('unhealthy')
    expect(body.error).toBe('Failed to start OpenCode server')
  })

  it('reports degraded when the database ping fails but OpenCode is healthy', async () => {
    const app = createHealthRoutes(db, undefined, createOpenCodeStatus(), { pingDatabase: () => false })

    const response = await app.request('/')
    const body = await readJson(response, healthResponseSchema)

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.database).toBe('disconnected')
    expect(body.opencode).toBe('healthy')
  })

  it('includes the sandbox runtime availability, preference, and enforcement', async () => {
    primeSandboxCapability(true)
    enableSandboxPreference()
    const app = createHealthRoutes(db, undefined, createOpenCodeStatus({ isSandboxEnforced: () => true }))

    const response = await app.request('/')
    const body = await readJson(response, healthResponseSchema)

    expect(response.status).toBe(200)
    expect(body.status).toBe('healthy')
    expect(body.sandbox).toEqual({ available: true, enabled: true, enforced: true, msbVersion: 'msb 0.3.1' })
  })

  it('keeps the overall status healthy when the sandbox runtime is unavailable', async () => {
    const app = createHealthRoutes(db, undefined, createOpenCodeStatus())

    const response = await app.request('/')
    const body = await readJson(response, healthResponseSchema)

    expect(response.status).toBe(200)
    expect(body.status).toBe('healthy')
    expect(body.sandbox).toEqual({
      available: false,
      enabled: false,
      enforced: false,
      reason: KVM_UNAVAILABLE_REASON,
    })
  })

  it('reports an enabled sandbox that the running child has not adopted yet', async () => {
    enableSandboxPreference()
    const app = createHealthRoutes(db, undefined, createOpenCodeStatus())

    const response = await app.request('/')
    const body = await readJson(response, healthResponseSchema)

    expect(body.status).toBe('healthy')
    expect(body.sandbox).toEqual({
      available: false,
      enabled: true,
      enforced: false,
      reason: KVM_UNAVAILABLE_REASON,
    })
  })

  it.each([{ sandboxEnabled: false }, { sandboxEnabled: true }])(
    'reports an enforced running child while the sandbox runtime is unavailable (preference enabled: $sandboxEnabled)',
    async ({ sandboxEnabled }) => {
      if (sandboxEnabled) enableSandboxPreference()
      const app = createHealthRoutes(db, undefined, createOpenCodeStatus({ isSandboxEnforced: () => true }))

      const response = await app.request('/')
      const body = await readJson(response, healthResponseSchema)

      expect(body.status).toBe('healthy')
      expect(body.sandbox).toEqual({
        available: false,
        enabled: sandboxEnabled,
        enforced: true,
        reason: KVM_UNAVAILABLE_REASON,
      })
    },
  )

  it.each([{ enforced: false }, { enforced: true }])(
    'keeps a safe sandbox status when the sandbox status lookup throws (enforced: $enforced)',
    async ({ enforced }) => {
      db.exec('DROP TABLE user_preferences')
      const app = createHealthRoutes(db, undefined, createOpenCodeStatus({ isSandboxEnforced: () => enforced }))

      const response = await app.request('/')
      const body = await readJson(response, healthResponseSchema)

      expect(response.status).toBe(200)
      expect(body.status).toBe('healthy')
      expect(body.sandbox?.available).toBe(false)
      expect(body.sandbox?.enabled).toBe(false)
      expect(body.sandbox?.enforced).toBe(enforced)
      expect(body.sandbox?.reason).toContain('user_preferences')
    },
  )

  it('reports unhealthy with 503 when the health check throws', async () => {
    const closedDb = createTestDatabase()
    closedDb.close()
    const app = createHealthRoutes(closedDb, undefined, createOpenCodeStatus())

    const response = await app.request('/')
    const body = await readJson(response, healthResponseSchema)

    expect(response.status).toBe(503)
    expect(body.status).toBe('unhealthy')
    expect(body.database).toBe('disconnected')
    expect(body.opencode).toBe('unhealthy')
    expect(body.opencodePort).toBe(5551)
    expect(body.opencodeVersion).toBe('1.0.0')
    expect(body.opencodeMinVersion).toBe('2.0.15')
    expect(body.opencodeVersionSupported).toBe(true)
    expect(body.opencodeManagerVersion).not.toBeUndefined()
    expect(body.error).not.toBe('')
  })

  it('returns the full unhealthy body when the OpenCode health check throws', async () => {
    const app = createHealthRoutes(
      db,
      undefined,
      createOpenCodeStatus({
        checkHealth: async () => {
          throw new Error('connection refused')
        },
      }),
    )

    const response = await app.request('/')
    const body = await readJson(response, healthResponseSchema)

    expect(response.status).toBe(503)
    expect(body.status).toBe('unhealthy')
    expect(body.database).toBe('disconnected')
    expect(body.opencode).toBe('unhealthy')
    expect(body.opencodePort).toBe(5551)
    expect(body.error).toBe('connection refused')
  })

  it('reads the supervisor status on both routes without triggering recovery', async () => {
    const lifecycle = createLifecycleStatus()
    const getStatus = vi.fn(() => lifecycle)
    const checkNow = vi.fn(async () => lifecycle)
    const supervisor: HealthSupervisor = { getStatus, checkNow }
    const app = createHealthRoutes(db, supervisor, createOpenCodeStatus())

    const healthResponse = await app.request('/')
    const processesResponse = await app.request('/processes')
    const healthBody = await readJson(healthResponse, healthResponseSchema)
    const processesBody = await readJson(processesResponse, ProcessesResponseSchema)

    expect(healthResponse.status).toBe(200)
    expect(processesResponse.status).toBe(200)
    expect(healthBody.opencodeLifecycle?.state).toBe('healthy')
    expect(processesBody.opencode.lifecycle?.state).toBe('healthy')
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(checkNow).not.toHaveBeenCalled()
  })

  it('reports a 500 when the process status lookup throws', async () => {
    const getStatus = vi.fn(() => {
      throw new Error('supervisor unavailable')
    })
    const supervisor: HealthSupervisor = { getStatus, checkNow: vi.fn(async () => createLifecycleStatus()) }
    const app = createHealthRoutes(db, supervisor, createOpenCodeStatus())

    const response = await app.request('/processes')
    const body = await readJson(response, ErrorResponseSchema)

    expect(response.status).toBe(500)
    expect(body.error).toBe('supervisor unavailable')
  })
})
