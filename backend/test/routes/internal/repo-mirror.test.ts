import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { spawnSync } from 'child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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

const CHUNK_SIZE = 8 * 1024 * 1024

interface BeginResponse {
  uploadId: string
  repoId: number
  chunkSize: number
  created: boolean
}

interface CommitResponse {
  repoId: number
  fullPath: string
  branch: string | null
  head: string | null
  created: boolean
}

async function begin(app: Hono, urlRepoId: number, body: Record<string, unknown>): Promise<Response> {
  return app.request(`/api/internal/repos/${urlRepoId}/mirror/begin`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

async function putPart(app: Hono, urlRepoId: number, uploadId: string, index: number, chunk: Buffer): Promise<Response> {
  return app.request(`/api/internal/repos/${urlRepoId}/mirror/parts/${uploadId}/${index}`, {
    method: 'PUT',
    body: chunk,
    headers: { 'content-type': 'application/octet-stream' },
  })
}

async function commit(app: Hono, urlRepoId: number, uploadId: string, totalParts: number, gzip = false): Promise<Response> {
  return app.request(`/api/internal/repos/${urlRepoId}/mirror/commit`, {
    method: 'POST',
    body: JSON.stringify({ uploadId, totalParts, gzip }),
    headers: { 'content-type': 'application/json' },
  })
}

async function pushTarball(
  app: Hono,
  urlRepoId: number,
  body: Record<string, unknown>,
  tarball: Buffer,
): Promise<{ beginRes: Response; commitRes: Response | null }> {
  const beginRes = await begin(app, urlRepoId, body)
  if (beginRes.status !== 200) return { beginRes, commitRes: null }
  const beginJson = (await beginRes.clone().json()) as BeginResponse
  const { uploadId, repoId } = beginJson
  let index = 0
  for (let offset = 0; offset < tarball.length; offset += CHUNK_SIZE) {
    const chunk = tarball.subarray(offset, Math.min(offset + CHUNK_SIZE, tarball.length))
    const putRes = await putPart(app, repoId, uploadId, index, Buffer.from(chunk))
    if (putRes.status !== 200) {
      return { beginRes, commitRes: putRes }
    }
    index += 1
  }
  if (tarball.length === 0) {
    const putRes = await putPart(app, repoId, uploadId, 0, Buffer.alloc(0))
    if (putRes.status !== 200) {
      return { beginRes, commitRes: putRes }
    }
    index = 1
  }
  const commitRes = await commit(app, repoId, uploadId, index)
  return { beginRes, commitRes }
}

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

    it('returns gzip-compressed stream when ?compress=gzip', async () => {
      const repoDir = join(getTmpRoot(), 'test-repo')
      mkdirSync(repoDir, { recursive: true })
      writeFileSync(join(repoDir, 'test.txt'), 'hello world')

      mockGetRepoById.mockReturnValue({ id: 1, fullPath: repoDir })

      const res = await app.request('/api/internal/repos/1/mirror?compress=gzip')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/gzip')
      expect(res.headers.get('content-encoding')).toBeNull()

      const body = Buffer.from(await res.arrayBuffer())
      expect(body.length).toBeGreaterThan(0)

      // Verify the body is gzip-compressed (starts with gzip magic bytes)
      expect(body[0]).toBe(0x1f)
      expect(body[1]).toBe(0x8b)

      // Verify it extracts correctly via tar -xz
      const extractDir = join(getTmpRoot(), 'extract-compressed')
      mkdirSync(extractDir, { recursive: true })
      const tarFile = join(getTmpRoot(), 'test.tar.gz')
      writeFileSync(tarFile, body)
      spawnSync('tar', ['-xz', '-C', extractDir, '-f', tarFile], { stdio: 'inherit' })
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

  describe('legacy POST /:repoId/mirror', () => {
    it('returns 410 with cli_too_old code so old CLIs get a clear error', async () => {
      const res = await app.request('/api/internal/repos/1/mirror', {
        method: 'POST',
        body: Buffer.from('legacy tarball'),
        headers: { 'content-type': 'application/x-tar' },
      })
      expect(res.status).toBe(410)
      const json = (await res.json()) as { error: string; message: string }
      expect(json.error).toBe('cli_too_old')
      expect(json.message).toMatch(/upgrade to ocm-cli/i)
    })
  })

  describe('chunked upload flow (begin/parts/commit)', () => {
    it('creates a repo and populates from chunked tarball', async () => {
      const targetPath = join(getTmpRoot(), 'test-repo')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'test-repo', fullPath: targetPath })
      mockCreateRepoRow.mockImplementation((_db: any, input: any) => ({ repo: { id: 1, fullPath: input.fullPath, localPath: input.localPath }, created: true }))

      const sourceDir = join(getTmpRoot(), 'source')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(sourceDir, 'payload.txt'), 'payload data')

      const result = spawnSync('tar', ['-c', '-C', sourceDir, '.'], { encoding: 'buffer' })
      const tarball = result.stdout as Buffer

      const { beginRes, commitRes } = await pushTarball(app, 0, { create: true, name: 'test-repo' }, tarball)

      expect(beginRes.status).toBe(200)
      expect(commitRes?.status).toBe(200)
      const json = (await commitRes!.json()) as CommitResponse
      expect(json.created).toBe(true)
      expect(json.repoId).toBe(1)
      expect(json.fullPath).toBe(targetPath)

      expect(existsSync(join(json.fullPath, 'payload.txt'))).toBe(true)
      expect(readFileSync(join(json.fullPath, 'payload.txt'), 'utf-8')).toBe('payload data')

      expect(mockCreateRepoRow).toHaveBeenCalled()
    })

    it('splits a tarball across multiple PUTs of a fixed test chunk size', async () => {
      const targetPath = join(getTmpRoot(), 'test-repo')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'test-repo', fullPath: targetPath })
      mockCreateRepoRow.mockImplementation((_db: any, input: any) => ({ repo: { id: 1, fullPath: input.fullPath, localPath: input.localPath }, created: true }))

      const sourceDir = join(getTmpRoot(), 'source-multi')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(sourceDir, 'a.bin'), Buffer.alloc(64 * 1024, 0xab))
      writeFileSync(join(sourceDir, 'b.bin'), Buffer.alloc(64 * 1024, 0xcd))

      const tarFile = join(getTmpRoot(), 'multi.tar')
      spawnSync('tar', ['-c', '-C', sourceDir, '-f', tarFile, '.'], { stdio: 'ignore' })
      const tarball = readFileSync(tarFile)
      const testChunkSize = 16 * 1024
      expect(tarball.length).toBeGreaterThan(testChunkSize * 3)

      const beginRes = await begin(app, 0, { create: true, name: 'test-repo' })
      expect(beginRes.status).toBe(200)
      const beginJson = (await beginRes.json()) as BeginResponse

      let index = 0
      for (let offset = 0; offset < tarball.length; offset += testChunkSize) {
        const chunk = Buffer.from(tarball.subarray(offset, Math.min(offset + testChunkSize, tarball.length)))
        const putRes = await putPart(app, beginJson.repoId, beginJson.uploadId, index, chunk)
        expect(putRes.status).toBe(200)
        index += 1
      }
      expect(index).toBeGreaterThanOrEqual(3)

      const commitRes = await commit(app, beginJson.repoId, beginJson.uploadId, index)
      expect(commitRes.status).toBe(200)
      expect(existsSync(join(targetPath, 'a.bin'))).toBe(true)
      expect(existsSync(join(targetPath, 'b.bin'))).toBe(true)
    })

    it('creates the mirror target parent before final rename', async () => {
      const targetPath = join(getTmpRoot(), 'nested', 'test-repo')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'nested/test-repo', fullPath: targetPath })
      mockCreateRepoRow.mockImplementation((_db: any, input: any) => ({ repo: { id: 1, fullPath: input.fullPath, localPath: input.localPath }, created: true }))

      const sourceDir = join(getTmpRoot(), 'source-nested')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(sourceDir, 'payload.txt'), 'payload data')

      const result = spawnSync('tar', ['-c', '-C', sourceDir, '.'], { encoding: 'buffer' })
      const tarball = result.stdout as Buffer

      const { commitRes } = await pushTarball(app, 0, { create: true, name: 'test-repo' }, tarball)
      expect(commitRes?.status).toBe(200)
      const json = (await commitRes!.json()) as CommitResponse
      expect(json.fullPath).toBe(targetPath)
      expect(existsSync(join(targetPath, 'payload.txt'))).toBe(true)
    })

    it('preserves gitignored local files on the receiving repo across commit', async () => {
      const repoDir = join(getTmpRoot(), 'test-repo')
      mkdirSync(repoDir, { recursive: true })
      spawnSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, stdio: 'ignore' })
      writeFileSync(join(repoDir, '.gitignore'), 'data/\n')
      writeFileSync(join(repoDir, 'tracked.txt'), 'old tracked')
      mkdirSync(join(repoDir, 'data'))
      writeFileSync(join(repoDir, 'data', 'local.db'), 'local-only')
      spawnSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: repoDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'init'], { cwd: repoDir, stdio: 'ignore' })

      mockGetRepoById.mockReturnValue({ id: 1, fullPath: repoDir })

      const sourceDir = join(getTmpRoot(), 'source-carry')
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(sourceDir, 'tracked.txt'), 'new tracked')
      writeFileSync(join(sourceDir, 'added.txt'), 'added')

      const result = spawnSync('tar', ['-c', '-C', sourceDir, '.'], { encoding: 'buffer' })
      const tarball = result.stdout as Buffer

      const { commitRes } = await pushTarball(app, 1, { force: true }, tarball)
      expect(commitRes?.status).toBe(200)

      expect(existsSync(join(repoDir, 'data', 'local.db'))).toBe(true)
      expect(readFileSync(join(repoDir, 'data', 'local.db'), 'utf-8')).toBe('local-only')
      expect(readFileSync(join(repoDir, 'tracked.txt'), 'utf-8')).toBe('new tracked')
      expect(existsSync(join(repoDir, 'added.txt'))).toBe(true)
    })

    it('returns 409 from begin when repo is in use and force not set', async () => {
      const repoDir = join(getTmpRoot(), 'test-repo')
      mkdirSync(repoDir, { recursive: true })
      writeFileSync(join(repoDir, 'existing.txt'), 'existing')

      mockGetRepoById.mockReturnValue({ id: 1, fullPath: repoDir })
      mockIsRepoInUse.mockReturnValue(true)

      const res = await begin(app, 1, {})
      expect(res.status).toBe(409)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('repo_in_use')
    })

    it('returns 400 when create=true but name missing', async () => {
      const res = await begin(app, 0, { create: true })
      expect(res.status).toBe(400)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('name required')
    })

    it('returns 404 from begin for non-existent repo without create', async () => {
      mockGetRepoById.mockReturnValue(null)
      const res = await begin(app, 99999, {})
      expect(res.status).toBe(404)
    })

    it('returns 404 from PUT for unknown uploadId', async () => {
      const res = await putPart(app, 1, 'no-such-upload', 0, Buffer.from('payload'))
      expect(res.status).toBe(404)
    })

    it('returns 404 from commit for unknown uploadId', async () => {
      const res = await commit(app, 1, 'no-such-upload', 1)
      expect(res.status).toBe(404)
    })

    it('rolls back created DB row when commit fails on invalid tarball', async () => {
      const targetPath = join(getTmpRoot(), 'test-repo')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'test-repo', fullPath: targetPath })
      mockCreateRepoRow.mockImplementation((_db: any, input: any) => ({ repo: { id: 1, fullPath: input.fullPath, localPath: input.localPath }, created: true }))
      mockDeleteRepo.mockReturnValue(undefined)

      const beginRes = await begin(app, 0, { create: true, name: 'test-repo' })
      expect(beginRes.status).toBe(200)
      const beginJson = (await beginRes.json()) as BeginResponse

      const putRes = await putPart(app, beginJson.repoId, beginJson.uploadId, 0, Buffer.from('not a tarball'))
      expect(putRes.status).toBe(200)

      const commitRes = await commit(app, beginJson.repoId, beginJson.uploadId, 1)
      expect(commitRes.status).toBe(500)
      expect(mockDeleteRepo).toHaveBeenCalledWith({}, 1)
    })

    it('does not delete existing repo on commit failure when createRepoRow returns non-created', async () => {
      const existingRepoPath = join(getTmpRoot(), 'existing-repo-fail')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'new-name', fullPath: join(getTmpRoot(), 'new-name') })
      mockCreateRepoRow.mockImplementation(() => ({
        repo: { id: 5, fullPath: existingRepoPath, localPath: 'existing-repo' },
        created: false,
      }))
      mockDeleteRepo.mockReturnValue(undefined)

      const beginRes = await begin(app, 0, { create: true, name: 'new-name' })
      expect(beginRes.status).toBe(200)
      const beginJson = (await beginRes.json()) as BeginResponse

      const putRes = await putPart(app, beginJson.repoId, beginJson.uploadId, 0, Buffer.from('not a tarball'))
      expect(putRes.status).toBe(200)

      const commitRes = await commit(app, beginJson.repoId, beginJson.uploadId, 1)
      expect(commitRes.status).toBe(500)
      expect(mockDeleteRepo).not.toHaveBeenCalled()
    })

    it('returns 409 when create-on-push finds existing repo in use and force not set', async () => {
      const existingRepoPath = join(getTmpRoot(), 'existing-repo')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'existing-repo', fullPath: existingRepoPath })
      mockCreateRepoRow.mockImplementation(() => ({
        repo: { id: 5, fullPath: existingRepoPath, localPath: 'existing-repo' },
        created: false,
      }))
      mockIsRepoInUse.mockReturnValue(true)

      const res = await begin(app, 0, { create: true, name: 'existing-repo' })
      expect(res.status).toBe(409)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('repo_in_use')
    })

    it('allows create-on-push of existing repo when force=true even if in use', async () => {
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

      const { commitRes } = await pushTarball(app, 0, { create: true, name: 'existing-repo-force', force: true }, tarball)
      expect(commitRes?.status).toBe(200)
      const json = (await commitRes!.json()) as CommitResponse
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

      const { commitRes } = await pushTarball(app, 0, { create: true, name: 'new-name' }, tarball)
      expect(commitRes?.status).toBe(200)
      const json = (await commitRes!.json()) as CommitResponse
      expect(json.created).toBe(false)
      expect(json.repoId).toBe(5)
      expect(json.fullPath).toBe(existingRepoPath)

      expect(existsSync(join(json.fullPath, 'file.txt'))).toBe(true)
      expect(readFileSync(join(json.fullPath, 'file.txt'), 'utf-8')).toBe('existing content')
    })

    it('DELETE removes the upload session and deletes the created repo', async () => {
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'abort-repo', fullPath: join(getTmpRoot(), 'abort-repo') })
      mockCreateRepoRow.mockImplementation((_db: any, input: any) => ({ repo: { id: 11, fullPath: input.fullPath, localPath: input.localPath }, created: true }))
      mockDeleteRepo.mockReturnValue(undefined)

      const beginRes = await begin(app, 0, { create: true, name: 'abort-repo' })
      expect(beginRes.status).toBe(200)
      const beginJson = (await beginRes.json()) as BeginResponse

      const delRes = await app.request(`/api/internal/repos/${beginJson.repoId}/mirror/uploads/${beginJson.uploadId}`, {
        method: 'DELETE',
      })
      expect(delRes.status).toBe(200)
      expect(mockDeleteRepo).toHaveBeenCalledWith({}, 11)

      const commitRes = await commit(app, beginJson.repoId, beginJson.uploadId, 0)
      expect(commitRes.status).toBe(404)
    })
  })
})
