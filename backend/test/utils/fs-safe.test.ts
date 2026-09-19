import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalPath, canonicalPathSync } from '../../src/utils/fs-safe'

describe('canonicalPath', () => {
  let workDir = ''

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'fs-safe-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('resolves an existing path to its realpath', async () => {
    const expected = await realpath(workDir)

    await expect(canonicalPath(workDir)).resolves.toBe(expected)
    expect(canonicalPathSync(workDir)).toBe(expected)
  })

  it('returns a missing path unchanged', async () => {
    const missing = path.join(workDir, 'missing', 'target')

    await expect(canonicalPath(missing)).resolves.toBe(missing)
    expect(canonicalPathSync(missing)).toBe(missing)
  })
})
