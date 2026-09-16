import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readJsonSafe, writeJsonAtomic, withFileLock } from './atomic-json'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

describe('atomic-json', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'atomic-json-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('readJsonSafe', () => {
    it('returns fallback when file does not exist', async () => {
      const fallback = { foo: 'bar' }
      const result = await readJsonSafe(join(tmpDir, 'nonexistent.json'), fallback)
      expect(result).toEqual(fallback)
    })

    it('returns fallback when file contains invalid JSON and logs a warning', async () => {
      const filePath = join(tmpDir, 'invalid.json')
      await writeFile(filePath, '{ invalid json }', 'utf8')
      const fallback = { foo: 'bar' }
      const result = await readJsonSafe(filePath, fallback)
      expect(result).toEqual(fallback)
    })

    it('returns parsed value when file contains valid JSON', async () => {
      const filePath = join(tmpDir, 'valid.json')
      const data = { foo: 'bar', nested: { value: 42 } }
      await writeFile(filePath, JSON.stringify(data), 'utf8')
      const result = await readJsonSafe(filePath, { fallback: true })
      expect(result).toEqual(data)
    })
  })

  describe('writeJsonAtomic', () => {
    it('writes valid JSON readable by JSON.parse', async () => {
      const filePath = join(tmpDir, 'output.json')
      const data = { test: 'value', number: 123 }
      await writeJsonAtomic(filePath, data)
      const content = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(content)
      expect(parsed).toEqual(data)
    })

    it('does not leave .tmp.* files on success', async () => {
      const filePath = join(tmpDir, 'output.json')
      await writeJsonAtomic(filePath, { test: 'value' })
      const { readdir } = await import('node:fs/promises')
      const files = await readdir(tmpDir)
      const tmpFiles = files.filter((f) => f.includes('.tmp.'))
      expect(tmpFiles.length).toBe(0)
    })

    it('round-trips a complex object', async () => {
      const filePath = join(tmpDir, 'roundtrip.json')
      const data = {
        array: [1, 2, 3],
        nested: { a: 'b', c: { d: 'e' } },
        nullish: null,
        bool: true,
      }
      await writeJsonAtomic(filePath, data)
      const result = await readJsonSafe(filePath, null)
      expect(result).toEqual(data)
    })
  })

  describe('withFileLock', () => {
    it('serializes two concurrent calls', async () => {
      const filePath = join(tmpDir, 'locked.json')
      const executionOrder: number[] = []

      const task1 = withFileLock(filePath, async () => {
        executionOrder.push(1)
        await new Promise((resolve) => setTimeout(resolve, 50))
        executionOrder.push(2)
        return 'task1'
      })

      const task2 = withFileLock(filePath, async () => {
        executionOrder.push(3)
        await new Promise((resolve) => setTimeout(resolve, 50))
        executionOrder.push(4)
        return 'task2'
      })

      const [result1, result2] = await Promise.all([task1, task2])

      expect(result1).toBe('task1')
      expect(result2).toBe('task2')
      expect(executionOrder).toEqual([1, 2, 3, 4])
    })

    it('runs the next queued call when the previous call rejects', async () => {
      const filePath = join(tmpDir, 'reject-next.json')
      const firstError = new Error('first fails')
      let secondRan = false

      const first = withFileLock(filePath, async () => {
        throw firstError
      })

      const second = withFileLock(filePath, async () => {
        secondRan = true
        return 'second'
      })

      await expect(first).rejects.toThrow('first fails')
      await expect(second).resolves.toBe('second')
      expect(secondRan).toBe(true)
    })

    it('does not poison the lock for later calls after a rejection settles', async () => {
      const filePath = join(tmpDir, 'reject-recovery.json')
      const firstError = new Error('first fails')

      await expect(
        withFileLock(filePath, async () => {
          throw firstError
        }),
      ).rejects.toThrow('first fails')

      await expect(withFileLock(filePath, async () => 'recovered')).resolves.toBe('recovered')
    })

    it('serializes calls when an operation rejects', async () => {
      const filePath = join(tmpDir, 'reject-order.json')
      const executionOrder: number[] = []

      const first = withFileLock(filePath, async () => {
        executionOrder.push(1)
        await new Promise((resolve) => setTimeout(resolve, 50))
        executionOrder.push(2)
        throw new Error('first fails')
      })

      const second = withFileLock(filePath, async () => {
        executionOrder.push(3)
        await new Promise((resolve) => setTimeout(resolve, 50))
        executionOrder.push(4)
        return 'second'
      })

      const [firstResult, secondResult] = await Promise.allSettled([first, second])

      expect(firstResult.status).toBe('rejected')
      expect(secondResult).toEqual({ status: 'fulfilled', value: 'second' })
      expect(executionOrder).toEqual([1, 2, 3, 4])
    })

    it('concurrent stress test: 50 writes then reads', async () => {
      const filePath = join(tmpDir, 'stress.json')
      const numOps = 50

      const operations = Array.from({ length: numOps }, (_, i) =>
        withFileLock(filePath, async () => {
          const data = { value: i, timestamp: Date.now() }
          await writeJsonAtomic(filePath, data)
          const read = await readJsonSafe(filePath, null)
          return { written: data, read }
        }),
      )

      await Promise.all(operations)
      const finalRead = await readJsonSafe(filePath, null)

      expect(finalRead).toEqual({ value: numOps - 1, timestamp: expect.any(Number) })
      expect(typeof finalRead).toBe('object')
      expect(finalRead).not.toBeNull()
    })
  })
})
