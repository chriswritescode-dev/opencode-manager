import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync, execSync } from 'child_process'
import { prepareMirror, MirrorAbort, mirrorDown, mirrorUp } from '../src/mirror'

describe('prepareMirror', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mirror-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects when not in a git repo', () => {
    const nonGitDir = join(tmpDir, 'non-git')
    mkdirSync(nonGitDir)

    expect(() => prepareMirror(nonGitDir, [])).toThrow(MirrorAbort)
    expect(() => prepareMirror(nonGitDir, [])).toThrow('not in a git repository')
  })

  it('rejects when no origin URL found', () => {
    const gitDir = join(tmpDir, 'git-no-origin')
    mkdirSync(gitDir)
    spawnSync('git', ['init'], { cwd: gitDir, stdio: 'ignore' })

    expect(() => prepareMirror(gitDir, [])).toThrow(MirrorAbort)
    expect(() => prepareMirror(gitDir, [])).toThrow('no origin URL found')
  })

  it('returns empty matched array when no remote matches', () => {
    const gitDir = join(tmpDir, 'git-mismatch')
    mkdirSync(gitDir)
    spawnSync('git', ['init'], { cwd: gitDir, stdio: 'ignore' })
    spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/other/repo.git'], { cwd: gitDir, stdio: 'ignore' })

    const remotes = [
      { repoId: 1, name: 'my-repo', originUrl: 'https://github.com/me/repo.git', branch: 'main' },
    ]

    const plan = prepareMirror(gitDir, remotes)
    expect(plan.matched).toHaveLength(0)
    expect(plan.localOrigin).toContain('other/repo')
  })

  it('returns matching repos when origin matches', () => {
    const gitDir = join(tmpDir, 'git-match')
    mkdirSync(gitDir)
    spawnSync('git', ['init'], { cwd: gitDir, stdio: 'ignore' })
    spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/me/repo.git'], { cwd: gitDir, stdio: 'ignore' })

    const remotes = [
      { repoId: 1, name: 'my-repo', originUrl: 'https://github.com/me/repo.git', branch: 'main' },
      { repoId: 2, name: 'other-repo', originUrl: 'https://github.com/other/repo.git', branch: 'main' },
    ]

    const plan = prepareMirror(gitDir, remotes)
    expect(plan.matched).toHaveLength(1)
    expect(plan.matched[0]!.repoId).toBe(1)
    expect(plan.localOrigin).toContain('me/repo')
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
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(stderrOutput.trim())
    })

    const mockState = { managerUrl: 'http://localhost:5003' }
    vi.doMock('../src/state.js', () => ({
      readState: () => mockState,
      writeState: () => {},
      clearState: () => {},
      getStatePath: () => '/tmp/state.json',
    }))
    vi.doMock('../src/keychain.js', () => ({
      getToken: () => 'test-token',
      setToken: () => {},
      deleteToken: () => true,
      KeychainError: class extends Error {},
    }))
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

  function createTarball(dir: string): Buffer {
    const tarFile = join(tmpDir, 'test.tar')
    execSync(`tar -cf "${tarFile}" -C "${dir}" .`)
    return require('fs').readFileSync(tarFile)
  }

  it('stages tarball in sibling directory next to repoRoot', async () => {
    const repoRoot = join(tmpDir, 'repo')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })

    const contentDir = join(tmpDir, 'content')
    mkdirSync(contentDir)
    writeFileSync(join(contentDir, 'file.txt'), 'hello')

    const tarData = createTarball(contentDir)

    const mockApi = {
      mirrorDown: vi.fn().mockResolvedValue(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(tarData))
            controller.close()
          },
        })
      ),
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

    const tarData = createTarball(contentDir)

    const mockApi = {
      mirrorDown: vi.fn().mockResolvedValue(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(tarData))
            controller.close()
          },
        })
      ),
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

    const tarData = createTarball(contentDir)

    const mockApi = {
      mirrorDown: vi.fn().mockResolvedValue(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(tarData))
            controller.close()
          },
        })
      ),
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

    const tarData = createTarball(contentDir)

    const mockApi = {
      mirrorDown: vi.fn().mockResolvedValue(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(tarData))
            controller.close()
          },
        })
      ),
    } as any

    await mirrorDown(1, repoRoot, mockApi, { force: true })

    expect(existsSync(join(repoRoot, 'new-file.txt'))).toBe(true)
    expect(existsSync(join(repoRoot, 'old-file.txt'))).toBe(false)

    const entries = readdirSync(tmpDir).filter((e) => e.startsWith('repo-replace.ocm-backup-'))
    expect(entries.length).toBe(0)

    const stagingEntries = readdirSync(tmpDir).filter((e) => e.startsWith('repo-replace.ocm-recv-'))
    expect(stagingEntries.length).toBe(0)
  })
})

