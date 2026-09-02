import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { spawnSync, execSync } from 'child_process'
import { prepareMirror, MirrorAbort, mirrorDown, mirrorDownFast, mirrorUp, mirrorUpPatch, mirrorUpFast, checkPushDivergence, checkPullDivergence, describePushDivergence, pickMatchedRepo, type MirrorUpFastPhase } from '../src/mirror'
import { getBranchName } from '../src/local-repo'
import { ManagerApi } from '../src/manager-api'
import { gitRemoteProjectId } from '@opencode-manager/shared/project-id'
import { mockStateModule, mockTokenStoreModule } from './helpers/token-store-mocks.js'

const ME_REPO_ID = gitRemoteProjectId('https://github.com/me/repo.git')!
const OTHER_REPO_ID = gitRemoteProjectId('https://github.com/other/repo.git')!

describe('prepareMirror', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mirror-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects when not in a git repo', async () => {
    const nonGitDir = join(tmpDir, 'non-git')
    mkdirSync(nonGitDir)

    await expect(prepareMirror(nonGitDir, [])).rejects.toThrow(MirrorAbort)
    await expect(prepareMirror(nonGitDir, [])).rejects.toThrow('not in a git repository')
  })

  it('rejects when no project id can be resolved', async () => {
    const gitDir = join(tmpDir, 'git-no-origin')
    mkdirSync(gitDir)
    spawnSync('git', ['init'], { cwd: gitDir, stdio: 'ignore' })

    await expect(prepareMirror(gitDir, [])).rejects.toThrow(MirrorAbort)
    await expect(prepareMirror(gitDir, [])).rejects.toThrow('could not resolve an OpenCode project id')
  })

  it('returns empty matched array when no remote matches', async () => {
    const gitDir = join(tmpDir, 'git-mismatch')
    mkdirSync(gitDir)
    spawnSync('git', ['init'], { cwd: gitDir, stdio: 'ignore' })
    spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/other/repo.git'], { cwd: gitDir, stdio: 'ignore' })

    const remotes = [
      { repoId: 1, name: 'my-repo', projectId: ME_REPO_ID, branch: 'main' },
    ]

    const plan = await prepareMirror(gitDir, remotes)
    expect(plan.matched).toHaveLength(0)
    expect(plan.localProjectId).toBe(OTHER_REPO_ID)
  })

  it('returns matching repos when the project id matches', async () => {
    const gitDir = join(tmpDir, 'git-match')
    mkdirSync(gitDir)
    spawnSync('git', ['init'], { cwd: gitDir, stdio: 'ignore' })
    spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/me/repo.git'], { cwd: gitDir, stdio: 'ignore' })

    const remotes = [
      { repoId: 1, name: 'my-repo', projectId: ME_REPO_ID, branch: 'main' },
      { repoId: 2, name: 'other-repo', projectId: OTHER_REPO_ID, branch: 'main' },
    ]

    const plan = await prepareMirror(gitDir, remotes)
    expect(plan.matched).toHaveLength(1)
    expect(plan.matched[0]!.repoId).toBe(1)
    expect(plan.localProjectId).toBe(ME_REPO_ID)
  })
})

describe('local repo branch detection', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'local-repo-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('treats detached HEAD as no branch', () => {
    const repoRoot = join(tmpDir, 'detached')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'tracked.txt'), 'content\n')
    spawnSync('git', ['add', 'tracked.txt'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoRoot, stdio: 'ignore' })
    const head = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim()
    spawnSync('git', ['checkout', head], { cwd: repoRoot, stdio: 'ignore' })

    expect(getBranchName(repoRoot)).toBeNull()
  })
})

describe('cmdPush', () => {
  let originalArgv: string[]
  let originalIsTTY: boolean | undefined

  beforeEach(() => {
    originalArgv = process.argv.slice()
    originalIsTTY = process.stdin.isTTY
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.argv = originalArgv
    if (originalIsTTY !== undefined) process.stdin.isTTY = originalIsTTY
  })

  it('errors with "stdin is not a TTY" when --create requested non-interactively and --yes omitted', async () => {
    process.stdin.isTTY = false
    process.argv = ['node', 'ocm', 'push', '--create']

    let stderrOutput = ''
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      stderrOutput += typeof msg === 'string' ? msg : new TextDecoder().decode(msg)
      return true
    })
    vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error(stderrOutput.trim())
    })

    mockStateModule({ managerUrl: 'http://localhost:5003' })
    mockTokenStoreModule({ token: 'test-token' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ workspaces: [] }),
    }))

    const { cmdPush } = await import('../bin/ocm')

    await expect(cmdPush(['--create'])).rejects.toThrow('stdin is not a TTY; pass --yes to confirm creation')
  })
})

