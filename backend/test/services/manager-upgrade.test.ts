import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import {
  insertUpgradeJob,
  updateUpgradeJob,
  getLatestUpgradeJob,
} from '../../src/db/manager-upgrade'
import {
  ManagerUpgradeService,
  ManagerUpgradeError,
  replaceImageTag,
} from '../../src/services/manager-upgrade'
import type { DockerRunner, SelfContainerInfo } from '../../src/services/manager-upgrade'

/** Wait for microtasks to drain (e.g., reconcile's async version check) */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5))
}

function createRunner(): { runner: DockerRunner; calls: { inspectSelf: SelfContainerInfo[]; pulled: string[]; spawned: Array<{ info: SelfContainerInfo; targetImage: string }> } } {
  const calls = {
    inspectSelf: [] as SelfContainerInfo[],
    pulled: [] as string[],
    spawned: [] as Array<{ info: SelfContainerInfo; targetImage: string }>,
  }
  const runner: DockerRunner = {
    inspectSelf: vi.fn().mockImplementation(async () => {
      const info: SelfContainerInfo = {
        containerId: 'abc123',
        project: 'opencode',
        service: 'manager',
        workingDir: '/app',
        image: 'opencode-manager:latest',
      }
      calls.inspectSelf.push(info)
      return info
    }),
    pull: vi.fn().mockImplementation(async (image: string) => {
      calls.pulled.push(image)
    }),
    spawnRecreate: vi.fn().mockImplementation((info: SelfContainerInfo, targetImage: string) => {
      calls.spawned.push({ info, targetImage })
    }),
  }
  return { runner, calls }
}