describe('mirrorUp with gitignore', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mirror-up-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('excludes gitignored files from tar stream', async () => {
    const repoRoot = join(tmpDir, 'repo-up-gitignore')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })

    writeFileSync(join(repoRoot, 'tracked.txt'), 'tracked content')
    writeFileSync(join(repoRoot, 'secrets.env'), 'SECRET_KEY=abc123')
    writeFileSync(join(repoRoot, '.gitignore'), 'secrets.env\n')

    const mockApi = {
      mirrorUp: vi.fn().mockResolvedValue({ repoId: 1, branch: 'main', head: 'abc123', created: false }),
    } as any

    const plan = {
      repoRoot,
      localOrigin: 'https://github.com/test/repo.git',
      matched: [{ repoId: 1, name: 'test-repo', originUrl: 'https://github.com/test/repo.git', branch: 'main' }],
    }

    await mirrorUp(plan, { api: mockApi, force: false })

    expect(mockApi.mirrorUp).toHaveBeenCalledTimes(1)
    expect(mockApi.mirrorUp.mock.calls[0][0]).toBe(1)

    const opts = mockApi.mirrorUp.mock.calls[0][2]
    expect(opts.force).toBe(false)
  })

  it('excludes node_modules from tar stream', async () => {
    const repoRoot = join(tmpDir, 'repo-up-node-modules')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })

    writeFileSync(join(repoRoot, 'file.txt'), 'content')
    mkdirSync(join(repoRoot, 'node_modules'))
    writeFileSync(join(repoRoot, 'node_modules', 'dep.js'), 'dep content')

    const mockApi = {
      mirrorUp: vi.fn().mockResolvedValue({ repoId: 1, branch: 'main', head: 'abc123', created: false }),
    } as any

    const plan = {
      repoRoot,
      localOrigin: 'https://github.com/test/repo.git',
      matched: [{ repoId: 1, name: 'test-repo', originUrl: 'https://github.com/test/repo.git', branch: 'main' }],
    }

    await mirrorUp(plan, { api: mockApi, force: false })

    expect(mockApi.mirrorUp).toHaveBeenCalledTimes(1)
    expect(mockApi.mirrorUp.mock.calls[0][0]).toBe(1)
    expect(mockApi.mirrorUp.mock.calls[0][2].force).toBe(false)
  })

  it('does not create exclude file when no gitignored paths exist', async () => {
    const repoRoot = join(tmpDir, 'repo-up-no-ignore')
    mkdirSync(repoRoot)
    spawnSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' })

    writeFileSync(join(repoRoot, 'file.txt'), 'content')

    const mockApi = {
      mirrorUp: vi.fn().mockResolvedValue({ repoId: 1, branch: 'main', head: 'abc123', created: false }),
    } as any

    const plan = {
      repoRoot,
      localOrigin: 'https://github.com/test/repo.git',
      matched: [{ repoId: 1, name: 'test-repo', originUrl: 'https://github.com/test/repo.git', branch: 'main' }],
    }

    await mirrorUp(plan, { api: mockApi, force: false })

    expect(mockApi.mirrorUp).toHaveBeenCalledTimes(1)
    expect(mockApi.mirrorUp.mock.calls[0][0]).toBe(1)
    const opts = mockApi.mirrorUp.mock.calls[0][2]
    expect(opts.force).toBe(false)
  })
})