describe('mirrorDown', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mirror-down-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function createGzipTarball(dir: string): Buffer {
    const tarFile = join(tmpDir, 'test.tar.gz')
    execSync(`tar -czf "${tarFile}" -C "${dir}" .`)
    return readFileSync(tarFile)
  }

  const streamOf = (buf: Buffer): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(buf))
        controller.close()
      },
    })

  it('stages tarball in sibling directory next to repoRoot', async () => {
    const repoRoot = join(tmpDir, 'repo')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })

    const contentDir = join(tmpDir, 'content')
    mkdirSync(contentDir)
    writeFileSync(join(contentDir, 'file.txt'), 'hello')

    const tarData = createGzipTarball(contentDir)

    const mockApi = {
      mirrorDown: vi.fn().mockResolvedValue(streamOf(tarData)),
    } as any

    await mirrorDown(1, repoRoot, mockApi, { force: true })

    expect(existsSync(join(repoRoot, 'file.txt'))).toBe(true)

    const entries = readdirSync(tmpDir).filter((e) => e.startsWith('repo.ocm-recv-'))
    expect(entries.length).toBe(0)
  })

  it('restores original repo when swap fails after creating backup', async () => {
    const repoRoot = join(tmpDir, 'repo-swap-fail')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'file.txt'), 'original content')

    const contentDir = join(tmpDir, 'content-fail')
    mkdirSync(contentDir)
    writeFileSync(join(contentDir, 'new-file.txt'), 'new content')

    const tarData = createGzipTarball(contentDir)

    const mockApi = {
      mirrorDown: vi.fn().mockResolvedValue(streamOf(tarData)),
    } as any

    try {
      await mirrorDown(1, repoRoot, mockApi, { force: true })
    } catch {
      const entries = readdirSync(tmpDir).filter((e) => e.startsWith('repo-swap-fail.ocm-backup-'))
      expect(entries.length).toBe(0)

      expect(existsSync(repoRoot)).toBe(true)
      expect(existsSync(join(repoRoot, 'file.txt'))).toBe(true)
    }

    const entriesAfterSuccess = readdirSync(tmpDir).filter((e) => e.startsWith('repo-swap-fail.ocm-backup-'))
    expect(entriesAfterSuccess.length).toBe(0)
  })

  it('throws MirrorAbort when working tree has uncommitted changes and force is false', async () => {
    const repoRoot = join(tmpDir, 'repo-dirty')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'dirty.txt'), 'dirty')
    spawnSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'dirty.txt'), 'dirty-modified')

    const mockApi = {
      mirrorDown: vi.fn(),
    } as any

    await expect(mirrorDown(1, repoRoot, mockApi, { force: false })).rejects.toThrow(MirrorAbort)
    await expect(mirrorDown(1, repoRoot, mockApi, { force: false })).rejects.toThrow('working tree has uncommitted changes; rerun with --force')
  })

  it('preserves directory inode so relative paths work after pull from inside repo', async () => {
    const repoRoot = join(tmpDir, 'repo-inode')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'original.txt'), 'original content')

    const contentDir = join(tmpDir, 'content-inode')
    mkdirSync(contentDir)
    writeFileSync(join(contentDir, 'new-file.txt'), 'new content')
    writeFileSync(join(contentDir, 'updated.txt'), 'updated content')

    const tarData = createGzipTarball(contentDir)

    const mockApi = {
      mirrorDown: vi.fn().mockResolvedValue(streamOf(tarData)),
    } as any

    const originalCwd = process.cwd()
    process.chdir(repoRoot)

    try {
      await mirrorDown(1, repoRoot, mockApi, { force: true })

      expect(existsSync(join(repoRoot, 'new-file.txt'))).toBe(true)
      expect(existsSync(join(repoRoot, 'updated.txt'))).toBe(true)
      expect(readFileSync(join(repoRoot, 'new-file.txt'), 'utf-8')).toBe('new content')
      expect(readFileSync(join(repoRoot, 'updated.txt'), 'utf-8')).toBe('updated content')

      expect(existsSync(join(repoRoot, 'original.txt'))).toBe(false)
    } finally {
      process.chdir(originalCwd)
    }
  })

  it('replaces contents while keeping directory inode intact', async () => {
    const repoRoot = join(tmpDir, 'repo-replace')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'old-file.txt'), 'old content')

    const contentDir = join(tmpDir, 'content-replace')
    mkdirSync(contentDir)
    writeFileSync(join(contentDir, 'new-file.txt'), 'new content')

    const tarData = createGzipTarball(contentDir)

    const mockApi = {
      mirrorDown: vi.fn().mockResolvedValue(streamOf(tarData)),
    } as any

    await mirrorDown(1, repoRoot, mockApi, { force: true })

    expect(existsSync(join(repoRoot, 'new-file.txt'))).toBe(true)
    expect(existsSync(join(repoRoot, 'old-file.txt'))).toBe(false)

    const entries = readdirSync(tmpDir).filter((e) => e.startsWith('repo-replace.ocm-backup-'))
    expect(entries.length).toBe(0)

    const stagingEntries = readdirSync(tmpDir).filter((e) => e.startsWith('repo-replace.ocm-recv-'))
    expect(stagingEntries.length).toBe(0)
  })

  it('preserves gitignored local files excluded from the tarball', async () => {
    const repoRoot = join(tmpDir, 'repo-carryover')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, '.gitignore'), 'data/\n.env\n')
    mkdirSync(join(repoRoot, 'data'))
    writeFileSync(join(repoRoot, 'data', 'local.db'), 'local-only')
    writeFileSync(join(repoRoot, '.env'), 'SECRET=1')
    writeFileSync(join(repoRoot, 'tracked.txt'), 'old tracked')
    spawnSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' })

    const contentDir = join(tmpDir, 'content-carryover')
    mkdirSync(contentDir)
    writeFileSync(join(contentDir, 'tracked.txt'), 'new tracked')
    writeFileSync(join(contentDir, 'added.txt'), 'added')

    const tarData = createGzipTarball(contentDir)

    const mockApi = {
      mirrorDown: vi.fn().mockResolvedValue(streamOf(tarData)),
    } as any

    await mirrorDown(1, repoRoot, mockApi, { force: true })

    expect(existsSync(join(repoRoot, 'data', 'local.db'))).toBe(true)
    expect(readFileSync(join(repoRoot, 'data', 'local.db'), 'utf-8')).toBe('local-only')
    expect(existsSync(join(repoRoot, '.env'))).toBe(true)
    expect(readFileSync(join(repoRoot, 'tracked.txt'), 'utf-8')).toBe('new tracked')
    expect(existsSync(join(repoRoot, 'added.txt'))).toBe(true)

    const backups = readdirSync(tmpDir).filter((e) => e.startsWith('repo-carryover.ocm-backup-'))
    expect(backups.length).toBe(0)
  })

  it('reports cumulative received bytes via onProgress callback', async () => {
    const repoRoot = join(tmpDir, 'repo-progress')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })

    const contentDir = join(tmpDir, 'content-progress')
    mkdirSync(contentDir)
    writeFileSync(join(contentDir, 'file.txt'), 'hello')

    const tarData = createGzipTarball(contentDir)

    const mockApi = {
      mirrorDown: vi.fn().mockResolvedValue(streamOf(tarData)),
    } as any

    const onProgress = vi.fn()

    await mirrorDown(1, repoRoot, mockApi, { force: true, onProgress })

    expect(onProgress).toHaveBeenCalled()
    const calls = onProgress.mock.calls.map((args: any[]) => args[0] as number)
    expect(calls[calls.length - 1]).toBe(tarData.length)

    let prev = -1
    for (const v of calls) {
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('extracts a gzipped tarball produced by tar -czf', async () => {
    const repoRoot = join(tmpDir, 'repo-gzip')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })

    const contentDir = join(tmpDir, 'content-gzip')
    mkdirSync(contentDir)
    writeFileSync(join(contentDir, 'file.txt'), 'hello from gzip')

    const tarData = createGzipTarball(contentDir)

    const mockApi = {
      mirrorDown: vi.fn().mockResolvedValue(streamOf(tarData)),
    } as any

    await mirrorDown(1, repoRoot, mockApi, { force: true })

    expect(existsSync(join(repoRoot, 'file.txt'))).toBe(true)
    expect(readFileSync(join(repoRoot, 'file.txt'), 'utf-8')).toBe('hello from gzip')

    const entries = readdirSync(tmpDir).filter((e) => e.startsWith('repo-gzip.ocm-recv-'))
    expect(entries.length).toBe(0)
  })
})

