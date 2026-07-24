import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSafe, mkdirSyncSafe } from './fs-safe'
import { join } from 'node:path'
import { mkdtemp, rm, mkdir, stat, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as nodeFs from 'node:fs'
import { statSync, mkdirSync, chmodSync } from 'node:fs'

describe('fs-safe', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fs-safe-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  describe('mkdirSafe', () => {
    it('creates nested directories that do not exist', async () => {
      const dir = join(tmpDir, 'a', 'b', 'c')
      await mkdirSafe(dir)
      const stats = await stat(dir)
      expect(stats.isDirectory()).toBe(true)
    })

    it('resolves without error when the directory already exists', async () => {
      const dir = join(tmpDir, 'existing')
      await mkdir(dir, { recursive: true })
      await expect(mkdirSafe(dir)).resolves.toBeUndefined()
    })

    it('honors mode option', async () => {
      const previousUmask = process.umask(0)
      try {
        const dir = join(tmpDir, 'mode700')
        await mkdirSafe(dir, { mode: 0o700 })
        const stats = await stat(dir)
        expect(stats.mode & 0o777).toBe(0o700)
      } finally {
        process.umask(previousUmask)
      }
    })

    it('rethrows EACCES when the target directory truly does not exist', async () => {
      const parent = join(tmpDir, 'readonly-parent')
      await mkdir(parent, { recursive: true })
      await chmod(parent, 0o555)
      try {
        await expect(mkdirSafe(join(parent, 'child'))).rejects.toMatchObject({
          code: 'EACCES',
        })
      } finally {
        await chmod(parent, 0o755)
      }
    })

    it('swallows EACCES when the target directory already exists', async () => {
      const dir = join(tmpDir, 'exists-eacces')
      await mkdir(dir, { recursive: true })
      const spy = vi.spyOn(nodeFs.promises, 'mkdir').mockRejectedValueOnce(
        Object.assign(new Error('EACCES'), { code: 'EACCES' }),
      )
      await expect(mkdirSafe(dir)).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalled()
    })

    it('rethrows non-permission errors unchanged', async () => {
      const dir = join(tmpDir, 'enospc')
      await mkdir(dir, { recursive: true })
      const spy = vi.spyOn(nodeFs.promises, 'mkdir').mockRejectedValueOnce(
        Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }),
      )
      await expect(mkdirSafe(dir)).rejects.toMatchObject({ code: 'ENOSPC' })
      expect(spy).toHaveBeenCalled()
    })
  })

  describe('mkdirSyncSafe', () => {
    it('creates nested directories that do not exist', () => {
      const dir = join(tmpDir, 'sync', 'a', 'b')
      mkdirSyncSafe(dir)
      expect(statSync(dir).isDirectory()).toBe(true)
    })

    it('resolves without error when the directory already exists', () => {
      const dir = join(tmpDir, 'sync-existing')
      mkdirSync(dir, { recursive: true })
      expect(() => mkdirSyncSafe(dir)).not.toThrow()
    })

    it('rethrows EACCES when the target directory truly does not exist', () => {
      const parent = join(tmpDir, 'sync-readonly-parent')
      mkdirSync(parent, { recursive: true })
      chmodSync(parent, 0o555)
      let threw: unknown
      try {
        mkdirSyncSafe(join(parent, 'child'))
      } catch (error) {
        threw = error
      } finally {
        chmodSync(parent, 0o755)
      }
      expect(threw).toMatchObject({ code: 'EACCES' })
    })
  })
})
