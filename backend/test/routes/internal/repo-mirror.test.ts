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
const mockPlanMirrorTarget = vi.fn()
const mockEnsureMirrorTarget = vi.fn()

vi.mock('../../../src/services/repo', () => ({
  ensureMirrorTargetPath: (...args: unknown[]) => mockEnsureMirrorTargetPath(...args),
  createRepoRow: (...args: unknown[]) => mockCreateRepoRow(...args),
  isRepoInUse: (...args: unknown[]) => mockIsRepoInUse(...args),
  planMirrorTarget: (...args: unknown[]) => mockPlanMirrorTarget(...args),
  ensureMirrorTarget: (...args: unknown[]) => mockEnsureMirrorTarget(...args),
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

  describe('GET /:repoId/mirror/head', () => {
    it('returns head, branch and dirty state for the manager repo', async () => {
      mockGetRepoById.mockReturnValue({ id: 7, fullPath: join(getTmpRoot(), 'repo7') })
      mockSafeGitOut.mockImplementation((_path: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return Promise.resolve('feature\n')
        if (args[0] === 'rev-parse') return Promise.resolve('abc123\n')
        if (args[0] === 'status') return Promise.resolve(' M file.txt\n')
        return Promise.resolve(null)
      })

      const res = await app.request('/api/internal/repos/7/mirror/head')
      expect(res.status).toBe(200)
      const json = (await res.json()) as { head: string; branch: string; dirty: boolean }
      expect(json.head).toBe('abc123')
      expect(json.branch).toBe('feature')
      expect(json.dirty).toBe(true)
    })

    it('reports a clean repo as not dirty', async () => {
      mockGetRepoById.mockReturnValue({ id: 8, fullPath: join(getTmpRoot(), 'repo8') })
      mockSafeGitOut.mockImplementation((_path: string, args: string[]) => {
        if (args[0] === 'status') return Promise.resolve('')
        return Promise.resolve('abc123\n')
      })

      const res = await app.request('/api/internal/repos/8/mirror/head')
      const json = (await res.json()) as { dirty: boolean }
      expect(json.dirty).toBe(false)
    })

    it('returns 404 for a non-existent repo', async () => {
      mockGetRepoById.mockReturnValue(null)
      const res = await app.request('/api/internal/repos/99999/mirror/head')
      expect(res.status).toBe(404)
    })
  })

  describe('GET /:repoId/mirror/contains/:sha', () => {
    it('returns contained=true when local sha is an ancestor of server HEAD', async () => {
      mockGetRepoById.mockReturnValue({ id: 7, fullPath: join(getTmpRoot(), 'repo7') })
      mockSafeGitOut.mockResolvedValue('')

      const res = await app.request('/api/internal/repos/7/mirror/contains/abc1234')
      expect(res.status).toBe(200)
      const json = (await res.json()) as { contained: boolean }
      expect(json.contained).toBe(true)
    })

    it('returns contained=false when ancestry check fails (sha not in server history)', async () => {
      mockGetRepoById.mockReturnValue({ id: 7, fullPath: join(getTmpRoot(), 'repo7') })
      mockSafeGitOut.mockResolvedValue(null)

      const res = await app.request('/api/internal/repos/7/mirror/contains/abc1234')
      const json = (await res.json()) as { contained: boolean }
      expect(json.contained).toBe(false)
    })

    it('rejects a malformed sha with 400', async () => {
      mockGetRepoById.mockReturnValue({ id: 7, fullPath: join(getTmpRoot(), 'repo7') })
      const res = await app.request('/api/internal/repos/7/mirror/contains/not-a-sha')
      expect(res.status).toBe(400)
    })
  })

  describe('patch sync flow', () => {
    it('imports a git bundle into an existing manager repo', async () => {
      const sourceDir = join(getTmpRoot(), 'bundle-source')
      mkdirSync(sourceDir, { recursive: true })
      spawnSync('git', ['init', '-b', 'main'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: sourceDir, stdio: 'ignore' })
      writeFileSync(join(sourceDir, 'tracked.txt'), 'from bundle\n')
      spawnSync('git', ['add', 'tracked.txt'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'source'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['checkout', '-b', 'feature'], { cwd: sourceDir, stdio: 'ignore' })
      writeFileSync(join(sourceDir, 'feature.txt'), 'feature branch\n')
      spawnSync('git', ['add', 'feature.txt'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'feature'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['checkout', 'main'], { cwd: sourceDir, stdio: 'ignore' })
      const bundlePath = join(getTmpRoot(), 'source.bundle')
      spawnSync('git', ['bundle', 'create', bundlePath, '--all'], { cwd: sourceDir, stdio: 'ignore' })

      const targetDir = join(getTmpRoot(), 'bundle-target')
      mkdirSync(targetDir, { recursive: true })
      spawnSync('git', ['init', '-b', 'main'], { cwd: targetDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: targetDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: targetDir, stdio: 'ignore' })
      writeFileSync(join(targetDir, 'old.txt'), 'old\n')
      spawnSync('git', ['add', 'old.txt'], { cwd: targetDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'target'], { cwd: targetDir, stdio: 'ignore' })

      mockGetRepoById.mockReturnValue({ id: 1, fullPath: targetDir })
      mockSafeGitOut.mockImplementation(async (_repoPath: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc'
        return null
      })

      const res = await app.request('/api/internal/repos/1/mirror/bundle', {
        method: 'POST',
        body: readFileSync(bundlePath),
        headers: { 'content-type': 'application/octet-stream', 'x-ocm-branch': 'main' },
      })

      expect(res.status).toBe(200)
      expect(readFileSync(join(targetDir, 'tracked.txt'), 'utf-8')).toBe('from bundle\n')
      const featureRef = spawnSync('git', ['rev-parse', '--verify', 'refs/heads/feature'], { cwd: targetDir, encoding: 'utf-8' })
      expect(featureRef.status).toBe(0)
    })

    it('replaces a dirty manager working tree when importing a bundle', async () => {
      const sourceDir = join(getTmpRoot(), 'bundle-source-dirty')
      mkdirSync(sourceDir, { recursive: true })
      spawnSync('git', ['init', '-b', 'main'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: sourceDir, stdio: 'ignore' })
      writeFileSync(join(sourceDir, '.gitignore'), 'ignored.txt\n')
      writeFileSync(join(sourceDir, 'tracked.txt'), 'from bundle\n')
      spawnSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'source'], { cwd: sourceDir, stdio: 'ignore' })
      const bundlePath = join(getTmpRoot(), 'source-dirty.bundle')
      spawnSync('git', ['bundle', 'create', bundlePath, '--all'], { cwd: sourceDir, stdio: 'ignore' })

      const targetDir = join(getTmpRoot(), 'bundle-target-dirty')
      mkdirSync(targetDir, { recursive: true })
      spawnSync('git', ['init', '-b', 'main'], { cwd: targetDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: targetDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: targetDir, stdio: 'ignore' })
      writeFileSync(join(targetDir, '.gitignore'), 'ignored.txt\n')
      writeFileSync(join(targetDir, 'tracked.txt'), 'old\n')
      spawnSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: targetDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'target'], { cwd: targetDir, stdio: 'ignore' })
      writeFileSync(join(targetDir, 'tracked.txt'), 'server-side edit\n')
      writeFileSync(join(targetDir, 'stale-untracked.txt'), 'stale\n')
      writeFileSync(join(targetDir, 'ignored.txt'), 'keep me\n')

      mockGetRepoById.mockReturnValue({ id: 1, fullPath: targetDir })
      mockSafeGitOut.mockImplementation(async (_repoPath: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc'
        return null
      })

      const res = await app.request('/api/internal/repos/1/mirror/bundle?force=1', {
        method: 'POST',
        body: readFileSync(bundlePath),
        headers: { 'content-type': 'application/octet-stream', 'x-ocm-branch': 'main' },
      })

      expect(res.status).toBe(200)
      expect(readFileSync(join(targetDir, 'tracked.txt'), 'utf-8')).toBe('from bundle\n')
      expect(existsSync(join(targetDir, 'stale-untracked.txt'))).toBe(false)
      expect(existsSync(join(targetDir, 'ignored.txt'))).toBe(true)
      const status = spawnSync('git', ['status', '--porcelain'], { cwd: targetDir, encoding: 'utf-8' }).stdout
      expect(status.trim()).toBe('')
    })

    it('does not move branches checked out in other worktrees when importing into a worktree', async () => {
      const sourceDir = join(getTmpRoot(), 'bundle-source-wt')
      mkdirSync(sourceDir, { recursive: true })
      spawnSync('git', ['init', '-b', 'main'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: sourceDir, stdio: 'ignore' })
      writeFileSync(join(sourceDir, 'tracked.txt'), 'main from laptop\n')
      spawnSync('git', ['add', 'tracked.txt'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'laptop main'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['checkout', '-b', 'feature'], { cwd: sourceDir, stdio: 'ignore' })
      writeFileSync(join(sourceDir, 'feature.txt'), 'feature\n')
      spawnSync('git', ['add', 'feature.txt'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'feature'], { cwd: sourceDir, stdio: 'ignore' })
      const bundlePath = join(getTmpRoot(), 'source-wt.bundle')
      spawnSync('git', ['bundle', 'create', bundlePath, '--all'], { cwd: sourceDir, stdio: 'ignore' })

      const baseDir = join(getTmpRoot(), 'wt-base')
      mkdirSync(baseDir, { recursive: true })
      spawnSync('git', ['init', '-b', 'main'], { cwd: baseDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: baseDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: baseDir, stdio: 'ignore' })
      writeFileSync(join(baseDir, 'tracked.txt'), 'server main\n')
      spawnSync('git', ['add', 'tracked.txt'], { cwd: baseDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'server main'], { cwd: baseDir, stdio: 'ignore' })
      const serverMainHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: baseDir, encoding: 'utf-8' }).stdout.trim()
      const worktreeDir = join(getTmpRoot(), 'wt-base-feature')
      spawnSync('git', ['worktree', 'add', '-b', 'feature', worktreeDir], { cwd: baseDir, stdio: 'ignore' })

      mockGetRepoById.mockReturnValue({ id: 2, fullPath: worktreeDir })
      mockSafeGitOut.mockImplementation(async (_repoPath: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'feature'
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc'
        return null
      })

      const res = await app.request('/api/internal/repos/2/mirror/bundle?force=1', {
        method: 'POST',
        body: readFileSync(bundlePath),
        headers: { 'content-type': 'application/octet-stream', 'x-ocm-branch': 'feature' },
      })

      expect(res.status).toBe(200)
      expect(readFileSync(join(worktreeDir, 'feature.txt'), 'utf-8')).toBe('feature\n')
      expect(readFileSync(join(baseDir, 'tracked.txt'), 'utf-8')).toBe('server main\n')
      expect(spawnSync('git', ['rev-parse', 'refs/heads/main'], { cwd: baseDir, encoding: 'utf-8' }).stdout.trim()).toBe(serverMainHead)
      expect(spawnSync('git', ['status', '--porcelain'], { cwd: baseDir, encoding: 'utf-8' }).stdout.trim()).toBe('')
    })

    function gitCmd(cwd: string, args: string[], input?: string) {
      return spawnSync('git', args, { cwd, encoding: 'utf-8', input })
    }

    function initGitRepo(name: string): string {
      const dir = join(getTmpRoot(), name)
      mkdirSync(dir, { recursive: true })
      gitCmd(dir, ['init', '-b', 'main'], '')
      gitCmd(dir, ['config', 'user.email', 'test@test.com'])
      gitCmd(dir, ['config', 'user.name', 'Test'])
      return dir
    }

    function gitCommitFile(dir: string, file: string, content: string): string {
      writeFileSync(join(dir, file), content)
      gitCmd(dir, ['add', file])
      gitCmd(dir, ['commit', '-m', `add ${file}`])
      return gitCmd(dir, ['rev-parse', 'HEAD']).stdout.trim()
    }

    function makeBundle(dir: string, name: string): Buffer {
      const bundlePath = join(getTmpRoot(), `${name}.bundle`)
      gitCmd(dir, ['bundle', 'create', bundlePath, '--all'])
      return readFileSync(bundlePath)
    }

    async function postBundle(app: Hono, urlRepoId: number, bundle: Buffer, headers: Record<string, string>): Promise<Response> {
      return app.request(`/api/internal/repos/${urlRepoId}/mirror/bundle`, {
        method: 'POST',
        body: bundle,
        headers: { 'content-type': 'application/octet-stream', ...headers },
      })
    }

    const currentBranchOf = (dir: string): string => gitCmd(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
    const revRef = (dir: string, ref: string): string => gitCmd(dir, ['rev-parse', '--verify', ref], '').stdout.trim()
    const refExists = (dir: string, ref: string): boolean => gitCmd(dir, ['rev-parse', '--verify', '--quiet', ref], '').status === 0
    const syncRefCount = (dir: string): number =>
      gitCmd(dir, ['for-each-ref', '--format=%(refname)', 'refs/remotes/ocm-sync']).stdout.trim().split('\n').filter(Boolean).length

    it('rejects a strict bundle upload when the repo branch differs and preserves all local state', async () => {
      const sourceDir = initGitRepo('strict-mismatch-source')
      gitCommitFile(sourceDir, 'main.txt', 'source main\n')
      gitCmd(sourceDir, ['checkout', '-b', 'feature'])
      const incomingFeatureSha = gitCommitFile(sourceDir, 'feature.txt', 'source feature\n')
      gitCmd(sourceDir, ['checkout', 'main'])
      const incomingMainSha = gitCmd(sourceDir, ['rev-parse', 'HEAD']).stdout.trim()
      const bundle = makeBundle(sourceDir, 'strict-mismatch')

      const targetDir = initGitRepo('strict-mismatch-target')
      const targetMainSha = gitCommitFile(targetDir, 'main.txt', 'target main\n')
      writeFileSync(join(targetDir, 'untracked.txt'), 'keep me\n')
      mockGetRepoById.mockReturnValue({ id: 1, fullPath: targetDir })

      const res = await postBundle(app, 1, bundle, {
        'x-ocm-branch': 'feature',
        'x-ocm-require-current-branch': '1',
      })

      expect(res.status).toBe(409)
      const json = (await res.json()) as { error: string }
      expect(json.error).toContain('targets')
      expect(gitCmd(targetDir, ['symbolic-ref', '--quiet', '--short', 'HEAD']).stdout.trim()).toBe('main')
      expect(revRef(targetDir, 'refs/heads/main')).toBe(targetMainSha)
      expect(refExists(targetDir, 'refs/heads/feature')).toBe(false)
      expect(readFileSync(join(targetDir, 'main.txt'), 'utf-8')).toBe('target main\n')
      expect(readFileSync(join(targetDir, 'untracked.txt'), 'utf-8')).toBe('keep me\n')
      expect(syncRefCount(targetDir)).toBe(0)
      expect(incomingFeatureSha).not.toBe(targetMainSha)
      expect(incomingMainSha).not.toBe(targetMainSha)
      expect(mockUpdateLastPulled).not.toHaveBeenCalled()
    })

    it('rejects a bundle upload when the requested branch is missing and preserves all local state', async () => {
      const sourceDir = initGitRepo('missing-branch-source')
      gitCommitFile(sourceDir, 'main.txt', 'source main\n')
      const bundle = makeBundle(sourceDir, 'missing-branch')

      const targetDir = initGitRepo('missing-branch-target')
      const targetMainSha = gitCommitFile(targetDir, 'main.txt', 'target main\n')
      writeFileSync(join(targetDir, 'untracked.txt'), 'keep me\n')
      writeFileSync(join(targetDir, 'tracked-local.txt'), 'modified\n')
      gitCmd(targetDir, ['add', 'tracked-local.txt'])
      mockGetRepoById.mockReturnValue({ id: 1, fullPath: targetDir })

      const res = await postBundle(app, 1, bundle, { 'x-ocm-branch': 'ghost' })

      expect(res.status).toBe(409)
      const json = (await res.json()) as { error: string }
      expect(json.error).toContain("no branch 'ghost'")
      expect(gitCmd(targetDir, ['symbolic-ref', '--quiet', '--short', 'HEAD']).stdout.trim()).toBe('main')
      expect(revRef(targetDir, 'refs/heads/main')).toBe(targetMainSha)
      expect(readFileSync(join(targetDir, 'untracked.txt'), 'utf-8')).toBe('keep me\n')
      expect(gitCmd(targetDir, ['status', '--porcelain']).stdout).toContain('A  tracked-local.txt')
      expect(syncRefCount(targetDir)).toBe(0)
      expect(mockUpdateLastPulled).not.toHaveBeenCalled()
    })

    it('rejects a bundle upload targeting a branch locked by another worktree and preserves all local state', async () => {
      const sourceDir = initGitRepo('locked-target-source')
      gitCommitFile(sourceDir, 'main.txt', 'source main\n')
      gitCmd(sourceDir, ['checkout', '-b', 'shared'])
      const sourceSharedSha = gitCommitFile(sourceDir, 'shared.txt', 'source shared\n')
      gitCmd(sourceDir, ['checkout', 'main'])
      const bundle = makeBundle(sourceDir, 'locked-target')

      const baseDir = initGitRepo('locked-target-base')
      const baseMainSha = gitCommitFile(baseDir, 'main.txt', 'base main\n')
      const wt1Dir = join(getTmpRoot(), 'locked-target-wt1')
      gitCmd(baseDir, ['worktree', 'add', '-b', 'other', wt1Dir])
      const wt2Dir = join(getTmpRoot(), 'locked-target-wt2')
      gitCmd(baseDir, ['worktree', 'add', '-b', 'shared', wt2Dir])
      const wt2SharedSha = revRef(wt2Dir, 'refs/heads/shared')
      writeFileSync(join(wt1Dir, 'untracked.txt'), 'keep me\n')
      mockGetRepoById.mockReturnValue({ id: 2, fullPath: wt1Dir })

      const res = await postBundle(app, 2, bundle, { 'x-ocm-branch': 'shared' })

      expect(res.status).toBe(409)
      const json = (await res.json()) as { error: string }
      expect(json.error).toContain('checked out in another worktree')
      expect(currentBranchOf(wt1Dir)).toBe('other')
      expect(readFileSync(join(wt1Dir, 'untracked.txt'), 'utf-8')).toBe('keep me\n')
      expect(revRef(baseDir, 'refs/heads/main')).toBe(baseMainSha)
      expect(revRef(baseDir, 'refs/heads/shared')).toBe(wt2SharedSha)
      expect(gitCmd(wt2Dir, ['status', '--porcelain']).stdout.trim()).toBe('')
      expect(syncRefCount(wt1Dir)).toBe(0)
      expect(sourceSharedSha).not.toBe(wt2SharedSha)
      expect(mockUpdateLastPulled).not.toHaveBeenCalled()
    })

    it('switches to a new target branch from the incoming bundle on a normal non-strict push', async () => {
      const sourceDir = initGitRepo('cross-branch-source')
      gitCommitFile(sourceDir, 'main.txt', 'source main\n')
      gitCmd(sourceDir, ['checkout', '-b', 'topic'])
      const incomingTopicSha = gitCommitFile(sourceDir, 'topic.txt', 'source topic\n')
      gitCmd(sourceDir, ['checkout', 'main'])
      const incomingMainSha = gitCmd(sourceDir, ['rev-parse', 'HEAD']).stdout.trim()
      const bundle = makeBundle(sourceDir, 'cross-branch')

      const targetDir = initGitRepo('cross-branch-target')
      gitCommitFile(targetDir, 'main.txt', 'target main\n')
      writeFileSync(join(targetDir, 'stale-untracked.txt'), 'stale\n')
      mockGetRepoById.mockReturnValue({ id: 1, fullPath: targetDir })
      mockSafeGitOut.mockImplementation(async (_repoPath: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'topic'
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return incomingTopicSha
        return null
      })

      const res = await postBundle(app, 1, bundle, { 'x-ocm-branch': 'topic' })

      expect(res.status).toBe(200)
      expect(currentBranchOf(targetDir)).toBe('topic')
      expect(revRef(targetDir, 'HEAD')).toBe(incomingTopicSha)
      expect(revRef(targetDir, 'refs/heads/topic')).toBe(incomingTopicSha)
      expect(revRef(targetDir, 'refs/heads/main')).toBe(incomingMainSha)
      expect(readFileSync(join(targetDir, 'topic.txt'), 'utf-8')).toBe('source topic\n')
      expect(existsSync(join(targetDir, 'stale-untracked.txt'))).toBe(false)
      expect(syncRefCount(targetDir)).toBe(0)
      expect(mockUpdateRepoBranch).toHaveBeenCalledWith({}, 1, 'topic')
    })

    it('moves an existing local target branch to the incoming sha and resets it on a normal non-strict push', async () => {
      const sourceDir = initGitRepo('cross-branch-existing-source')
      gitCommitFile(sourceDir, 'main.txt', 'source main\n')
      gitCmd(sourceDir, ['checkout', '-b', 'topic'])
      const incomingTopicSha = gitCommitFile(sourceDir, 'topic.txt', 'source topic\n')
      gitCmd(sourceDir, ['checkout', 'main'])
      const incomingMainSha = gitCmd(sourceDir, ['rev-parse', 'HEAD']).stdout.trim()
      const bundle = makeBundle(sourceDir, 'cross-branch-existing')

      const targetDir = initGitRepo('cross-branch-existing-target')
      gitCommitFile(targetDir, 'main.txt', 'target main\n')
      gitCmd(targetDir, ['branch', 'topic'], '')
      const localTopicSha = revRef(targetDir, 'refs/heads/topic')
      mockGetRepoById.mockReturnValue({ id: 1, fullPath: targetDir })
      mockSafeGitOut.mockResolvedValue(null)

      const res = await postBundle(app, 1, bundle, { 'x-ocm-branch': 'topic' })

      expect(res.status).toBe(200)
      expect(currentBranchOf(targetDir)).toBe('topic')
      expect(revRef(targetDir, 'HEAD')).toBe(incomingTopicSha)
      expect(revRef(targetDir, 'refs/heads/topic')).toBe(incomingTopicSha)
      expect(localTopicSha).not.toBe(incomingTopicSha)
      expect(revRef(targetDir, 'refs/heads/main')).toBe(incomingMainSha)
      expect(readFileSync(join(targetDir, 'topic.txt'), 'utf-8')).toBe('source topic\n')
      expect(existsSync(join(targetDir, 'main.txt'))).toBe(true)
      expect(syncRefCount(targetDir)).toBe(0)
    })

    it('replaces dirty tracked and untracked state when switching branches on a forced normal push', async () => {
      const sourceDir = initGitRepo('forced-cross-source')
      gitCommitFile(sourceDir, 'main.txt', 'source main\n')
      gitCmd(sourceDir, ['checkout', '-b', 'topic'])
      const incomingTopicSha = gitCommitFile(sourceDir, 'topic.txt', 'source topic\n')
      gitCmd(sourceDir, ['checkout', 'main'])
      const incomingMainSha = gitCmd(sourceDir, ['rev-parse', 'HEAD']).stdout.trim()
      const bundle = makeBundle(sourceDir, 'forced-cross')

      const targetDir = initGitRepo('forced-cross-target')
      gitCommitFile(targetDir, 'main.txt', 'target main\n')
      writeFileSync(join(targetDir, 'main.txt'), 'dirty edit\n')
      writeFileSync(join(targetDir, 'stale-untracked.txt'), 'stale\n')
      mockGetRepoById.mockReturnValue({ id: 1, fullPath: targetDir })
      mockSafeGitOut.mockResolvedValue(null)

      const forcedRes = await app.request('/api/internal/repos/1/mirror/bundle?force=1', {
        method: 'POST',
        body: bundle,
        headers: { 'content-type': 'application/octet-stream', 'x-ocm-branch': 'topic' },
      })

      expect(forcedRes.status).toBe(200)
      expect(currentBranchOf(targetDir)).toBe('topic')
      expect(revRef(targetDir, 'HEAD')).toBe(incomingTopicSha)
      expect(revRef(targetDir, 'refs/heads/main')).toBe(incomingMainSha)
      expect(readFileSync(join(targetDir, 'topic.txt'), 'utf-8')).toBe('source topic\n')
      expect(readFileSync(join(targetDir, 'main.txt'), 'utf-8')).toBe('source main\n')
      expect(gitCmd(targetDir, ['status', '--porcelain']).stdout.trim()).toBe('')
      expect(existsSync(join(targetDir, 'stale-untracked.txt'))).toBe(false)
      expect(syncRefCount(targetDir)).toBe(0)
      expect(incomingTopicSha).not.toBe(incomingMainSha)
    })

    it('preserves dirty state and refs when a non-forced cross-branch import fails checkout', async () => {
      const sourceDir = initGitRepo('nonforce-cross-source')
      gitCommitFile(sourceDir, 'main.txt', 'source main\n')
      gitCmd(sourceDir, ['checkout', '-b', 'topic'])
      gitCommitFile(sourceDir, 'topic.txt', 'source topic\n')
      gitCmd(sourceDir, ['checkout', 'main'])
      const bundle = makeBundle(sourceDir, 'nonforce-cross')

      const targetDir = initGitRepo('nonforce-cross-target')
      const targetMainSha = gitCommitFile(targetDir, 'main.txt', 'target main\n')
      writeFileSync(join(targetDir, 'main.txt'), 'dirty edit\n')
      writeFileSync(join(targetDir, 'untracked.txt'), 'keep me\n')
      mockGetRepoById.mockReturnValue({ id: 1, fullPath: targetDir })
      mockSafeGitOut.mockResolvedValue(null)

      const res = await postBundle(app, 1, bundle, { 'x-ocm-branch': 'topic' })

      expect(res.status).toBe(409)
      expect(currentBranchOf(targetDir)).toBe('main')
      expect(readFileSync(join(targetDir, 'main.txt'), 'utf-8')).toBe('dirty edit\n')
      expect(readFileSync(join(targetDir, 'untracked.txt'), 'utf-8')).toBe('keep me\n')
      expect(revRef(targetDir, 'refs/heads/main')).toBe(targetMainSha)
      expect(refExists(targetDir, 'refs/heads/topic')).toBe(false)
      expect(syncRefCount(targetDir)).toBe(0)
      expect(mockUpdateLastPulled).not.toHaveBeenCalled()
    })

    it('accepts a strict bundle upload when the repo already sits on the requested branch', async () => {
      const sourceDir = initGitRepo('strict-same-source')
      gitCommitFile(sourceDir, 'main.txt', 'source main\n')
      const incomingMainSha = gitCmd(sourceDir, ['rev-parse', 'HEAD']).stdout.trim()
      const bundle = makeBundle(sourceDir, 'strict-same')

      const targetDir = initGitRepo('strict-same-target')
      gitCommitFile(targetDir, 'main.txt', 'target main\n')
      writeFileSync(join(targetDir, 'stale-untracked.txt'), 'stale\n')
      mockGetRepoById.mockReturnValue({ id: 1, fullPath: targetDir })
      mockSafeGitOut.mockResolvedValue(null)

      const res = await postBundle(app, 1, bundle, {
        'x-ocm-branch': 'main',
        'x-ocm-require-current-branch': '1',
      })

      expect(res.status).toBe(200)
      expect(currentBranchOf(targetDir)).toBe('main')
      expect(revRef(targetDir, 'HEAD')).toBe(incomingMainSha)
      expect(readFileSync(join(targetDir, 'main.txt'), 'utf-8')).toBe('source main\n')
      expect(existsSync(join(targetDir, 'stale-untracked.txt'))).toBe(false)
      expect(syncRefCount(targetDir)).toBe(0)
    })

    it('imports a bundle whose ocm-sync refs include a symbolic HEAD without failing', async () => {
      const sourceDir = join(getTmpRoot(), 'bundle-source-head')
      mkdirSync(sourceDir, { recursive: true })
      spawnSync('git', ['init', '-b', 'main'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: sourceDir, stdio: 'ignore' })
      writeFileSync(join(sourceDir, 'tracked.txt'), 'from bundle\n')
      spawnSync('git', ['add', 'tracked.txt'], { cwd: sourceDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'source'], { cwd: sourceDir, stdio: 'ignore' })
      const headSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: sourceDir, encoding: 'utf-8' }).stdout.trim()
      spawnSync('git', ['checkout', headSha], { cwd: sourceDir, stdio: 'ignore' })
      const bundlePath = join(getTmpRoot(), 'source-head.bundle')
      spawnSync('git', ['bundle', 'create', bundlePath, '--all'], { cwd: sourceDir, stdio: 'ignore' })

      const targetDir = join(getTmpRoot(), 'bundle-target-head')
      mkdirSync(targetDir, { recursive: true })
      spawnSync('git', ['init', '-b', 'main'], { cwd: targetDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: targetDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: targetDir, stdio: 'ignore' })
      writeFileSync(join(targetDir, 'old.txt'), 'old\n')
      spawnSync('git', ['add', 'old.txt'], { cwd: targetDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'target'], { cwd: targetDir, stdio: 'ignore' })

      mockGetRepoById.mockReturnValue({ id: 1, fullPath: targetDir })
      mockSafeGitOut.mockImplementation(async (_repoPath: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return headSha
        return null
      })

      const res = await app.request('/api/internal/repos/1/mirror/bundle', {
        method: 'POST',
        body: readFileSync(bundlePath),
        headers: { 'content-type': 'application/octet-stream' },
      })

      expect(res.status).toBe(200)
      const headRef = spawnSync('git', ['rev-parse', '--verify', 'refs/heads/HEAD'], { cwd: targetDir, encoding: 'utf-8' })
      expect(headRef.status).not.toBe(0)
    })

    it('returns a git bundle for pull fast path', async () => {
      const repoDir = join(getTmpRoot(), 'bundle-download')
      mkdirSync(repoDir, { recursive: true })
      spawnSync('git', ['init', '-b', 'main'], { cwd: repoDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, stdio: 'ignore' })
      writeFileSync(join(repoDir, 'tracked.txt'), 'bundle payload\n')
      spawnSync('git', ['add', 'tracked.txt'], { cwd: repoDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'bundle'], { cwd: repoDir, stdio: 'ignore' })
      mockGetRepoById.mockReturnValue({ id: 1, fullPath: repoDir })

      const res = await app.request('/api/internal/repos/1/mirror/bundle')
      const body = Buffer.from(await res.arrayBuffer())

      expect(res.status).toBe(200)
      expect(body.length).toBeGreaterThan(0)
      const verifyPath = join(getTmpRoot(), 'download.bundle')
      writeFileSync(verifyPath, body)
      const verify = spawnSync('git', ['bundle', 'verify', verifyPath], { cwd: repoDir, encoding: 'utf-8' })
      expect(verify.status).toBe(0)
    })

    it('applies a patch to an existing manager repo', async () => {
      const repoDir = join(getTmpRoot(), 'patch-repo')
      mkdirSync(repoDir, { recursive: true })
      spawnSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, stdio: 'ignore' })
      writeFileSync(join(repoDir, 'tracked.txt'), 'before\n')
      spawnSync('git', ['add', 'tracked.txt'], { cwd: repoDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoDir, stdio: 'ignore' })
      const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf-8' }).stdout.trim()

      mockGetRepoById.mockReturnValue({ id: 1, fullPath: repoDir })
      mockSafeGitOut.mockImplementation(async (_repoPath: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return head
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
        return null
      })

      const patch = 'diff --git a/tracked.txt b/tracked.txt\nindex 6e58d95..7c6cae9 100644\n--- a/tracked.txt\n+++ b/tracked.txt\n@@ -1 +1 @@\n-before\n+after\n'
      const res = await app.request('/api/internal/repos/1/mirror/patch', {
        method: 'POST',
        body: JSON.stringify({ baseHead: head, patch }),
        headers: { 'content-type': 'application/json' },
      })

      expect(res.status).toBe(200)
      expect(readFileSync(join(repoDir, 'tracked.txt'), 'utf-8')).toBe('after\n')
      expect(mockUpdateLastPulled).toHaveBeenCalledWith(expect.anything(), 1)
    })

    it('returns a patch snapshot for pull fast path', async () => {
      const repoDir = join(getTmpRoot(), 'snapshot-repo')
      mkdirSync(repoDir, { recursive: true })
      spawnSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, stdio: 'ignore' })
      writeFileSync(join(repoDir, 'tracked.txt'), 'before\n')
      spawnSync('git', ['add', 'tracked.txt'], { cwd: repoDir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoDir, stdio: 'ignore' })
      writeFileSync(join(repoDir, 'tracked.txt'), 'after\n')

      mockGetRepoById.mockReturnValue({ id: 1, fullPath: repoDir })
      mockSafeGitOut.mockImplementation(async (_repoPath: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc'
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
        if (args[0] === 'rev-parse' && args[1] === '--git-path') return '.git/index'
        return null
      })

      const res = await app.request('/api/internal/repos/1/mirror/patch')
      const json = await res.json() as { patch: string; head: string; branch: string }

      expect(res.status).toBe(200)
      expect(json.head).toBe('abc')
      expect(json.branch).toBe('main')
      expect(json.patch).toContain('diff --git a/tracked.txt b/tracked.txt')
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

    it('rejects commit requests with zero uploaded parts', async () => {
      const targetPath = join(getTmpRoot(), 'empty-parts-repo')
      mockEnsureMirrorTargetPath.mockReturnValue({ localPath: 'empty-parts-repo', fullPath: targetPath })
      mockCreateRepoRow.mockImplementation((_db: any, input: any) => ({ repo: { id: 1, fullPath: input.fullPath, localPath: input.localPath }, created: true }))

      const beginRes = await begin(app, 0, { create: true, name: 'empty-parts-repo' })
      expect(beginRes.status).toBe(200)
      const beginJson = (await beginRes.json()) as BeginResponse

      const commitRes = await commit(app, beginJson.repoId, beginJson.uploadId, 0)
      expect(commitRes.status).toBe(400)
      const json = (await commitRes.json()) as { error: string }
      expect(json.error).toBe('totalParts must be a positive integer')
      expect(mockUpdateLastPulled).not.toHaveBeenCalled()
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

      const commitRes = await commit(app, beginJson.repoId, beginJson.uploadId, 1)
      expect(commitRes.status).toBe(404)
    })
  })

  describe('GET /:repoId/mirror/target', () => {
    let repo: { id: number; fullPath: string; localPath: string }

    beforeEach(() => {
      repo = { id: 1, fullPath: join(getTmpRoot(), 'test-repo'), localPath: 'test-repo' }
    })

    it('returns a new-worktree plan with repoId null when no worktree exists', async () => {
      mockGetRepoById.mockReturnValue(repo)
      mockPlanMirrorTarget.mockResolvedValue({ kind: 'new', localPath: 'test-repo-feature', fullPath: join(getTmpRoot(), 'test-repo-feature'), currentBranch: 'main' })

      const res = await app.request('/api/internal/repos/1/mirror/target?branch=feature')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        kind: 'new',
        repoId: null,
        fullPath: join(getTmpRoot(), 'test-repo-feature'),
        localPath: 'test-repo-feature',
        branch: 'feature',
        currentBranch: 'main',
      })
      expect(mockPlanMirrorTarget).toHaveBeenCalledWith({}, repo, 'feature')
    })

    it('returns an in-place plan with the repo id', async () => {
      mockGetRepoById.mockReturnValue(repo)
      mockPlanMirrorTarget.mockResolvedValue({ kind: 'in-place', repo, currentBranch: 'feature' })

      const res = await app.request('/api/internal/repos/1/mirror/target?branch=feature')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        kind: 'in-place',
        repoId: 1,
        fullPath: repo.fullPath,
        localPath: 'test-repo',
        branch: 'feature',
        currentBranch: 'feature',
      })
    })

    it('returns an existing-worktree plan with the worktree repo id', async () => {
      mockGetRepoById.mockReturnValue(repo)
      const worktreeRepo = { id: 5, fullPath: join(getTmpRoot(), 'test-repo-wt'), localPath: 'test-repo-wt' }
      mockPlanMirrorTarget.mockResolvedValue({ kind: 'existing', repo: worktreeRepo, currentBranch: 'main' })

      const res = await app.request('/api/internal/repos/1/mirror/target?branch=feature')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        kind: 'existing',
        repoId: 5,
        fullPath: worktreeRepo.fullPath,
        localPath: 'test-repo-wt',
        branch: 'feature',
        currentBranch: 'main',
      })
    })

    it('returns 400 for a missing branch without calling the plan service', async () => {
      const res = await app.request('/api/internal/repos/1/mirror/target')

      expect(res.status).toBe(400)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('branch required')
      expect(mockPlanMirrorTarget).not.toHaveBeenCalled()
      expect(mockGetRepoById).not.toHaveBeenCalled()
    })

    it('returns 400 for a whitespace-only branch without calling the plan service', async () => {
      const res = await app.request('/api/internal/repos/1/mirror/target?branch=%20%20%20')

      expect(res.status).toBe(400)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('branch required')
      expect(mockPlanMirrorTarget).not.toHaveBeenCalled()
    })

    it('trims the branch before calling the plan service', async () => {
      mockGetRepoById.mockReturnValue(repo)
      mockPlanMirrorTarget.mockResolvedValue({ kind: 'in-place', repo, currentBranch: 'feature' })

      await app.request('/api/internal/repos/1/mirror/target?branch=%20feature%20')

      expect(mockPlanMirrorTarget).toHaveBeenCalledWith({}, repo, 'feature')
    })

    it('returns 400 for an invalid repoId', async () => {
      const res = await app.request('/api/internal/repos/abc/mirror/target?branch=feature')

      expect(res.status).toBe(400)
      expect(mockPlanMirrorTarget).not.toHaveBeenCalled()
    })

    it('returns 404 for a non-existent repo', async () => {
      mockGetRepoById.mockReturnValue(null)

      const res = await app.request('/api/internal/repos/99999/mirror/target?branch=feature')

      expect(res.status).toBe(404)
      expect(mockPlanMirrorTarget).not.toHaveBeenCalled()
    })

    it('returns 500 when planning fails', async () => {
      mockGetRepoById.mockReturnValue(repo)
      mockPlanMirrorTarget.mockRejectedValue(new Error('worktree occupied'))

      const res = await app.request('/api/internal/repos/1/mirror/target?branch=feature')

      expect(res.status).toBe(500)
      const json = (await res.json()) as { error: string }
      expect(json.error).toContain('worktree occupied')
    })
  })

  describe('POST /:repoId/mirror/target', () => {
    let repo: { id: number; fullPath: string; localPath: string }

    beforeEach(() => {
      repo = { id: 1, fullPath: join(getTmpRoot(), 'test-repo'), localPath: 'test-repo' }
    })

    async function request(branchBody: unknown): Promise<Response> {
      const res = await app.request('/api/internal/repos/1/mirror/target', {
        method: 'POST',
        body: JSON.stringify(branchBody),
        headers: { 'content-type': 'application/json' },
      })
      return res
    }

    it('ensures the target and returns the target repo contract', async () => {
      mockGetRepoById.mockReturnValue(repo)
      const targetRepo = { id: 5, fullPath: join(getTmpRoot(), 'test-repo-wt'), localPath: 'test-repo-wt' }
      mockEnsureMirrorTarget.mockResolvedValue({ repo: targetRepo, created: true })

      const res = await request({ branch: 'feature' })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        repoId: 5,
        fullPath: targetRepo.fullPath,
        localPath: 'test-repo-wt',
        branch: 'feature',
        created: true,
      })
      expect(mockEnsureMirrorTarget).toHaveBeenCalledWith({}, repo, 'feature')
    })

    it('reports created=false when the target already exists', async () => {
      mockGetRepoById.mockReturnValue(repo)
      mockEnsureMirrorTarget.mockResolvedValue({ repo, created: false })

      const res = await request({ branch: 'feature' })

      expect(res.status).toBe(200)
      const json = (await res.json()) as { created: boolean; repoId: number }
      expect(json.created).toBe(false)
      expect(json.repoId).toBe(1)
    })

    it('returns 400 for malformed JSON body without calling services', async () => {
      const res = await app.request('/api/internal/repos/1/mirror/target', {
        method: 'POST',
        body: 'not json{',
        headers: { 'content-type': 'application/json' },
      })

      expect(res.status).toBe(400)
      expect(mockEnsureMirrorTarget).not.toHaveBeenCalled()
      expect(mockGetRepoById).not.toHaveBeenCalled()
    })

    it('returns 400 for a missing branch without calling services', async () => {
      const res = await request({})

      expect(res.status).toBe(400)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('branch required')
      expect(mockEnsureMirrorTarget).not.toHaveBeenCalled()
      expect(mockGetRepoById).not.toHaveBeenCalled()
    })

    it.each([
      ['null branch', null],
      ['numeric branch', 123],
      ['object branch', { branch: 'feature' }],
    ])('returns 400 for %s without calling services', async (_label, branchValue) => {
      const res = await request({ branch: branchValue })

      expect(res.status).toBe(400)
      expect(mockEnsureMirrorTarget).not.toHaveBeenCalled()
    })

    it('returns 400 for a whitespace-only branch without calling services', async () => {
      const res = await request({ branch: '   ' })

      expect(res.status).toBe(400)
      expect(mockEnsureMirrorTarget).not.toHaveBeenCalled()
    })

    it('trims the branch before calling the ensure service', async () => {
      mockGetRepoById.mockReturnValue(repo)
      mockEnsureMirrorTarget.mockResolvedValue({ repo, created: false })

      await request({ branch: '  feature  ' })

      expect(mockEnsureMirrorTarget).toHaveBeenCalledWith({}, repo, 'feature')
    })

    it('returns 400 for an invalid repoId', async () => {
      const res = await app.request('/api/internal/repos/abc/mirror/target', {
        method: 'POST',
        body: JSON.stringify({ branch: 'feature' }),
        headers: { 'content-type': 'application/json' },
      })

      expect(res.status).toBe(400)
      expect(mockEnsureMirrorTarget).not.toHaveBeenCalled()
    })

    it('returns 404 for a non-existent repo', async () => {
      mockGetRepoById.mockReturnValue(null)

      const res = await request({ branch: 'feature' })

      expect(res.status).toBe(404)
      expect(mockEnsureMirrorTarget).not.toHaveBeenCalled()
    })

    it('returns 409 when ensure fails', async () => {
      mockGetRepoById.mockReturnValue(repo)
      mockEnsureMirrorTarget.mockRejectedValue(new Error('git worktree add failed'))

      const res = await request({ branch: 'feature' })

      expect(res.status).toBe(409)
      const json = (await res.json()) as { error: string }
      expect(json.error).toContain('git worktree add failed')
    })
  })
})