describe('mirrorUp chunked upload', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mirror-up-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeMockApi(opts: { partFailures?: Record<number, number>; chunkSize?: number } = {}) {
    const partsReceived: Buffer[] = []
    const partFailures: Record<number, number> = opts.partFailures ?? {}
    const chunkSize = opts.chunkSize ?? 8 * 1024 * 1024
    let committed = false
    let commitTotalParts = 0
    const api = {
      mirrorBegin: vi.fn().mockResolvedValue({ uploadId: 'upload-1', repoId: 1, chunkSize, created: false }),
      mirrorUploadPart: vi.fn().mockImplementation(async (_repoId: number, _uploadId: string, index: number, chunk: Buffer) => {
        if (partFailures[index] && partFailures[index] > 0) {
          partFailures[index] -= 1
          throw new Error(`simulated transient failure on part ${index}`)
        }
        partsReceived[index] = Buffer.from(chunk)
      }),
      mirrorCommit: vi.fn().mockImplementation(async (_repoId: number, _uploadId: string, totalParts: number, _gzip: boolean) => {
        committed = true
        commitTotalParts = totalParts
        return { repoId: 1, fullPath: '/tmp/x', branch: 'main', head: 'abc', created: false }
      }),
      mirrorAbort: vi.fn().mockResolvedValue(undefined),
    }
    return {
      api,
      partsReceived,
      get committed() { return committed },
      get commitTotalParts() { return commitTotalParts },
    }
  }

  it('uploads a small repo as a single part and commits', async () => {
    const repoRoot = join(tmpDir, 'repo-small')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'tracked.txt'), 'tracked content')

    const ctx = makeMockApi()
    const plan = {
      repoRoot,
      localProjectId: 'test-project',
      matched: [{ repoId: 1, name: 'test-repo', projectId: 'test-project', branch: 'main' }],
    }

    await mirrorUp(plan, { api: ctx.api as any, force: false })

    expect(ctx.api.mirrorBegin).toHaveBeenCalledTimes(1)
    expect(ctx.api.mirrorUploadPart).toHaveBeenCalled()
    expect(ctx.api.mirrorCommit).toHaveBeenCalledTimes(1)
    expect(ctx.committed).toBe(true)
    expect(ctx.commitTotalParts).toBeGreaterThan(0)
  })

  it('splits a tarball larger than chunkSize across multiple parts', async () => {
    const repoRoot = join(tmpDir, 'repo-multi')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'a.bin'), randomBytes(200 * 1024))
    writeFileSync(join(repoRoot, 'b.bin'), randomBytes(200 * 1024))

    const ctx = makeMockApi({ chunkSize: 128 * 1024 })
    const plan = {
      repoRoot,
      localProjectId: 'test-project',
      matched: [{ repoId: 1, name: 'test-repo', projectId: 'test-project', branch: 'main' }],
    }

    await mirrorUp(plan, { api: ctx.api as any, force: false })

    expect(ctx.api.mirrorUploadPart.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(ctx.commitTotalParts).toBe(ctx.api.mirrorUploadPart.mock.calls.length)
  })

  it('retries a failing part and still commits', async () => {
    const repoRoot = join(tmpDir, 'repo-retry')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'tracked.txt'), 'tracked content')

    const ctx = makeMockApi({ partFailures: { 0: 2 }, chunkSize: 64 * 1024 })
    const plan = {
      repoRoot,
      localProjectId: 'test-project',
      matched: [{ repoId: 1, name: 'test-repo', projectId: 'test-project', branch: 'main' }],
    }

    await mirrorUp(plan, { api: ctx.api as any, force: false })

    const part0Calls = ctx.api.mirrorUploadPart.mock.calls.filter((c) => c[2] === 0)
    expect(part0Calls.length).toBe(3)
    expect(ctx.committed).toBe(true)
  })

  it('aborts the upload session if commit fails terminally', async () => {
    const repoRoot = join(tmpDir, 'repo-abort')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'tracked.txt'), 'tracked content')

    const ctx = makeMockApi()
    ctx.api.mirrorCommit.mockRejectedValueOnce(new Error('boom'))

    const plan = {
      repoRoot,
      localProjectId: 'test-project',
      matched: [{ repoId: 1, name: 'test-repo', projectId: 'test-project', branch: 'main' }],
    }

    await expect(mirrorUp(plan, { api: ctx.api as any, force: false })).rejects.toThrow('boom')
    expect(ctx.api.mirrorAbort).toHaveBeenCalledWith(1, 'upload-1')
  })

  it('calls onProgress with monotonically non-decreasing bytesSent', async () => {
    const repoRoot = join(tmpDir, 'repo-progress')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'tracked.txt'), 'tracked content')

    const ctx = makeMockApi()
    const onProgress = vi.fn()
    const plan = {
      repoRoot,
      localProjectId: 'test-project',
      matched: [{ repoId: 1, name: 'test-repo', projectId: 'test-project', branch: 'main' }],
    }

    await mirrorUp(plan, { api: ctx.api as any, force: false, onProgress })

    expect(onProgress).toHaveBeenCalled()

    let prevBytes = -1
    for (const [p] of onProgress.mock.calls) {
      expect(p.bytesSent).toBeGreaterThanOrEqual(prevBytes)
      prevBytes = p.bytesSent
    }
  })

  it('commits with gzip=true and produces a gzip-magic tar stream', async () => {
    const repoRoot = join(tmpDir, 'repo-small')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'tracked.txt'), 'tracked content')

    const ctx = makeMockApi()
    const plan = {
      repoRoot,
      localProjectId: 'test-project',
      matched: [{ repoId: 1, name: 'test-repo', projectId: 'test-project', branch: 'main' }],
    }

    await mirrorUp(plan, { api: ctx.api as any, force: false })

    expect(ctx.api.mirrorCommit.mock.calls[0]![3]).toBe(true)

    const combined = Buffer.concat(ctx.partsReceived)
    expect(combined[0]).toBe(0x1f)
    expect(combined[1]).toBe(0x8b)
  })
})

