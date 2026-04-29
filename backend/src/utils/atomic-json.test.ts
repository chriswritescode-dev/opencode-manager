import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readJsonSafe, writeJsonAtomic, withFileLock } from './atomic-json'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
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
      await Bun.write(filePath, '{ invalid json }')
      const fallback = { foo: 'bar' }
      const result = await readJsonSafe(filePath, fallback)
      expect(result).toEqual(fallback)
    })

    it('returns parsed value when file contains valid JSON', async () => {
      const filePath = join(tmpDir, 'valid.json')
      const data = { foo: 'bar', nested: { value: 42 } }
      await Bun.write(filePath, JSON.stringify(data))
      const result = await readJsonSafe(filePath, { fallback: true })
      expect(result).toEqual(data)
    })
  })

  describe('writeJsonAtomic', () => {
    it('writes valid JSON readable by JSON.parse', async () => {
      const filePath = join(tmpDir, 'output.json')
      const data = { test: 'value', number: 123 }
      await writeJsonAtomic(filePath, data)
      const content = await Bun.file(filePath).text()
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