describe('ManagerUpgradeService', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = OFF')
    migrate(db, allMigrations)
    // Clean env between tests
    delete process.env.OCM_IMAGE
  })

  describe('getStatus', () => {
    it('reports supported=false when not in Docker', async () => {
      const { runner } = createRunner()
      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: false, socket: true, enabled: true }),
      })

      const status = await service.getStatus()
      expect(status.supported).toBe(false)
      expect(status.inDocker).toBe(false)
      expect(status.socketAvailable).toBe(true)
      expect(status.enabled).toBe(true)
    })

    it('reports supported=true when all capabilities are met', async () => {
      const { runner } = createRunner()
      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      const status = await service.getStatus()
      expect(status.supported).toBe(true)
    })

    it('includes currentVersion and latest job', async () => {
      const { runner } = createRunner()
      const seedJob = insertUpgradeJob(db, {
        status: 'completed',
        fromVersion: '0.13.0',
        toVersion: '0.14.0',
        startedAt: Date.now(),
      })
      updateUpgradeJob(db, seedJob.id, { finishedAt: Date.now() })

      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      const status = await service.getStatus()
      expect(status.currentVersion).toBe('0.14.0')
      expect(status.job).not.toBeNull()
      expect(status.job!.status).toBe('completed')
    })
  })

  describe('startUpgrade - capability gating', () => {
    // Cycle 1: not supported → 400
    it('throws 400 when not in Docker', async () => {
      const { runner, calls } = createRunner()
      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: false, socket: true, enabled: true }),
      })

      await expect(service.startUpgrade()).rejects.toThrow(ManagerUpgradeError)
      await expect(service.startUpgrade()).rejects.toMatchObject({ status: 400 })
      expect(calls.pulled).toHaveLength(0)
      expect(calls.spawned).toHaveLength(0)
    })

    it('throws 400 when socket is unavailable', async () => {
      const { runner, calls } = createRunner()
      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: false, enabled: true }),
      })

      await expect(service.startUpgrade()).rejects.toMatchObject({ status: 400 })
      expect(calls.pulled).toHaveLength(0)
      expect(calls.spawned).toHaveLength(0)
    })

    it('throws 400 when disabled', async () => {
      const { runner, calls } = createRunner()
      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: false }),
      })

      await expect(service.startUpgrade()).rejects.toMatchObject({ status: 400 })
      expect(calls.pulled).toHaveLength(0)
      expect(calls.spawned).toHaveLength(0)
    })
  })

  describe('startUpgrade - happy path', () => {
    // Cycle 2: happy path — pull then spawnRecreate
    it('pulls image then spawns recreate helper', async () => {
      const { runner, calls } = createRunner()
      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      const job = await service.startUpgrade('0.15.0')

      expect(job.status).toBe('recreating')
      expect(job.toVersion).toBe('0.15.0')
      expect(job.targetImage).toBe('opencode-manager:0.15.0')
      expect(job.fromVersion).toBe('0.14.0')
      expect(job.error).toBeNull()

      // Pull was called with the resolved target image
      expect(calls.pulled).toEqual(['opencode-manager:0.15.0'])
      expect(calls.inspectSelf).toHaveLength(1)

      // spawnRecreate was called with inspectSelf result and targetImage
      expect(calls.spawned).toHaveLength(1)
      const spawnCall = calls.spawned[0]!
      expect(spawnCall.info.project).toBe('opencode')
      expect(spawnCall.info.service).toBe('manager')
      expect(spawnCall.info.workingDir).toBe('/app')
      expect(spawnCall.targetImage).toBe('opencode-manager:0.15.0')

      // DB reflects recreating
      const latest = getLatestUpgradeJob(db)
      expect(latest).not.toBeNull()
      expect(latest!.status).toBe('recreating')
    })

    it('uses OCM_IMAGE env var when set instead of info.image', async () => {
      process.env.OCM_IMAGE = 'my-registry/opencode-manager'
      const { runner, calls } = createRunner()
      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      await service.startUpgrade('0.15.0')
      expect(calls.pulled).toEqual(['my-registry/opencode-manager:0.15.0'])
    })

    it('defaults to latest tag when no targetTag given', async () => {
      const { runner, calls } = createRunner()
      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      await service.startUpgrade()
      expect(calls.pulled).toEqual(['opencode-manager:latest'])
    })
  })

  describe('startUpgrade - concurrency guard', () => {
    // Cycle 3: active job exists → 409
    it('rejects with 409 when an active upgrade job exists', async () => {
      const { runner, calls } = createRunner()
      const getCurrentVersion = vi.fn().mockResolvedValue('0.14.0')
      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion,
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      // Insert active job *after* construction so reconcile doesn't clean it
      insertUpgradeJob(db, {
        status: 'pulling',
        fromVersion: '0.14.0',
        toVersion: '0.15.0',
        startedAt: Date.now(),
      })

      await expect(service.startUpgrade('0.16.0')).rejects.toMatchObject({
        status: 409,
        message: 'An upgrade is already in progress',
      })
      // No Docker or version calls should happen before the 409
      expect(getCurrentVersion).not.toHaveBeenCalled()
      expect(calls.inspectSelf).toHaveLength(0)
      expect(calls.pulled).toHaveLength(0)
      expect(calls.spawned).toHaveLength(0)
    })

    it('prevents concurrent upgrade attempts with overlapping startUpgrade calls', async () => {
      const { runner, calls } = createRunner()

      // Deferred promise so both calls overlap at getCurrentVersion
      let resolveVersion!: (v: string) => void
      const versionPromise = new Promise<string>((resolve) => { resolveVersion = resolve })

      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockReturnValue(versionPromise),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      // Both calls start executing; both hit await getCurrentVersion and block
      const call1 = service.startUpgrade('0.15.0')
      const call2 = service.startUpgrade('0.15.0')

      // Now let them both proceed past the deferred promise
      resolveVersion('0.14.0')

      const [result1, result2] = await Promise.allSettled([call1, call2])

      // Exactly one call should succeed, one should be rejected with 409
      const fulfilled = [result1, result2].filter((r) => r.status === 'fulfilled')
      const rejected = [result1, result2].filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      )

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0]!.reason).toMatchObject({
        status: 409,
        message: 'An upgrade is already in progress',
      })

      // Only one pull and one spawn should have occurred
      expect(calls.pulled).toHaveLength(1)
      expect(calls.spawned).toHaveLength(1)
    })
  })

  describe('startUpgrade - pull failure', () => {
    // Cycle 4: pull fails → job marked failed, 500 thrown
    it('marks job as failed and throws 500 when pull rejects', async () => {
      const { runner, calls } = createRunner()
      runner.pull = vi.fn().mockRejectedValue(new Error('Network error'))

      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      await expect(service.startUpgrade('0.15.0')).rejects.toMatchObject({
        status: 500,
        message: 'Network error',
      })

      // spawnRecreate should NOT have been called
      expect(calls.spawned).toHaveLength(0)

      // Job should be marked failed
      const latest = getLatestUpgradeJob(db)
      expect(latest).not.toBeNull()
      expect(latest!.status).toBe('failed')
      expect(latest!.error).toBe('Network error')
      expect(latest!.finishedAt).not.toBeNull()
    })
  })

  describe('reconcile', () => {
    // Cycle 5: recreating job + version matches toVersion → completed
    it('marks recreating job as completed when current version matches toVersion', async () => {
      const { runner } = createRunner()
      insertUpgradeJob(db, {
        status: 'recreating',
        fromVersion: '0.14.0',
        toVersion: '0.15.0',
        startedAt: Date.now(),
      })

      new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.15.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      await tick()

      const latest = getLatestUpgradeJob(db)
      expect(latest).not.toBeNull()
      expect(latest!.status).toBe('completed')
      expect(latest!.finishedAt).not.toBeNull()
    })

    it('marks recreating job as completed when version changed from fromVersion', async () => {
      const { runner } = createRunner()
      insertUpgradeJob(db, {
        status: 'recreating',
        fromVersion: '0.14.0',
        toVersion: '0.15.0',
        startedAt: Date.now(),
      })

      // Current version is neither fromVersion nor toVersion (e.g., rolled past target)
      new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.16.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      await tick()

      const latest = getLatestUpgradeJob(db)
      expect(latest).not.toBeNull()
      expect(latest!.status).toBe('completed')
    })

    it('leaves recreating job as-is when version has not changed', async () => {
      const { runner } = createRunner()
      insertUpgradeJob(db, {
        status: 'recreating',
        fromVersion: '0.14.0',
        toVersion: '0.15.0',
        startedAt: Date.now(),
      })

      // Same as fromVersion — still waiting for restart
      new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      await tick()

      const latest = getLatestUpgradeJob(db)
      expect(latest).not.toBeNull()
      expect(latest!.status).toBe('recreating')
    })

    it('leaves recreating job as-is when fromVersion was null and current version did not reach toVersion', async () => {
      const { runner } = createRunner()
      // fromVersion omitted → stored as NULL (e.g. version was null at start time)
      insertUpgradeJob(db, {
        status: 'recreating',
        toVersion: '0.15.0',
        startedAt: Date.now(),
      })

      // Current version is still 0.14.0 (target was 0.15.0, helper hasn't finished)
      new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      await tick()

      const latest = getLatestUpgradeJob(db)
      expect(latest).not.toBeNull()
      expect(latest!.status).toBe('recreating')
      expect(latest!.fromVersion).toBeNull()
    })

    // Cycle 6: pulling/pending found at startup → failed
    it('marks pulling job as failed when found after restart', async () => {
      const { runner } = createRunner()
      insertUpgradeJob(db, {
        status: 'pulling',
        fromVersion: '0.14.0',
        toVersion: '0.15.0',
        startedAt: Date.now(),
      })

      new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      const latest = getLatestUpgradeJob(db)
      expect(latest).not.toBeNull()
      expect(latest!.status).toBe('failed')
      expect(latest!.error).toMatch(/interrupted by restart/i)
      expect(latest!.finishedAt).not.toBeNull()
    })

    it('marks pending job as failed when found after restart', async () => {
      const { runner } = createRunner()
      insertUpgradeJob(db, {
        status: 'pending',
        fromVersion: '0.14.0',
        toVersion: '0.15.0',
        startedAt: Date.now(),
      })

      new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      const latest = getLatestUpgradeJob(db)
      expect(latest).not.toBeNull()
      expect(latest!.status).toBe('failed')
      expect(latest!.error).toMatch(/interrupted by restart/i)
    })

    it('does nothing when no active job exists', async () => {
      const { runner } = createRunner()

      new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      const latest = getLatestUpgradeJob(db)
      expect(latest).toBeNull()
    })
  })

  describe('replaceImageTag', () => {
    it.each([
      // [image, newTag, expected]
      ['opencode-manager:0.14.5', '0.15.0', 'opencode-manager:0.15.0'],
      ['ghcr.io/org/app:0.14.5', '0.15.0', 'ghcr.io/org/app:0.15.0'],
      ['localhost:5000/org/app:0.14.5', '0.15.0', 'localhost:5000/org/app:0.15.0'],
      ['my-registry/opencode-manager', '0.15.0', 'my-registry/opencode-manager:0.15.0'],
      ['ubuntu:latest', '22.04', 'ubuntu:22.04'],
      ['ubuntu', '22.04', 'ubuntu:22.04'],
    ])('replaces tag in %s → %s', (image, newTag, expected) => {
      expect(replaceImageTag(image, newTag)).toBe(expected)
    })
  })

  describe('startUpgrade - registry port preservation', () => {
    it('preserves registry port in target image resolution', async () => {
      process.env.OCM_IMAGE = 'localhost:5000/opencode-manager:0.14.5'
      const { runner, calls } = createRunner()
      const service = new ManagerUpgradeService(db, {
        runner,
        getCurrentVersion: vi.fn().mockResolvedValue('0.14.0'),
        capability: () => ({ inDocker: true, socket: true, enabled: true }),
      })

      await service.startUpgrade('0.15.0')
      // Should NOT produce 'localhost:0.15.0'
      expect(calls.pulled).toEqual(['localhost:5000/opencode-manager:0.15.0'])
      expect(calls.spawned[0]!.targetImage).toBe('localhost:5000/opencode-manager:0.15.0')
    })
  })

  describe('ManagerUpgradeError', () => {
    it('is an Error with status', () => {
      const err = new ManagerUpgradeError('test', 400)
      expect(err).toBeInstanceOf(Error)
      expect(err.message).toBe('test')
      expect(err.status).toBe(400)
    })
  })
})