describe('checkPushDivergence', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mirror-divergence-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function initRepo(name: string): string {
    const repoRoot = join(tmpDir, name)
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    return repoRoot
  }

  function commit(repoRoot: string, file: string, content: string): string {
    writeFileSync(join(repoRoot, file), content)
    spawnSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', `add ${file}`], { cwd: repoRoot, stdio: 'ignore' })
    return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim()
  }

  const apiWith = (head: string | null, dirty = false) => ({
    mirrorHead: vi.fn().mockResolvedValue({ repoId: 1, branch: 'main', head, dirty }),
  }) as any

  it('reports no divergence when server head equals local head', async () => {
    const repoRoot = initRepo('equal')
    const head = commit(repoRoot, 'a.txt', 'a')

    const result = await checkPushDivergence(repoRoot, apiWith(head), 1)
    expect(result.diverged).toBe(false)
    expect(result.lostCommits).toBe(0)
  })

  it('reports no divergence (fast-forward) when server head is an ancestor of local head', async () => {
    const repoRoot = initRepo('ff')
    const first = commit(repoRoot, 'a.txt', 'a')
    commit(repoRoot, 'b.txt', 'b')

    const result = await checkPushDivergence(repoRoot, apiWith(first), 1)
    expect(result.diverged).toBe(false)
    expect(result.lostCommits).toBe(0)
  })

  it('reports divergence with unknown count when server head is not present locally', async () => {
    const repoRoot = initRepo('unknown')
    commit(repoRoot, 'a.txt', 'a')

    const result = await checkPushDivergence(repoRoot, apiWith('0000000000000000000000000000000000000000'), 1)
    expect(result.diverged).toBe(true)
    expect(result.lostCommits).toBe(-1)
  })

  it('reports divergence with a count when server head exists but is not an ancestor', async () => {
    const repoRoot = initRepo('diverged')
    const base = commit(repoRoot, 'a.txt', 'a')
    spawnSync('git', ['checkout', '-b', 'server', base], { cwd: repoRoot, stdio: 'ignore' })
    const serverHead = commit(repoRoot, 'server.txt', 'server-work')
    spawnSync('git', ['checkout', '-'], { cwd: repoRoot, stdio: 'ignore' })
    commit(repoRoot, 'local.txt', 'local-work')

    const result = await checkPushDivergence(repoRoot, apiWith(serverHead), 1)
    expect(result.diverged).toBe(true)
    expect(result.lostCommits).toBe(1)
  })

  it('surfaces server dirty state even when histories match', async () => {
    const repoRoot = initRepo('dirty')
    const head = commit(repoRoot, 'a.txt', 'a')

    const result = await checkPushDivergence(repoRoot, apiWith(head, true), 1)
    expect(result.diverged).toBe(false)
    expect(result.serverDirty).toBe(true)
  })
})

describe('pickMatchedRepo', () => {
  const main = { repoId: 1, name: 'app', projectId: 'p', branch: 'main' }
  const feature = { repoId: 2, name: 'app-feature', projectId: 'p', branch: 'feature' }

  it('returns the single match regardless of branch', () => {
    expect(pickMatchedRepo([main], 'feature')).toBe(main)
    expect(pickMatchedRepo([main], null)).toBe(main)
  })

  it('prefers the repo already on the local branch when several match', () => {
    expect(pickMatchedRepo([main, feature], 'feature')).toBe(feature)
  })

  it('returns null when several match and none is on the local branch', () => {
    expect(pickMatchedRepo([main, feature], 'other')).toBeNull()
    expect(pickMatchedRepo([main, feature], null)).toBeNull()
  })
})

