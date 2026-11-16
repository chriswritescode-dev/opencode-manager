import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import type { Database } from 'bun:sqlite'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'os'
import path from 'path'
import { ENV } from '@opencode-manager/shared/config/env'
import { parseMemoryMib } from '../../../src/services/sandbox/command'
import {
  envSandboxResources,
  resetCheckoutRunResources,
  resolveCheckoutSandboxResources,
  resolveSandboxResources,
  sandboxResourceLimitError,
  setCheckoutRunResources,
} from '../../../src/services/sandbox/resources'
import { setRepoSandboxResources } from '../../../src/db/queries'
import { createCommittedRepo, git } from '../../helpers/git-fixtures'
import { createTestDatabase, seedRepo, seedSettings } from '../../helpers/test-database'

describe('sandbox resources', () => {
  const hostCpus = os.availableParallelism()
  const hostMemoryMib = Math.floor(os.totalmem() / 1048576)

  it('reads the environment sandbox resources', () => {
    expect(envSandboxResources()).toEqual({
      cpus: ENV.SANDBOX.CPUS,
      memoryMib: parseMemoryMib(ENV.SANDBOX.MEMORY),
    })
  })

  it('falls back to the environment when no preferences or override are set', () => {
    expect(resolveSandboxResources(undefined, null)).toEqual(envSandboxResources())
  })

  it('prefers preference values over the environment', () => {
    expect(resolveSandboxResources({ enabled: false, cpus: 6, memoryMib: 2048 }, null)).toEqual({
      cpus: 6,
      memoryMib: 2048,
    })
  })

  it('prefers the per-session override over preferences and the environment', () => {
    expect(
      resolveSandboxResources({ enabled: false, cpus: 6, memoryMib: 2048 }, { cpus: 2, memoryMib: 1024 }),
    ).toEqual({ cpus: 2, memoryMib: 1024 })
  })

  it('fills each field independently from preferences and the environment', () => {
    const env = envSandboxResources()
    expect(resolveSandboxResources({ enabled: false, cpus: 6 }, null)).toEqual({ cpus: 6, memoryMib: env.memoryMib })
    expect(resolveSandboxResources({ enabled: false, memoryMib: 2048 }, null)).toEqual({ cpus: env.cpus, memoryMib: 2048 })
  })

  it('accepts requests within the host limits', () => {
    expect(sandboxResourceLimitError({})).toBeNull()
    expect(sandboxResourceLimitError({ cpus: hostCpus })).toBeNull()
    expect(sandboxResourceLimitError({ memoryMib: hostMemoryMib })).toBeNull()
  })

  it('rejects a cpu request above the host limit', () => {
    const error = sandboxResourceLimitError({ cpus: hostCpus + 1 })

    expect(error).toContain(String(hostCpus + 1))
    expect(error).toContain(String(hostCpus))
  })

  it('rejects a memory request above the host limit', () => {
    const error = sandboxResourceLimitError({ memoryMib: hostMemoryMib + 1 })

    expect(error).toContain(String(hostMemoryMib + 1))
    expect(error).toContain(String(hostMemoryMib))
  })
})

describe('checkout sandbox resource resolution', () => {
  let db: Database
  const tempRoots: string[] = []

  beforeEach(() => {
    db = createTestDatabase()
  })

  afterEach(() => {
    resetCheckoutRunResources()
    db.close()
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  function createTempRoot(): string {
    const root = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'ocm-sandbox-resources-'))
    tempRoots.push(root)
    return root
  }

  function createCheckout(name: string): string {
    const checkout = path.join(createTempRoot(), name)
    mkdirSync(checkout, { recursive: true })
    return realpathSync(checkout)
  }

  it('prefers a registered run override for the checkout key', async () => {
    const checkout = createCheckout('checkout')
    const repo = seedRepo(db, { localPath: checkout, sourcePath: checkout })
    setRepoSandboxResources(db, repo.id, { cpus: 5, memoryMib: 5120 })
    setCheckoutRunResources(checkout, { cpus: 2, memoryMib: 2048 })

    await expect(resolveCheckoutSandboxResources(db, checkout)).resolves.toEqual({ cpus: 2, memoryMib: 2048 })
  })

  it('prefers the stored repository override over the global preferences', async () => {
    const checkout = createCheckout('checkout')
    const repo = seedRepo(db, { localPath: checkout, sourcePath: checkout })
    setRepoSandboxResources(db, repo.id, { cpus: 3, memoryMib: 3072 })
    seedSettings(db, { sandbox: { enabled: true, cpus: 2, memoryMib: 2048 } })

    await expect(resolveCheckoutSandboxResources(db, checkout)).resolves.toEqual({ cpus: 3, memoryMib: 3072 })
  })

  it('falls back to the main checkout override for a linked worktree without its own override', async () => {
    const main = createCheckout('main')
    createCommittedRepo(main, 'main')
    const linked = path.join(path.dirname(main), 'linked')
    git(['worktree', 'add', '--detach', linked], main)
    const mainRepo = seedRepo(db, { localPath: main, sourcePath: main })
    seedRepo(db, { localPath: linked, sourcePath: linked, isWorktree: true })
    setRepoSandboxResources(db, mainRepo.id, { cpus: 4, memoryMib: 4096 })

    await expect(resolveCheckoutSandboxResources(db, realpathSync(linked))).resolves.toEqual({
      cpus: 4,
      memoryMib: 4096,
    })
  })

  it('uses the global preferences when no repository override is stored', async () => {
    const checkout = createCheckout('checkout')
    seedRepo(db, { localPath: checkout, sourcePath: checkout })
    seedSettings(db, { sandbox: { enabled: true, cpus: 6, memoryMib: 6144 } })

    await expect(resolveCheckoutSandboxResources(db, checkout)).resolves.toEqual({ cpus: 6, memoryMib: 6144 })
  })

  it('falls back to the environment when nothing is configured', async () => {
    const checkout = createCheckout('checkout')

    await expect(resolveCheckoutSandboxResources(db, checkout)).resolves.toEqual(envSandboxResources())
  })
})
