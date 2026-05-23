import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { spawnSync } from 'child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { gzipSync } from 'zlib'

const { mockGetActiveDirectories, mockGitOut, mockSafeGitOut, getTmpRoot, setTmpRoot } = vi.hoisted(() => {
  const mockGetActiveDirectories = vi.fn().mockReturnValue([])
  const mockGitOut = vi.fn().mockResolvedValue('main')
  const mockSafeGitOut = vi.fn().mockResolvedValue('main')
  let tmpRoot = ''
  return {
    mockGetActiveDirectories,
    mockGitOut,
    mockSafeGitOut,
    getTmpRoot: () => tmpRoot,
    setTmpRoot: (v: string) => { tmpRoot = v },
  }
})

vi.mock('../../../src/services/sse-aggregator', () => ({
  sseAggregator: {
    getActiveDirectories: mockGetActiveDirectories,
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getReposPath: () => getTmpRoot(),
  getWorkspacePath: () => '/tmp/fake-workspace',
}))

vi.mock('../../../src/routes/internal/repo-sync-helpers', () => ({
  gitOut: (...args: unknown[]) => mockGitOut(...args),
  safeGitOut: (...args: unknown[]) => mockSafeGitOut(...args),
  isSafeRelativePath: vi.fn(),
}))

const mockGetRepoById = vi.fn()
const mockUpdateLastPulled = vi.fn()
const mockUpdateRepoBranch = vi.fn()
const mockDeleteRepo = vi.fn()

vi.mock('../../../src/db/queries', () => ({
  getRepoById: (...args: unknown[]) => mockGetRepoById(...args),
  updateLastPulled: (...args: unknown[]) => mockUpdateLastPulled(...args),
  updateRepoBranch: (...args: unknown[]) => mockUpdateRepoBranch(...args),
  deleteRepo: (...args: unknown[]) => mockDeleteRepo(...args),
  createRepo: vi.fn(),
  getRepoByLocalPath: vi.fn(),
  getRepoByUrlAndBranch: vi.fn(),
  updateRepoStatus: vi.fn(),
}))

const mockEnsureMirrorTargetPath = vi.fn()
const mockCreateRepoRow = vi.fn()
const mockIsRepoInUse = vi.fn()

vi.mock('../../../src/services/repo', () => ({
  ensureMirrorTargetPath: (...args: unknown[]) => mockEnsureMirrorTargetPath(...args),
  createRepoRow: (...args: unknown[]) => mockCreateRepoRow(...args),
  isRepoInUse: (...args: unknown[]) => mockIsRepoInUse(...args),
}))

import { createInternalRepoMirrorRoutes } from '../../../src/routes/internal/repo-mirror'

describe('internal-repo-mirror routes', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    const tmpRootValue = join(tmpdir(), `mirror-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    setTmpRoot(tmpRootValue)
    mkdirSync(tmpRootValue, { recursive: true })
    app = new Hono()
    app.route('/api/internal/repos', createInternalRepoMirrorRoutes({} as any))
    mockGetActiveDirectories.mockReturnValue([])
    mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'test-repo', fullPath: join(getTmpRoot(), 'test-repo') })
    mockCreateRepoRow.mockImplementation((_db: any, input: any) => ({ repo: { id: 1, fullPath: input.fullPath, localPath: input.localPath }, created: true }))
    mockIsRepoInUse.mockReturnValue(false)
    mockGetRepoById.mockReturnValue(null)
  })

  afterEach(() => {
    rmSync(getTmpRoot(), { recursive: true, force: true })
  })

  describe('GET /:repoId/mirror', () => {
    it('returns a streamable tarball containing repo files', async () => {
      const repoDir = join(getTmpRoot(), 'test-repo')
      mkdirSync(repoDir, { recursive: true })
      writeFileSync(join(repoDir, 'test.txt'), 'hello world')

      mockGetRepoById.mockReturnValue({ id: 1, fullPath: repoDir })

      const res = await app.request('/api/internal/repos/1/mirror')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/x-tar')

      const body = Buffer.from(await res.arrayBuffer())
      expect(body.length).toBeGreaterThan(0)

      const extractDir = join(getTmpRoot(), 'extract')
      mkdirSync(extractDir, { recursive: true })
      const tarFile = join(getTmpRoot(), 'test.tar')
      writeFileSync(tarFile, body)

      spawnSync('tar', ['-x', '-C', extractDir, '-f', tarFile], { stdio: 'inherit' })

      expect(existsSync(join(extractDir, 'test.txt'))).toBe(true)
      expect(readFileSync(join(extractDir, 'test.txt'), 'utf-8')).toBe('hello world')
    })

    it('returns 404 for non-existent repo', async () => {
      mockGetRepoById.mockReturnValue(null)

      const res = await app.request('/api/internal/repos/99999/mirror')
      expect(res.status).toBe(404)
    })

    it('returns 400 for invalid repoId', async () => {
      const res = await app.request('/api/internal/repos/abc/mirror')
      expect(res.status).toBe(400)
    })
  })

  describe('POST /:repoId/mirror', () => {
    it('creates a repo with create=1 and populates from tarball', async () => {
      const targetPath = join(getTmpRoot(), 'test-repo')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'test-repo', fullPath: targetPath })
      mockCreateRepoRow.mockImplementation((_db: any, input: any) => ({ repo: { id: 1, fullPath: input.fullPath, localPath: input.localPath }, created: true }))

      const sourceDir = join(getTmpRoot(), 'source')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(sourceDir, 'payload.txt'), 'payload data')

      const result = spawnSync('tar', ['-c', '-C', sourceDir, '.'], { encoding: 'buffer' })
      const tarball = result.stdout as Buffer

      const res = await app.request('/api/internal/repos/0/mirror?create=1&name=test-repo', {
        method: 'POST',
        body: tarball,
        headers: { 'content-type': 'application/x-tar' },
      })

      expect(res.status).toBe(200)
      const json = (await res.json()) as { created: boolean; repoId: number; fullPath: string }
      expect(json.created).toBe(true)
      expect(json.repoId).toBe(1)
      expect(json.fullPath).toBe(targetPath)

      expect(existsSync(join(json.fullPath, 'payload.txt'))).toBe(true)
      expect(readFileSync(join(json.fullPath, 'payload.txt'), 'utf-8')).toBe('payload data')

      expect(mockCreateRepoRow).toHaveBeenCalled()
    })

    it('returns 409 when repo is in use and force not set', async () => {
      const repoDir = join(getTmpRoot(), 'test-repo')
      mkdirSync(repoDir, { recursive: true })
      writeFileSync(join(repoDir, 'existing.txt'), 'existing')

      mockGetRepoById.mockReturnValue({ id: 1, fullPath: repoDir })
      mockIsRepoInUse.mockReturnValue(true)

      const sourceDir = join(getTmpRoot(), 'source')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(sourceDir, 'payload.txt'), 'payload data')
      const result = spawnSync('tar', ['-c', '-C', sourceDir, '.'], { encoding: 'buffer' })
      const tarball = result.stdout as Buffer

      const res = await app.request('/api/internal/repos/1/mirror', {
        method: 'POST',
        body: tarball,
        headers: { 'content-type': 'application/x-tar' },
      })

      expect(res.status).toBe(409)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('repo_in_use')
    })

    it('returns 400 when create=1 but name missing', async () => {
      const res = await app.request('/api/internal/repos/0/mirror?create=1', {
        method: 'POST',
        body: Buffer.alloc(0),
        headers: { 'content-type': 'application/x-tar' },
      })

      expect(res.status).toBe(400)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('name required')
    })

    it('returns 400 with no body and does not create DB row', async () => {
      const res = await app.request('/api/internal/repos/0/mirror?create=1&name=foo', {
        method: 'POST',
        headers: { 'content-type': 'application/x-tar' },
      })

      expect(res.status).toBe(400)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('no body provided')
      expect(mockCreateRepoRow).not.toHaveBeenCalled()
    })

    it('returns 404 for non-existent repo without create', async () => {
      mockGetRepoById.mockReturnValue(null)

      const sourceDir = join(getTmpRoot(), 'source')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(sourceDir, 'payload.txt'), 'payload data')
      const result = spawnSync('tar', ['-c', '-C', sourceDir, '.'], { encoding: 'buffer' })
      const tarball = result.stdout as Buffer

      const res = await app.request('/api/internal/repos/99999/mirror', {
        method: 'POST',
        body: tarball,
        headers: { 'content-type': 'application/x-tar' },
      })

      expect(res.status).toBe(404)
    })

    it('rolls back created DB row when tarball extraction fails', async () => {
      const targetPath = join(getTmpRoot(), 'test-repo')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'test-repo', fullPath: targetPath })
      mockCreateRepoRow.mockImplementation((_db: any, input: any) => ({ repo: { id: 1, fullPath: input.fullPath, localPath: input.localPath }, created: true }))
      mockDeleteRepo.mockReturnValue(undefined)

      const res = await app.request('/api/internal/repos/0/mirror?create=1&name=test-repo', {
        method: 'POST',
        body: Buffer.from('not a tarball'),
        headers: { 'content-type': 'application/x-tar' },
      })

      expect(res.status).toBe(500)
      expect(mockDeleteRepo).toHaveBeenCalledWith({}, 1)
    })

    it('returns 500 without hanging on very small invalid body (tar exit race)', async () => {
      const targetPath = join(getTmpRoot(), 'test-repo-race')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'test-repo-race', fullPath: targetPath })
      mockCreateRepoRow.mockImplementation((_db: any, input: any) => ({ repo: { id: 1, fullPath: input.fullPath, localPath: input.localPath }, created: true }))
      mockDeleteRepo.mockReturnValue(undefined)

      const res = await app.request('/api/internal/repos/0/mirror?create=1&name=test-repo-race', {
        method: 'POST',
        body: Buffer.from([0x00]),
        headers: { 'content-type': 'application/x-tar' },
      })

      expect(res.status).toBe(500)
      expect(mockDeleteRepo).toHaveBeenCalledWith({}, 1)
    })

    it('handles gzip-compressed tarball with Content-Encoding: gzip', async () => {
      const targetPath = join(getTmpRoot(), 'test-repo-gzip')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'test-repo-gzip', fullPath: targetPath })
      mockCreateRepoRow.mockImplementation((_db: any, input: any) => ({ repo: { id: 1, fullPath: input.fullPath, localPath: input.localPath }, created: true }))

      const sourceDir = join(getTmpRoot(), 'source-gzip')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(sourceDir, 'gzip.txt'), 'gzip payload')

      const result = spawnSync('tar', ['-c', '-C', sourceDir, '.'], { encoding: 'buffer' })
      const tarball = result.stdout as Buffer
      const gzipped = gzipSync(tarball)

      const res = await app.request('/api/internal/repos/0/mirror?create=1&name=test-repo-gzip', {
        method: 'POST',
        body: gzipped,
        headers: {
          'content-type': 'application/x-tar',
          'Content-Encoding': 'gzip',
        },
      })

      expect(res.status).toBe(200)
      const json = (await res.json()) as { created: boolean; repoId: number; fullPath: string }
      expect(json.created).toBe(true)
      expect(json.repoId).toBe(1)
      expect(json.fullPath).toBe(targetPath)

      expect(existsSync(join(json.fullPath, 'gzip.txt'))).toBe(true)
      expect(readFileSync(join(json.fullPath, 'gzip.txt'), 'utf-8')).toBe('gzip payload')
    })

    it('returns 409 when create-on-push finds existing repo in use and force not set', async () => {
      const existingRepoPath = join(getTmpRoot(), 'existing-repo')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'existing-repo', fullPath: existingRepoPath })
      mockCreateRepoRow.mockImplementation(() => ({
        repo: { id: 5, fullPath: existingRepoPath, localPath: 'existing-repo' },
        created: false,
      }))
      mockIsRepoInUse.mockReturnValue(true)

      const sourceDir = join(getTmpRoot(), 'source-inuse')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(sourceDir, 'file.txt'), 'should not land')
      const result = spawnSync('tar', ['-c', '-C', sourceDir, '.'], { encoding: 'buffer' })
      const tarball = result.stdout as Buffer

      const res = await app.request('/api/internal/repos/0/mirror?create=1&name=existing-repo', {
        method: 'POST',
        body: tarball,
        headers: { 'content-type': 'application/x-tar' },
      })

      expect(res.status).toBe(409)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('repo_in_use')
    })

    it('allows create-on-push of existing repo when force=1 even if in use', async () => {
      const existingRepoPath = join(getTmpRoot(), 'existing-repo-force')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'existing-repo-force', fullPath: existingRepoPath })
      mockCreateRepoRow.mockImplementation(() => ({
        repo: { id: 7, fullPath: existingRepoPath, localPath: 'existing-repo-force' },
        created: false,
      }))
      mockIsRepoInUse.mockReturnValue(true)

      const sourceDir = join(getTmpRoot(), 'source-force')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(sourceDir, 'forced.txt'), 'forced content')
      const result = spawnSync('tar', ['-c', '-C', sourceDir, '.'], { encoding: 'buffer' })
      const tarball = result.stdout as Buffer

      const res = await app.request('/api/internal/repos/0/mirror?create=1&name=existing-repo-force&force=1', {
        method: 'POST',
        body: tarball,
        headers: { 'content-type': 'application/x-tar' },
      })

      expect(res.status).toBe(200)
      const json = (await res.json()) as { created: boolean; repoId: number; fullPath: string }
      expect(json.created).toBe(false)
      expect(json.repoId).toBe(7)
      expect(existsSync(join(json.fullPath, 'forced.txt'))).toBe(true)
    })

    it('uses existing repo fullPath when createRepoRow finds matching origin/branch', async () => {
      const existingRepoPath = join(getTmpRoot(), 'existing-repo')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'new-name', fullPath: join(getTmpRoot(), 'new-name') })
      mockCreateRepoRow.mockImplementation(() => ({
        repo: { id: 5, fullPath: existingRepoPath, localPath: 'existing-repo' },
        created: false,
      }))

      const sourceDir = join(getTmpRoot(), 'source-existing')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(sourceDir, 'file.txt'), 'existing content')

      const result = spawnSync('tar', ['-c', '-C', sourceDir, '.'], { encoding: 'buffer' })
      const tarball = result.stdout as Buffer

      const res = await app.request('/api/internal/repos/0/mirror?create=1&name=new-name', {
        method: 'POST',
        body: tarball,
        headers: { 'content-type': 'application/x-tar' },
      })

      expect(res.status).toBe(200)
      const json = (await res.json()) as { created: boolean; repoId: number; fullPath: string }
      expect(json.created).toBe(false)
      expect(json.repoId).toBe(5)
      expect(json.fullPath).toBe(existingRepoPath)

      expect(existsSync(join(json.fullPath, 'file.txt'))).toBe(true)
      expect(readFileSync(join(json.fullPath, 'file.txt'), 'utf-8')).toBe('existing content')
    })

    it('does not delete existing repo on failure when createRepoRow returns non-created repo', async () => {
      const existingRepoPath = join(getTmpRoot(), 'existing-repo-fail')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'new-name', fullPath: join(getTmpRoot(), 'new-name') })
      mockCreateRepoRow.mockImplementation(() => ({
        repo: { id: 5, fullPath: existingRepoPath, localPath: 'existing-repo' },
        created: false,
      }))
      mockDeleteRepo.mockReturnValue(undefined)

      const res = await app.request('/api/internal/repos/0/mirror?create=1&name=new-name', {
        method: 'POST',
        body: Buffer.from('not a tarball'),
        headers: { 'content-type': 'application/x-tar' },
      })

      expect(res.status).toBe(500)
      expect(mockDeleteRepo).not.toHaveBeenCalled()
    })
  })
})