describe('describePushDivergence', () => {
  const base = { serverHead: 'abc', serverBranch: 'main', lostCommits: 0 }

  it('returns no reasons when the push is a clean fast-forward', () => {
    expect(describePushDivergence({ ...base, serverDirty: false, diverged: false })).toEqual([])
  })

  it('describes a counted divergence and dirty server together', () => {
    expect(describePushDivergence({ ...base, serverDirty: true, diverged: true, lostCommits: 2 })).toEqual([
      'the server is 2 commit(s) ahead of your local branch',
      'the server has uncommitted changes',
    ])
  })

  it('describes divergence with an unknown commit count', () => {
    expect(describePushDivergence({ ...base, serverDirty: false, diverged: true, lostCommits: -1 })).toEqual([
      'the server has commit(s) not present in your local branch',
    ])
  })
})

describe('checkPullDivergence', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pull-divergence-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function initRepo(name: string): string {
    const repoRoot = join(tmpDir, name)
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    return repoRoot
  }

  function commit(repoRoot: string, file: string, content: string): string {
    writeFileSync(join(repoRoot, file), content)
    spawnSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', `add ${file}`], { cwd: repoRoot, stdio: 'ignore' })
    return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim()
  }

  it('reports no divergence when the server contains the local head (fast-forward pull)', async () => {
    const repoRoot = initRepo('behind')
    commit(repoRoot, 'a.txt', 'a')

    const api = { mirrorContains: vi.fn().mockResolvedValue({ contained: true }) } as any
    const result = await checkPullDivergence(repoRoot, api, 1)

    expect(result.diverged).toBe(false)
    expect(api.mirrorContains).toHaveBeenCalledTimes(1)
  })

  it('reports divergence with a count when the server lacks local commits', async () => {
    const repoRoot = initRepo('ahead')
    const base = commit(repoRoot, 'a.txt', 'a')
    commit(repoRoot, 'b.txt', 'b')

    const api = {
      mirrorContains: vi.fn().mockResolvedValue({ contained: false }),
      mirrorHead: vi.fn().mockResolvedValue({ repoId: 1, branch: 'main', head: base, dirty: false }),
    } as any
    const result = await checkPullDivergence(repoRoot, api, 1)

    expect(result.diverged).toBe(true)
    expect(result.lostCommits).toBe(1)
  })

  it('reports divergence with unknown count when the server head is not present locally', async () => {
    const repoRoot = initRepo('unknown')
    commit(repoRoot, 'a.txt', 'a')

    const api = {
      mirrorContains: vi.fn().mockResolvedValue({ contained: false }),
      mirrorHead: vi.fn().mockResolvedValue({ repoId: 1, branch: 'main', head: '0000000000000000000000000000000000000000', dirty: false }),
    } as any
    const result = await checkPullDivergence(repoRoot, api, 1)

    expect(result.diverged).toBe(true)
    expect(result.lostCommits).toBe(-1)
  })

  it('reports no divergence for an empty local repo with no commits', async () => {
    const repoRoot = initRepo('empty')

    const api = { mirrorContains: vi.fn() } as any
    const result = await checkPullDivergence(repoRoot, api, 1)

    expect(result.diverged).toBe(false)
    expect(api.mirrorContains).not.toHaveBeenCalled()
  })
})

describe('mirror patch helpers', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mirror-diff-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('pushes a local working tree patch through the manager API', async () => {
    const repoRoot = join(tmpDir, 'repo-local-diff')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'tracked.txt'), 'before\n')
    spawnSync('git', ['add', 'tracked.txt'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'tracked.txt'), 'after\n')

    const api = {
      mirrorPatch: vi.fn().mockResolvedValue({ repoId: 1, fullPath: '/tmp/remote', branch: 'main', head: 'abc', created: false, applied: true }),
    }

    await mirrorUpPatch({
      repoRoot,
      localProjectId: 'test-project',
      matched: [{ repoId: 1, name: 'test-repo', projectId: 'test-project', branch: 'main' }],
    }, { api: api as any, force: false })

    expect(api.mirrorPatch).toHaveBeenCalledTimes(1)
    const body = api.mirrorPatch.mock.calls[0]![1]
    expect(body.patch).toContain('diff --git a/tracked.txt b/tracked.txt')
    expect(body.patch).toContain('-before')
    expect(body.patch).toContain('+after')
  })
})

