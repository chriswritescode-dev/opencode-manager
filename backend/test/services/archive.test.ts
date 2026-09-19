import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import type { ReadStream } from 'fs'
import {
  createRepoArchive,
  createDirectoryArchive,
  deleteArchive,
  getArchiveStream,
  getArchiveSize,
  getIgnoredPathsList,
} from '../../src/services/archive'
import { getReposPath } from '@opencode-manager/shared/config/env'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function listZipEntries(zipPath: string): string[] {
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf-8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function readStreamToBuffer(stream: ReadStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  }
  return Buffer.concat(chunks)
}

describe('archive service', () => {
  let tmpRoot: string
  let gitRepoPath: string
  let plainDirPath: string
  let fakeGitDirPath: string
  const zipPaths: string[] = []
  const createdDirs: string[] = []

  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'archive-service-test-'))

    gitRepoPath = path.join(tmpRoot, 'git-repo')
    mkdirSync(path.join(gitRepoPath, 'src'), { recursive: true })
    mkdirSync(path.join(gitRepoPath, 'ignored-dir'), { recursive: true })
    writeFileSync(path.join(gitRepoPath, '.gitignore'), 'ignored.txt\nignored-dir/\n')
    writeFileSync(path.join(gitRepoPath, 'tracked.txt'), 'tracked')
    writeFileSync(path.join(gitRepoPath, 'src', 'index.ts'), 'export const value = 1\n')
    writeFileSync(path.join(gitRepoPath, 'ignored.txt'), 'ignored')
    writeFileSync(path.join(gitRepoPath, 'ignored-dir', 'nested.txt'), 'nested')
    runGit(gitRepoPath, ['init'])
    runGit(gitRepoPath, ['config', 'user.email', 'test@example.com'])
    runGit(gitRepoPath, ['config', 'user.name', 'Test'])
    runGit(gitRepoPath, ['add', '.'])
    runGit(gitRepoPath, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'initial'])

    plainDirPath = path.join(tmpRoot, 'plain-dir')
    mkdirSync(plainDirPath, { recursive: true })
    writeFileSync(path.join(plainDirPath, 'file.txt'), 'plain')

    fakeGitDirPath = path.join(tmpRoot, 'fake-git-dir')
    mkdirSync(path.join(fakeGitDirPath, '.git'), { recursive: true })
    writeFileSync(path.join(fakeGitDirPath, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(path.join(fakeGitDirPath, 'file.txt'), 'fake')
  })

  afterEach(async () => {
    while (zipPaths.length > 0) {
      const zipPath = zipPaths.pop()
      if (zipPath) await rm(zipPath, { force: true })
    }
    while (createdDirs.length > 0) {
      const dirPath = createdDirs.pop()
      if (dirPath) await rm(dirPath, { recursive: true, force: true })
    }
  })

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  describe('createRepoArchive', () => {
    it('creates a zip excluding .git and gitignored paths by default', async () => {
      const zipPath = await createRepoArchive(gitRepoPath)
      zipPaths.push(zipPath)

      expect(existsSync(zipPath)).toBe(true)
      expect(path.dirname(zipPath)).toBe(tmpdir())
      expect(path.basename(zipPath)).toMatch(/^git-repo-\d+\.zip$/)

      const entries = listZipEntries(zipPath)
      expect(entries).toContain('git-repo/tracked.txt')
      expect(entries).toContain('git-repo/src/index.ts')
      expect(entries).toContain('git-repo/.gitignore')
      expect(entries.some((entry) => entry.startsWith('git-repo/.git/'))).toBe(false)
      expect(entries).not.toContain('git-repo/ignored.txt')
      expect(entries).not.toContain('git-repo/ignored-dir/nested.txt')
    })

    it('includes .git contents when includeGit is true', async () => {
      const zipPath = await createRepoArchive(gitRepoPath, { includeGit: true })
      zipPaths.push(zipPath)

      const entries = listZipEntries(zipPath)
      expect(entries).toContain('git-repo/.git/HEAD')
      expect(entries.some((entry) => entry.startsWith('git-repo/.git/'))).toBe(true)
    })

    it('includes an ignored file requested through includePaths', async () => {
      const zipPath = await createRepoArchive(gitRepoPath, { includePaths: ['ignored.txt'] })
      zipPaths.push(zipPath)

      const entries = listZipEntries(zipPath)
      expect(entries).toContain('git-repo/ignored.txt')
      expect(entries).not.toContain('git-repo/ignored-dir/nested.txt')
    })

    it('includes a nested ignored file requested through includePaths', async () => {
      const zipPath = await createRepoArchive(gitRepoPath, {
        includePaths: ['ignored-dir/nested.txt'],
      })
      zipPaths.push(zipPath)

      const entries = listZipEntries(zipPath)
      expect(entries).toContain('git-repo/ignored-dir/nested.txt')
      expect(entries).not.toContain('git-repo/ignored.txt')
    })
  })

  describe('createDirectoryArchive', () => {
    it('uses the directory basename as the archive name', async () => {
      const zipPath = await createDirectoryArchive(plainDirPath)
      zipPaths.push(zipPath)

      expect(path.dirname(zipPath)).toBe(tmpdir())
      expect(path.basename(zipPath)).toMatch(/^plain-dir-\d+\.zip$/)
      expect(listZipEntries(zipPath)).toContain('plain-dir/file.txt')
    })

    it('uses a custom archive name when provided', async () => {
      const zipPath = await createDirectoryArchive(plainDirPath, 'custom-name')
      zipPaths.push(zipPath)

      expect(path.basename(zipPath)).toMatch(/^custom-name-\d+\.zip$/)
      expect(listZipEntries(zipPath)).toContain('custom-name/file.txt')
    })

    it('resolves a relative directory path against the repos directory', async () => {
      const relativeName = `archive-relative-${Date.now()}`
      const dirPath = path.join(getReposPath(), relativeName)
      mkdirSync(dirPath, { recursive: true })
      writeFileSync(path.join(dirPath, 'relative.txt'), 'relative')
      createdDirs.push(dirPath)

      const zipPath = await createDirectoryArchive(relativeName)
      zipPaths.push(zipPath)

      expect(path.basename(zipPath)).toMatch(new RegExp(`^${relativeName}-\\d+\\.zip$`))
      expect(listZipEntries(zipPath)).toContain(`${relativeName}/relative.txt`)
    })
  })

  describe('deleteArchive', () => {
    it('removes an existing archive', async () => {
      const zipPath = await createDirectoryArchive(plainDirPath, 'delete-me')
      expect(existsSync(zipPath)).toBe(true)

      await deleteArchive(zipPath)

      expect(existsSync(zipPath)).toBe(false)
    })

    it('resolves when the archive does not exist', async () => {
      const missingPath = path.join(tmpdir(), `missing-archive-${Date.now()}.zip`)

      await expect(deleteArchive(missingPath)).resolves.toBeUndefined()
    })
  })

  describe('getArchiveStream and getArchiveSize', () => {
    it('streams the archive to completion and reports its size', async () => {
      const zipPath = await createDirectoryArchive(plainDirPath, 'stream-test')
      zipPaths.push(zipPath)

      const size = await getArchiveSize(zipPath)
      const buffer = await readStreamToBuffer(getArchiveStream(zipPath))

      expect(size).toBeGreaterThan(0)
      expect(buffer.length).toBe(size)
      expect(buffer.subarray(0, 2).toString('utf-8')).toBe('PK')
    })

    it('rejects getArchiveSize for a missing file', async () => {
      const missingPath = path.join(tmpdir(), `missing-size-${Date.now()}.zip`)

      await expect(getArchiveSize(missingPath)).rejects.toThrow()
    })
  })

  describe('getIgnoredPathsList', () => {
    it('returns ignored directories and .git for a git repository', async () => {
      const result = await getIgnoredPathsList(gitRepoPath)

      expect(result).toEqual(['.git/', 'ignored-dir/', 'ignored.txt/'])
    })

    it('returns [] for a non-git directory containing a .git folder', async () => {
      expect(existsSync(path.join(fakeGitDirPath, '.git'))).toBe(true)

      const result = await getIgnoredPathsList(fakeGitDirPath)

      expect(result).toEqual([])
    })

    it('returns [] for a plain directory without git metadata', async () => {
      const result = await getIgnoredPathsList(plainDirPath)

      expect(result).toEqual([])
    })

    it('resolves a relative directory path against the repos directory', async () => {
      const relativeName = `archive-ignored-${Date.now()}`
      const dirPath = path.join(getReposPath(), relativeName)
      mkdirSync(dirPath, { recursive: true })
      writeFileSync(path.join(dirPath, 'file.txt'), 'relative')
      createdDirs.push(dirPath)

      const result = await getIgnoredPathsList(relativeName)

      expect(result).toEqual([])
    })
  })
})
