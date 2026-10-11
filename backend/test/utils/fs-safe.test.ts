import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalPath, canonicalPathSync, writeFileAtomic, writeFileAtomicSync } from '../../src/utils/fs-safe'

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

describe('writeFileAtomicSync', () => {
  let workDir = ''

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'fs-safe-atomic-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('writes the content and creates missing parent directories', async () => {
    const target = path.join(workDir, 'nested', 'file.json')

    writeFileAtomicSync(target, '{"ok":true}', { mode: 0o644 })

    await expect(readFile(target, 'utf8')).resolves.toBe('{"ok":true}')
    expect((await stat(target)).mode & 0o777).toBe(0o644)
  })

  it('overwrites an existing file', async () => {
    const target = path.join(workDir, 'file.txt')
    await writeFile(target, 'old')

    writeFileAtomicSync(target, 'new')

    await expect(readFile(target, 'utf8')).resolves.toBe('new')
  })

  it('leaves no temp files behind', async () => {
    const target = path.join(workDir, 'file.txt')

    writeFileAtomicSync(target, 'content')

    await expect(readdir(workDir)).resolves.toEqual(['file.txt'])
  })
})

describe('writeFileAtomic', () => {
  let workDir = ''

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'fs-safe-atomic-async-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('writes Buffer bytes unchanged and leaves no temp file behind', async () => {
    const target = path.join(workDir, 'audio.mp3')
    const bytes = Buffer.from([0xff, 0x00, 0xfe, 0x80])

    await writeFileAtomic(target, bytes)

    expect(await readFile(target)).toEqual(bytes)
    expect((await stat(target)).mode & 0o777).toBe(0o600)
    await expect(readdir(workDir)).resolves.toEqual(['audio.mp3'])
  })

  it('removes the temp file and rethrows when the rename fails', async () => {
    const target = path.join(workDir, 'target')
    await mkdir(target)
    await writeFile(path.join(target, 'blocker'), 'x')

    await expect(writeFileAtomic(target, 'content')).rejects.toThrow()

    await expect(readdir(workDir)).resolves.toEqual(['target'])
  })
})