describe('mirrorUpFast targets the selected repo', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mirror-upfast-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('uses the repoId from plan.matched[0] for bundle upload and patch', async () => {
    const repoRoot = join(tmpDir, 'repo-selected')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'tracked.txt'), 'content\n')
    spawnSync('git', ['add', 'tracked.txt'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'tracked.txt'), 'updated\n')

    const api = {
      mirrorUploadBundle: vi.fn().mockResolvedValue(undefined),
      mirrorPatch: vi.fn().mockResolvedValue({ repoId: 99, fullPath: '/tmp/x', branch: 'main', head: 'def', created: false, applied: true }),
    }

    const plan = {
      repoRoot,
      localProjectId: 'proj',
      matched: [
        { repoId: 10, name: 'first-repo', projectId: 'proj', branch: 'main' },
        { repoId: 99, name: 'selected-repo', projectId: 'proj', branch: 'main' },
      ],
    }

    const selectedPlan = { ...plan, matched: [plan.matched[1]!] }
    const result = await mirrorUpFast(selectedPlan, { api: api as any, force: false })

    expect(api.mirrorUploadBundle).toHaveBeenCalledTimes(1)
    expect(api.mirrorUploadBundle.mock.calls[0]![0]).toBe(99)
    expect(api.mirrorPatch).toHaveBeenCalledTimes(1)
    expect(api.mirrorPatch.mock.calls[0]![0]).toBe(99)
    expect(result.repoId).toBe(99)
  })

  it('forwards the strict current-branch option to the bundle upload', async () => {
    const repoRoot = join(tmpDir, 'repo-strict-forward')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'tracked.txt'), 'content\n')
    spawnSync('git', ['add', 'tracked.txt'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoRoot, stdio: 'ignore' })

    const api = {
      mirrorUploadBundle: vi.fn().mockResolvedValue(undefined),
      mirrorPatch: vi.fn().mockResolvedValue({ repoId: 1, fullPath: '/tmp/x', branch: 'main', head: 'abc', created: false, applied: true }),
    }

    const plan = {
      repoRoot,
      localProjectId: 'proj',
      matched: [{ repoId: 1, name: 'repo-A', projectId: 'proj', branch: 'main' }],
    }

    await mirrorUpFast(plan, { api: api as any, force: false, requireCurrentBranch: true })

    expect(api.mirrorUploadBundle.mock.calls[0]![2].requireCurrentBranch).toBe(true)
  })

  it('omits the strict current-branch option by default', async () => {
    const repoRoot = join(tmpDir, 'repo-strict-default')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'tracked.txt'), 'content\n')
    spawnSync('git', ['add', 'tracked.txt'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoRoot, stdio: 'ignore' })

    const api = {
      mirrorUploadBundle: vi.fn().mockResolvedValue(undefined),
      mirrorPatch: vi.fn().mockResolvedValue({ repoId: 1, fullPath: '/tmp/x', branch: 'main', head: 'abc', created: false, applied: true }),
    }

    const plan = {
      repoRoot,
      localProjectId: 'proj',
      matched: [{ repoId: 1, name: 'repo-A', projectId: 'proj', branch: 'main' }],
    }

    await mirrorUpFast(plan, { api: api as any, force: false })

    expect(api.mirrorUploadBundle.mock.calls[0]![2].requireCurrentBranch).toBeUndefined()
  })

  it('reports bundling, uploading, and patching phases in order', async () => {
    const repoRoot = join(tmpDir, 'repo-phases')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'a.txt'), 'a\n')
    spawnSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' })

    const api = {
      mirrorUploadBundle: vi.fn().mockResolvedValue(undefined),
      mirrorPatch: vi.fn().mockResolvedValue({ repoId: 1, fullPath: '/tmp/x', branch: 'main', head: 'abc', created: false, applied: true }),
    }

    const plan = {
      repoRoot,
      localProjectId: 'proj',
      matched: [{ repoId: 1, name: 'repo-A', projectId: 'proj', branch: 'main' }],
    }

    const phases: MirrorUpFastPhase[] = []
    await mirrorUpFast(plan, { api: api as any, force: false, onPhase: (p) => phases.push(p) })

    expect(phases.map((p) => p.kind)).toEqual(['bundling', 'uploading', 'patching'])
    const uploading = phases[1] as Extract<MirrorUpFastPhase, { kind: 'uploading' }>
    expect(uploading.bytesSent).toBe(0)
    expect(uploading.totalBytes).toBeGreaterThan(0)
  })

  it('emits cumulative upload progress and a processing phase when the api reports sent bytes', async () => {
    const repoRoot = join(tmpDir, 'repo-upload-progress')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'a.txt'), 'a\n')
    spawnSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' })

    const api = {
      mirrorUploadBundle: vi.fn().mockImplementation(
        async (_repoId: number, bundlePath: string, opts: { onProgress?: (bytesSent: number) => void }) => {
          const { size } = statSync(bundlePath)
          opts.onProgress?.(Math.floor(size / 2))
          opts.onProgress?.(size)
        },
      ),
      mirrorPatch: vi.fn().mockResolvedValue({ repoId: 1, fullPath: '/tmp/x', branch: 'main', head: 'abc', created: false, applied: true }),
    }

    const plan = {
      repoRoot,
      localProjectId: 'proj',
      matched: [{ repoId: 1, name: 'repo-A', projectId: 'proj', branch: 'main' }],
    }

    const phases: MirrorUpFastPhase[] = []
    await mirrorUpFast(plan, { api: api as any, force: false, onPhase: (p) => phases.push(p) })

    expect(phases.map((p) => p.kind)).toEqual(['bundling', 'uploading', 'uploading', 'uploading', 'processing', 'patching'])
    const sent = phases.filter((p): p is Extract<MirrorUpFastPhase, { kind: 'uploading' }> => p.kind === 'uploading').map((p) => p.bytesSent)
    expect(sent[0]).toBe(0)
    expect(sent[1]!).toBeGreaterThan(0)
    expect(sent[2]!).toBeGreaterThan(sent[1]!)
  })

  it('narrows a multi-match plan so bundle goes to the chosen repo', async () => {
    const repoRoot = join(tmpDir, 'repo-narrow')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'a.txt'), 'a\n')
    spawnSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' })
    writeFileSync(join(repoRoot, 'a.txt'), 'a-updated\n')

    const uploadCalls: number[] = []
    const patchCalls: number[] = []

    const api = {
      mirrorUploadBundle: vi.fn().mockImplementation(async (repoId: number) => { uploadCalls.push(repoId) }),
      mirrorPatch: vi.fn().mockImplementation(async (repoId: number) => {
        patchCalls.push(repoId)
        return { repoId, fullPath: '/tmp/x', branch: 'main', head: 'abc', created: false, applied: true }
      }),
    }

    const multiPlan = {
      repoRoot,
      localProjectId: 'proj',
      matched: [
        { repoId: 1, name: 'repo-A', projectId: 'proj', branch: 'main' },
        { repoId: 2, name: 'repo-B', projectId: 'proj', branch: 'main' },
        { repoId: 3, name: 'repo-C', projectId: 'proj', branch: 'main' },
      ],
    }

    const selectedPlan = { ...multiPlan, matched: [multiPlan.matched[2]!] }
    await mirrorUpFast(selectedPlan, { api: api as any, force: false })

    expect(uploadCalls).toEqual([3])
    expect(patchCalls).toEqual([3])
  })
})

describe('mirrorDownFast preflight', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mirror-downfast-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function initRepo(name: string): string {
    const repoRoot = join(tmpDir, name)
    mkdirSync(repoRoot)
    spawnSync('git', ['init', '-b', 'main'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'ignore' })
    return repoRoot
  }

  function commitFile(repoRoot: string, file: string, content: string): string {
    writeFileSync(join(repoRoot, file), content)
    spawnSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', `update ${file}`], { cwd: repoRoot, stdio: 'ignore' })
    return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim()
  }

  function revRef(repoRoot: string, ref: string): string {
    return execSync(`git rev-parse ${ref}`, { cwd: repoRoot, encoding: 'utf-8' }).trim()
  }

  function createBundle(repoRoot: string, name: string): Buffer {
    const bundleFile = join(tmpDir, `${name}.bundle`)
    execSync(`git bundle create "${bundleFile}" --all`, { cwd: repoRoot })
    return readFileSync(bundleFile)
  }

  const streamOf = (buf: Buffer): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(buf))
        controller.close()
      },
    })

  const fastApi = (branch: string | null, bundle: Buffer) => ({
    mirrorPatchSnapshot: vi.fn().mockResolvedValue({ branch, patch: '' }),
    mirrorDownloadBundle: vi.fn().mockResolvedValue(streamOf(bundle)),
  })

  const syncRefCount = (repoRoot: string): number =>
    execSync('git for-each-ref refs/remotes/ocm-sync', { cwd: repoRoot, encoding: 'utf-8' }).trim().split('\n').filter(Boolean).length

  it('updates the same branch target and leaves no ocm-sync refs behind', async () => {
    const server = initRepo('server-same')
    commitFile(server, 'tracked.txt', 'server-base\n')
    execSync('git checkout -b feature', { cwd: server, stdio: 'ignore' })
    commitFile(server, 'feature.txt', 'feature\n')
    execSync('git checkout main', { cwd: server, stdio: 'ignore' })
    commitFile(server, 'tracked.txt', 'server-head\n')
    const serverMainSha = revRef(server, 'main')
    const serverFeatureSha = revRef(server, 'feature')
    const bundle = createBundle(server, 'server-same')

    const local = initRepo('local-same')
    commitFile(local, 'tracked.txt', 'local-head\n')

    await mirrorDownFast(1, local, fastApi('main', bundle) as any, { force: false })

    expect(getBranchName(local)).toBe('main')
    expect(revRef(local, 'HEAD')).toBe(serverMainSha)
    expect(readFileSync(join(local, 'tracked.txt'), 'utf-8')).toBe('server-head\n')
    expect(revRef(local, 'feature')).toBe(serverFeatureSha)
    expect(syncRefCount(local)).toBe(0)
  })

  it('switches branches when clean and selects the incoming target before resetting', async () => {
    const server = initRepo('server-cross')
    commitFile(server, 'main.txt', 'server-main\n')
    execSync('git checkout -b topic', { cwd: server, stdio: 'ignore' })
    const topicSha = commitFile(server, 'topic.txt', 'server-topic\n')
    execSync('git checkout main', { cwd: server, stdio: 'ignore' })
    commitFile(server, 'main.txt', 'server-main-2\n')
    const serverMainSha = revRef(server, 'main')
    const bundle = createBundle(server, 'server-cross')

    const local = initRepo('local-cross')
    commitFile(local, 'main.txt', 'local-main\n')
    execSync('git branch topic', { cwd: local, stdio: 'ignore' })

    await mirrorDownFast(1, local, fastApi('topic', bundle) as any, { force: false })

    expect(getBranchName(local)).toBe('topic')
    expect(revRef(local, 'HEAD')).toBe(topicSha)
    expect(revRef(local, 'topic')).toBe(topicSha)
    expect(revRef(local, 'main')).toBe(serverMainSha)
    expect(readFileSync(join(local, 'topic.txt'), 'utf-8')).toBe('server-topic\n')
    expect(syncRefCount(local)).toBe(0)
  })

  it('keeps the active branch untouched when the snapshot has no target branch', async () => {
    const server = initRepo('server-null-target')
    commitFile(server, 'a.txt', 'server-a\n')
    execSync('git checkout -b feature', { cwd: server, stdio: 'ignore' })
    const serverFeatureSha = commitFile(server, 'feature.txt', 'feature\n')
    execSync('git checkout main', { cwd: server, stdio: 'ignore' })
    commitFile(server, 'b.txt', 'server-b\n')
    const bundle = createBundle(server, 'server-null-target')

    const local = initRepo('local-null-target')
    const localMainSha = commitFile(local, 'a.txt', 'local-a\n')
    execSync('git checkout -b feature', { cwd: local, stdio: 'ignore' })
    commitFile(local, 'local-feature.txt', 'local-feature\n')
    execSync('git checkout main', { cwd: local, stdio: 'ignore' })

    await mirrorDownFast(1, local, fastApi(null, bundle) as any, { force: false })

    expect(getBranchName(local)).toBe('main')
    expect(revRef(local, 'main')).toBe(localMainSha)
    expect(revRef(local, 'HEAD')).toBe(localMainSha)
    expect(readFileSync(join(local, 'a.txt'), 'utf-8')).toBe('local-a\n')
    expect(execSync('git status --porcelain', { cwd: local, encoding: 'utf-8' })).toBe('')
    expect(revRef(local, 'feature')).toBe(serverFeatureSha)
    expect(syncRefCount(local)).toBe(0)
  })

  it('rejects a target checked out in another worktree and preserves the current worktree state', async () => {
    const server = initRepo('server-wt')
    commitFile(server, 'main.txt', 'server-main\n')
    execSync('git checkout -b checked', { cwd: server, stdio: 'ignore' })
    commitFile(server, 'checked.txt', 'server-checked\n')
    execSync('git checkout main', { cwd: server, stdio: 'ignore' })
    const bundle = createBundle(server, 'server-wt')

    const local = initRepo('local-wt')
    commitFile(local, 'main.txt', 'local-base\n')
    execSync(`git worktree add "${join(tmpDir, 'checked-wt')}" -b checked`, { cwd: local, stdio: 'ignore' })
    const localMainSha = revRef(local, 'main')
    const localCheckedSha = revRef(local, 'checked')
    writeFileSync(join(local, 'untracked.txt'), 'keep-me\n')

    const thrown = await mirrorDownFast(1, local, fastApi('checked', bundle) as any, { force: true }).then(
      () => null,
      (err: unknown) => err,
    )
    expect(thrown).toBeInstanceOf(MirrorAbort)
    expect((thrown as MirrorAbort).message).toContain('checked out in another worktree')

    expect(getBranchName(local)).toBe('main')
    expect(existsSync(join(local, 'untracked.txt'))).toBe(true)
    expect(revRef(local, 'main')).toBe(localMainSha)
    expect(revRef(local, 'checked')).toBe(localCheckedSha)
    expect(existsSync(join(tmpDir, 'checked-wt', 'checked.txt'))).toBe(false)
    expect(syncRefCount(local)).toBe(0)
  })

  it('rejects a missing target ref and preserves local refs and worktree state', async () => {
    const server = initRepo('server-missing')
    commitFile(server, 'main.txt', 'server-main\n')
    const bundle = createBundle(server, 'server-missing')

    const local = initRepo('local-missing')
    const localMainSha = commitFile(local, 'main.txt', 'local-main\n')
    writeFileSync(join(local, 'untracked.txt'), 'keep-me\n')

    const thrown = await mirrorDownFast(1, local, fastApi('ghost', bundle) as any, { force: true }).then(
      () => null,
      (err: unknown) => err,
    )
    expect(thrown).toBeInstanceOf(MirrorAbort)
    expect((thrown as MirrorAbort).message).toContain("no incoming branch 'ghost'")

    expect(getBranchName(local)).toBe('main')
    expect(revRef(local, 'main')).toBe(localMainSha)
    expect(existsSync(join(local, 'untracked.txt'))).toBe(true)
    expect(syncRefCount(local)).toBe(0)
  })
})

describe('ManagerApi target response validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const api = new ManagerApi('http://localhost:5003', 'test-token')

  it('parses a valid new-worktree target plan response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ kind: 'new', repoId: null, fullPath: '/repos/repo-feature', localPath: 'repo-feature', branch: 'feature', currentBranch: 'main' }),
    }))

    const plan = await api.mirrorTargetPlan(1, 'feature')

    expect(plan.kind).toBe('new')
    expect(plan.repoId).toBeNull()
    expect(plan.branch).toBe('feature')
  })

  it('parses a valid existing-worktree target plan response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ kind: 'existing', repoId: 5, fullPath: '/repos/repo-feature', localPath: 'repo-feature', branch: 'feature', currentBranch: null }),
    }))

    const plan = await api.mirrorTargetPlan(1, 'feature')

    expect(plan.kind).toBe('existing')
    expect(plan.repoId).toBe(5)
  })

  it('rejects a target plan response whose repoId contradicts its kind', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ kind: 'new', repoId: 7, fullPath: '/repos/repo-feature', localPath: 'repo-feature', branch: 'feature', currentBranch: 'main' }),
    }))

    await expect(api.mirrorTargetPlan(1, 'feature')).rejects.toThrow()
  })

  it('rejects a target plan response with an unknown kind', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ kind: 'bogus', repoId: 1, fullPath: '/x', localPath: 'x', branch: 'main', currentBranch: null }),
    }))

    await expect(api.mirrorTargetPlan(1, 'main')).rejects.toThrow()
  })

  it('parses a valid ensure target response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ repoId: 9, fullPath: '/repos/repo-feature', localPath: 'repo-feature', branch: 'feature', created: true }),
    }))

    const target = await api.mirrorEnsureTarget(1, 'feature')

    expect(target.repoId).toBe(9)
    expect(target.created).toBe(true)
  })

  it('rejects an ensure target response missing fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ repoId: 9, fullPath: '/repos/repo-feature' }),
    }))

    await expect(api.mirrorEnsureTarget(1, 'feature')).rejects.toThrow()
  })

  it('rejects an ensure target response with a non-positive repoId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ repoId: 0, fullPath: '/x', localPath: 'x', branch: 'main', created: false }),
    }))

    await expect(api.mirrorEnsureTarget(1, 'main')).rejects.toThrow()
  })
})

describe('ManagerApi mirrorUploadBundle strict branch header', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bundle-header-test-'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  const api = new ManagerApi('http://localhost:5003', 'test-token')

  async function captureUpload(opts: { branch: string | null; requireCurrentBranch?: boolean }): Promise<Record<string, string>> {
    const bundlePath = join(tmpDir, 'repo.bundle')
    writeFileSync(bundlePath, 'bundle bytes')
    let capturedHeaders: Record<string, string> | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = init!.headers as Record<string, string>
      return { ok: true, json: () => Promise.resolve({ repoId: 1, fullPath: '/repos/x', branch: 'main', head: 'abc', created: false }) }
    }))
    await api.mirrorUploadBundle(1, bundlePath, opts)
    expect(capturedHeaders).toBeDefined()
    return capturedHeaders!
  }

  it('sends the require-current-branch header when requested', async () => {
    const headers = await captureUpload({ branch: 'main', requireCurrentBranch: true })
    expect(headers['X-OCM-Require-Current-Branch']).toBe('1')
    expect(headers['X-OCM-Branch']).toBe('main')
  })

  it('omits the require-current-branch header for normal push', async () => {
    const headers = await captureUpload({ branch: 'main' })
    expect(headers['X-OCM-Require-Current-Branch']).toBeUndefined()
    expect(headers['X-OCM-Branch']).toBe('main')
  })
})
