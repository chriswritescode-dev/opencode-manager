import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo, getRepoById, getRepoByLocalPath } from '../../src/db/queries'
import { resolveOpenCodeProjectId } from '@opencode-manager/shared/project-id'
import { isWorktreeSibling } from '@opencode-manager/shared/utils'
import { getReposPath, getScheduleWorktreesPath } from '@opencode-manager/shared/config/env'
import type { GitAuthService } from '../../src/services/git-auth'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { Repo } from '../../src/types/repo'

type SiblingRepo = Repo & { currentBranch: string | undefined; worktreeStrategy?: string }

const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'repo-git-'))
process.env.WORKSPACE_PATH = workspaceRoot

const reposPath = path.join(workspaceRoot, 'repos')
const projectsRoot = path.join(workspaceRoot, 'projects')
const certDir = path.join(workspaceRoot, 'certs')
const keyPath = path.join(certDir, 'key.pem')
const certPath = path.join(certDir, 'cert.pem')

let certKey: Buffer
let certPem: Buffer

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim()
}

function createCommittedRepo(repoPath: string, branch = 'main'): void {
  mkdirSync(repoPath, { recursive: true })
  git(['init', '-b', branch], repoPath)
  git(['config', 'user.email', 'test@test.com'], repoPath)
  git(['config', 'user.name', 'Test'], repoPath)
  git(['commit', '--allow-empty', '-m', 'init'], repoPath)
}

function createOrigin(originPath: string, workPath: string, extraBranches: string[] = []): void {
  mkdirSync(originPath, { recursive: true })
  git(['init', '--bare', originPath])
  mkdirSync(workPath, { recursive: true })
  git(['init', '-b', 'main'], workPath)
  git(['config', 'user.email', 'test@test.com'], workPath)
  git(['config', 'user.name', 'Test'], workPath)
  git(['commit', '--allow-empty', '-m', 'init'], workPath)
  git(['remote', 'add', 'origin', originPath], workPath)
  git(['push', 'origin', 'main'], workPath)
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], originPath)

  for (const branch of extraBranches) {
    git(['checkout', '-b', branch], workPath)
    git(['commit', '--allow-empty', '-m', branch], workPath)
    git(['push', 'origin', branch], workPath)
    git(['checkout', 'main'], workPath)
  }
}

function cloneOrigin(originPath: string, clonePath: string): void {
  git(['clone', originPath, clonePath])
  git(['config', 'user.email', 'test@test.com'], clonePath)
  git(['config', 'user.name', 'Test'], clonePath)
}

let seq = 0

function uniqueName(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

function createGitAuthService(env: Record<string, string> = {}): GitAuthService {
  return {
    getGitEnvironment: () => env,
    getSSHEnvironment: () => ({}),
    setupSSHForRepoUrl: async () => false,
    cleanupSSHKey: async () => {},
  } as unknown as GitAuthService
}

async function withTlsServer<T>(status: number, fn: (port: number) => Promise<T>): Promise<T> {
  const server = createServer({ key: certKey, cert: certPem }, (_req, res) => {
    res.writeHead(status, { 'WWW-Authenticate': 'Basic realm="test"' })
    res.end('error')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  try {
    return await fn(port)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('repo service real git', () => {
  let db: Database
  let gitAuth: GitAuthService

  beforeAll(() => {
    mkdirSync(certDir, { recursive: true })
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', keyPath, '-out', certPath,
      '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1',
    ], { stdio: 'ignore' })
    certKey = readFileSync(keyPath)
    certPem = readFileSync(certPath)
  })

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    gitAuth = createGitAuthService()
    rmSync(reposPath, { recursive: true, force: true })
    rmSync(projectsRoot, { recursive: true, force: true })
  })

  afterEach(() => {
    db.close()
  })

  afterAll(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  function registerLocalRepo(localPath: string, branch = 'main'): Repo {
    return createRepo(db, {
      isLocal: true,
      localPath,
      branch,
      defaultBranch: branch,
      cloneStatus: 'ready',
      clonedAt: Date.now(),
    })
  }

  describe('initLocalRepo', () => {
    it('initializes a relative repo and marks it ready', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')
      const name = uniqueName('relative')
      const repo = await initLocalRepo(db, gitAuth, name)

      expect(repo.cloneStatus).toBe('ready')
      expect(repo.localPath).toBe(name)
      expect(existsSync(path.join(reposPath, name, '.git'))).toBe(true)
      expect(getRepoById(db, repo.id)?.cloneStatus).toBe('ready')
    })

    it('initializes a relative repo on a custom branch', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')
      const name = uniqueName('relative-branch')
      const repo = await initLocalRepo(db, gitAuth, name, 'feature')

      expect(repo.branch).toBe('feature')
      expect(git(['symbolic-ref', '--short', 'HEAD'], path.join(reposPath, name))).toBe('feature')
    })

    it('returns the existing row for a repeated relative repo', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')
      const name = uniqueName('relative-repeat')
      const first = await initLocalRepo(db, gitAuth, name)
      const second = await initLocalRepo(db, gitAuth, name)

      expect(second.id).toBe(first.id)
    })

    it('rolls back when the relative target path is a file', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')
      const name = uniqueName('relative-blocked')
      mkdirSync(reposPath, { recursive: true })
      writeFileSync(path.join(reposPath, name), 'blocked')

      await expect(initLocalRepo(db, gitAuth, name)).rejects.toThrow(/Failed to initialize local repository/)
      expect(getRepoByLocalPath(db, name)).toBeNull()
    })

    it('registers an absolute repo with a workspace symlink', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')
      const sourcePath = path.join(projectsRoot, uniqueName('absolute'))
      createCommittedRepo(sourcePath)

      const repo = await initLocalRepo(db, gitAuth, sourcePath)
      const aliasPath = path.join(reposPath, repo.localPath)

      expect(repo.sourcePath).toBe(sourcePath)
      expect(repo.isLocal).toBe(true)
      expect(lstatSync(aliasPath).isSymbolicLink()).toBe(true)
    })

    it('returns the existing row for a repeated absolute source path', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')
      const sourcePath = path.join(projectsRoot, uniqueName('absolute-repeat'))
      createCommittedRepo(sourcePath)

      const first = await initLocalRepo(db, gitAuth, sourcePath)
      const second = await initLocalRepo(db, gitAuth, sourcePath)

      expect(second.id).toBe(first.id)
    })

    it('checks out a requested local branch while registering an absolute repo', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')
      const sourcePath = path.join(projectsRoot, uniqueName('absolute-branch'))
      createCommittedRepo(sourcePath)
      git(['branch', 'feature'], sourcePath)

      const repo = await initLocalRepo(db, gitAuth, sourcePath, 'feature')

      expect(repo.branch).toBe('feature')
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], sourcePath)).toBe('feature')
    })

    it('registers an absolute repo located inside the repos directory', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')
      const sourcePath = path.join(reposPath, uniqueName('inside-repo'))
      createCommittedRepo(sourcePath)

      const repo = await initLocalRepo(db, gitAuth, sourcePath)

      expect(repo.localPath).toBe(path.basename(sourcePath))
      expect(repo.sourcePath).toBeNull()
    })

    it('marks a linked worktree as a worktree when registering an absolute path', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')
      const basePath = path.join(projectsRoot, uniqueName('linked-base'))
      createCommittedRepo(basePath)
      const worktreePath = path.join(projectsRoot, `${path.basename(basePath)}-linked`)
      git(['worktree', 'add', '-b', 'linked', worktreePath], basePath)

      const repo = await initLocalRepo(db, gitAuth, worktreePath)

      expect(repo.isWorktree).toBe(true)
    })

    it('rejects an absolute path that is not a git repository', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')
      const sourcePath = path.join(projectsRoot, uniqueName('absolute-not-git'))
      mkdirSync(sourcePath, { recursive: true })

      await expect(initLocalRepo(db, gitAuth, sourcePath)).rejects.toThrow(/not a valid Git repository/)
    })

    it('rejects a missing absolute path', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')

      await expect(initLocalRepo(db, gitAuth, path.join(projectsRoot, 'missing-absolute'))).rejects.toThrow(/No such file or directory/)
    })

    it('rejects the repos root itself as a source', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')
      mkdirSync(reposPath, { recursive: true })

      await expect(initLocalRepo(db, gitAuth, reposPath)).rejects.toThrow(/not a valid Git repository/)
    })

    it('picks a suffixed alias when the preferred alias directory exists', async () => {
      const { initLocalRepo } = await import('../../src/services/repo')
      const name = uniqueName('alias-conflict')
      const sourcePath = path.join(projectsRoot, name)
      createCommittedRepo(sourcePath)
      mkdirSync(path.join(reposPath, name), { recursive: true })

      const repo = await initLocalRepo(db, gitAuth, sourcePath)

      expect(repo.localPath).toBe(`${name}-2`)
      expect(lstatSync(path.join(reposPath, `${name}-2`)).isSymbolicLink()).toBe(true)
    })
  })

  describe('discoverLocalRepos', () => {
    it('discovers nested real git repositories', async () => {
      const { discoverLocalRepos } = await import('../../src/services/repo')
      const root = path.join(projectsRoot, uniqueName('discovery'))
      createCommittedRepo(path.join(root, 'app-one'))
      createCommittedRepo(path.join(root, 'nested', 'app-two'))

      const result = await discoverLocalRepos(db, gitAuth, root)

      expect(result.discoveredCount).toBe(2)
      expect(result.existingCount).toBe(0)
      expect(result.errors).toEqual([])
      expect(result.repos).toHaveLength(2)
    })

    it('keeps existing registrations on a second discovery pass', async () => {
      const { discoverLocalRepos } = await import('../../src/services/repo')
      const root = path.join(projectsRoot, uniqueName('discovery-repeat'))
      createCommittedRepo(path.join(root, 'app-one'))

      const first = await discoverLocalRepos(db, gitAuth, root)
      const second = await discoverLocalRepos(db, gitAuth, root)

      expect(first.discoveredCount).toBe(1)
      expect(second.discoveredCount).toBe(0)
      expect(second.existingCount).toBe(1)
    })

    it('rejects a missing discovery root', async () => {
      const { discoverLocalRepos } = await import('../../src/services/repo')

      await expect(discoverLocalRepos(db, gitAuth, path.join(projectsRoot, 'missing-root'))).rejects.toThrow(/Failed to access/)
    })

    it('rejects a discovery root that is a file', async () => {
      const { discoverLocalRepos } = await import('../../src/services/repo')
      mkdirSync(projectsRoot, { recursive: true })
      const filePath = path.join(projectsRoot, uniqueName('root-file'))
      writeFileSync(filePath, 'file')

      await expect(discoverLocalRepos(db, gitAuth, filePath)).rejects.toThrow(/not a directory/)
    })
  })

  describe('relinkReposFromSessionDirectories', () => {
    it('relinks session directories to real git repo roots', async () => {
      const { relinkReposFromSessionDirectories } = await import('../../src/services/repo')
      const repoRoot = path.join(projectsRoot, uniqueName('relink'))
      createCommittedRepo(repoRoot)
      mkdirSync(path.join(repoRoot, 'apps', 'web'), { recursive: true })
      mkdirSync(path.join(repoRoot, 'packages', 'api'), { recursive: true })
      const notRepo = path.join(projectsRoot, uniqueName('relink-not-repo'))
      mkdirSync(notRepo, { recursive: true })

      const result = await relinkReposFromSessionDirectories(db, gitAuth, [
        path.join(repoRoot, 'apps', 'web'),
        path.join(repoRoot, 'packages', 'api'),
        notRepo,
        '',
      ])

      expect(result.relinkedCount).toBe(1)
      expect(result.existingCount).toBe(0)
      expect(result.duplicatePathCount).toBe(1)
      expect(result.nonRepoPathCount).toBe(2)
      expect(result.errors).toEqual([])
      expect(result.repos).toHaveLength(1)
    })

    it('reports existing registrations on a second relink pass', async () => {
      const { relinkReposFromSessionDirectories } = await import('../../src/services/repo')
      const repoRoot = path.join(projectsRoot, uniqueName('relink-repeat'))
      createCommittedRepo(repoRoot)

      const first = await relinkReposFromSessionDirectories(db, gitAuth, [repoRoot])
      const second = await relinkReposFromSessionDirectories(db, gitAuth, [repoRoot])

      expect(first.relinkedCount).toBe(1)
      expect(second.relinkedCount).toBe(0)
      expect(second.existingCount).toBe(1)
    })
  })

  describe('getCurrentBranch', () => {
    it('reads the branch of a repo with commits', async () => {
      const { getCurrentBranch } = await import('../../src/services/repo')
      const repoPath = path.join(reposPath, uniqueName('branch-commits'))
      createCommittedRepo(repoPath)
      const repo = registerLocalRepo(path.basename(repoPath))

      expect(await getCurrentBranch(repo, {})).toBe('main')
    })

    it('reads the symbolic branch of a repo without commits', async () => {
      const { getCurrentBranch } = await import('../../src/services/repo')
      const repoPath = path.join(reposPath, uniqueName('branch-empty'))
      mkdirSync(repoPath, { recursive: true })
      git(['init', '-b', 'main'], repoPath)
      const repo = registerLocalRepo(path.basename(repoPath))

      expect(await getCurrentBranch(repo, {})).toBe('main')
    })

    it('falls back to the stored branch for a missing path', async () => {
      const { getCurrentBranch } = await import('../../src/services/repo')
      const repo = registerLocalRepo(uniqueName('branch-missing'))

      expect(await getCurrentBranch(repo, {})).toBe('main')
    })
  })

  describe('switchBranch', () => {
    it('switches to an existing local branch and updates the row', async () => {
      const { switchBranch } = await import('../../src/services/repo')
      const repoPath = path.join(reposPath, uniqueName('switch-local'))
      createCommittedRepo(repoPath)
      git(['branch', 'feature'], repoPath)
      const repo = registerLocalRepo(path.basename(repoPath))

      await switchBranch(db, gitAuth, repo.id, 'refs/heads/feature')

      expect(getRepoById(db, repo.id)?.branch).toBe('feature')
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).toBe('feature')
    })

    it('checks out a branch that only exists on the remote', async () => {
      const { switchBranch } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('switch-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('switch-work'))
      createOrigin(origin, work, ['remote-only'])
      const repoPath = path.join(reposPath, uniqueName('switch-remote'))
      cloneOrigin(origin, repoPath)
      const repo = registerLocalRepo(path.basename(repoPath))

      await switchBranch(db, gitAuth, repo.id, 'origin/remote-only')

      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).toBe('remote-only')
    })

    it('creates a branch that exists nowhere when switching', async () => {
      const { switchBranch } = await import('../../src/services/repo')
      const repoPath = path.join(reposPath, uniqueName('switch-new'))
      createCommittedRepo(repoPath)
      const repo = registerLocalRepo(path.basename(repoPath))

      await switchBranch(db, gitAuth, repo.id, 'brand-new')

      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).toBe('brand-new')
    })

    it('rejects switching an unknown repo', async () => {
      const { switchBranch } = await import('../../src/services/repo')

      await expect(switchBranch(db, gitAuth, 9999, 'main')).rejects.toThrow(/Repo not found/)
    })
  })

  describe('createBranch', () => {
    it('creates and switches to a new branch', async () => {
      const { createBranch } = await import('../../src/services/repo')
      const repoPath = path.join(reposPath, uniqueName('create-branch'))
      createCommittedRepo(repoPath)
      const repo = registerLocalRepo(path.basename(repoPath))

      await createBranch(db, gitAuth, repo.id, 'refs/heads/new-branch')

      expect(getRepoById(db, repo.id)?.branch).toBe('new-branch')
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).toBe('new-branch')
    })

    it('rejects creating a branch for an unknown repo', async () => {
      const { createBranch } = await import('../../src/services/repo')

      await expect(createBranch(db, gitAuth, 9999, 'main')).rejects.toThrow(/Repo not found/)
    })
  })

  describe('pullRepo', () => {
    it('skips pulling local repos', async () => {
      const { pullRepo } = await import('../../src/services/repo')
      const repoPath = path.join(reposPath, uniqueName('pull-local'))
      createCommittedRepo(repoPath)
      const repo = registerLocalRepo(path.basename(repoPath))

      await expect(pullRepo(db, gitAuth, repo.id)).resolves.toBeUndefined()
      expect(getRepoById(db, repo.id)?.lastPulled).toBeNull()
    })

    it('pulls a remote-backed repo and records the pull time', async () => {
      const { pullRepo } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('pull-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('pull-work'))
      createOrigin(origin, work)
      const repoPath = path.join(reposPath, uniqueName('pull-remote'))
      cloneOrigin(origin, repoPath)
      const repo = createRepo(db, {
        repoUrl: origin,
        localPath: path.basename(repoPath),
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })

      git(['commit', '--allow-empty', '-m', 'second'], work)
      git(['push', 'origin', 'main'], work)
      await pullRepo(db, gitAuth, repo.id)

      expect(getRepoById(db, repo.id)?.lastPulled).toBeGreaterThan(0)
      expect(git(['rev-parse', 'HEAD'], repoPath)).toBe(git(['rev-parse', 'HEAD'], work))
    })

    it('throws when a remote-backed repo has no upstream', async () => {
      const { pullRepo } = await import('../../src/services/repo')
      const repoPath = path.join(reposPath, uniqueName('pull-fail'))
      createCommittedRepo(repoPath)
      const repo = createRepo(db, {
        repoUrl: `https://example.com/${uniqueName('pull-fail')}.git`,
        localPath: path.basename(repoPath),
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })

      await expect(pullRepo(db, gitAuth, repo.id)).rejects.toThrow()
    })

    it('rejects pulling an unknown repo', async () => {
      const { pullRepo } = await import('../../src/services/repo')

      await expect(pullRepo(db, gitAuth, 9999)).rejects.toThrow(/Repo not found/)
    })
  })

  describe('deleteRepoFiles', () => {
    it('deletes a local repo directory and its row', async () => {
      const { deleteRepoFiles } = await import('../../src/services/repo')
      const repoPath = path.join(reposPath, uniqueName('delete-local'))
      createCommittedRepo(repoPath)
      const repo = registerLocalRepo(path.basename(repoPath))

      await deleteRepoFiles(db, repo.id)

      expect(existsSync(repoPath)).toBe(false)
      expect(getRepoById(db, repo.id)).toBeNull()
    })

    it('removes a worktree repo and its row', async () => {
      const { deleteRepoFiles } = await import('../../src/services/repo')
      const baseName = uniqueName('delete-base')
      const basePath = path.join(reposPath, baseName)
      createCommittedRepo(basePath)
      const worktreePath = path.join(reposPath, `${baseName}-feature`)
      git(['worktree', 'add', '-b', 'feature', worktreePath], basePath)
      const repo = createRepo(db, {
        repoUrl: `https://github.com/example/${baseName}.git`,
        localPath: `${baseName}-feature`,
        branch: 'feature',
        defaultBranch: 'feature',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        isWorktree: true,
      })

      await deleteRepoFiles(db, repo.id)

      expect(existsSync(worktreePath)).toBe(false)
      expect(getRepoById(db, repo.id)).toBeNull()
    })

    it('rejects deleting an unknown repo', async () => {
      const { deleteRepoFiles } = await import('../../src/services/repo')

      await expect(deleteRepoFiles(db, 9999)).rejects.toThrow(/Repo not found/)
    })
  })

  describe('cloneRepo', () => {
    it('clones a repo from a local bare origin', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('clone-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('clone-work'))
      createOrigin(origin, work)
      const name = uniqueName('clone-target')

      const repo = await cloneRepo(db, gitAuth, origin, { directoryName: name })

      expect(repo.cloneStatus).toBe('ready')
      expect(existsSync(path.join(reposPath, name, '.git'))).toBe(true)
      expect(getRepoById(db, repo.id)?.cloneStatus).toBe('ready')
    })

    it('returns the existing repo for the same url and branch', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('clone-dup-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('clone-dup-work'))
      createOrigin(origin, work)
      const first = await cloneRepo(db, gitAuth, origin, { directoryName: uniqueName('clone-dup-first'), branch: 'main' })

      const second = await cloneRepo(db, gitAuth, origin, { directoryName: uniqueName('clone-dup-second'), branch: 'main' })

      expect(second.id).toBe(first.id)
    })

    it('clones a branch that exists on the origin', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('clone-branch-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('clone-branch-work'))
      createOrigin(origin, work, ['feature'])
      const name = uniqueName('clone-branch')

      await cloneRepo(db, gitAuth, origin, { directoryName: name, branch: 'feature' })

      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], path.join(reposPath, name))).toBe('feature')
    })

    it('clones the default branch and creates a missing branch locally', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('clone-missing-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('clone-missing-work'))
      createOrigin(origin, work)
      const name = uniqueName('clone-missing-branch')

      await cloneRepo(db, gitAuth, origin, { directoryName: name, branch: 'ghost' })

      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], path.join(reposPath, name))).toBe('ghost')
    })

    it('creates a worktree clone when the base repo already exists', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('clone-wt-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('clone-wt-work'))
      createOrigin(origin, work)
      const baseName = uniqueName('clone-wt-base')
      await cloneRepo(db, gitAuth, origin, { directoryName: baseName })
      const branchName = uniqueName('wt-branch')

      const repo = await cloneRepo(db, gitAuth, origin, { directoryName: baseName, branch: branchName, useWorktree: true })

      expect(repo.isWorktree).toBe(true)
      expect(existsSync(path.join(reposPath, `${baseName}-${branchName}`))).toBe(true)
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], path.join(reposPath, `${baseName}-${branchName}`))).toBe(branchName)
    })

    it('reuses a valid existing base repo directory and checks out a local branch', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('clone-reuse-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('clone-reuse-work'))
      createOrigin(origin, work)
      const baseName = uniqueName('clone-reuse-base')
      cloneOrigin(origin, path.join(reposPath, baseName))

      await cloneRepo(db, gitAuth, origin, { directoryName: baseName, branch: 'main' })

      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], path.join(reposPath, baseName))).toBe('main')
    })

    it('checks out a remote-only branch in an existing base repo', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('clone-remote-only-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('clone-remote-only-work'))
      createOrigin(origin, work, ['remote-only'])
      const baseName = uniqueName('clone-remote-only-base')
      cloneOrigin(origin, path.join(reposPath, baseName))

      await cloneRepo(db, gitAuth, origin, { directoryName: baseName, branch: 'remote-only' })

      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], path.join(reposPath, baseName))).toBe('remote-only')
    })

    it('creates a new local branch in an existing base repo', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('clone-new-branch-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('clone-new-branch-work'))
      createOrigin(origin, work)
      const baseName = uniqueName('clone-new-branch-base')
      cloneOrigin(origin, path.join(reposPath, baseName))

      await cloneRepo(db, gitAuth, origin, { directoryName: baseName, branch: 'fresh' })

      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], path.join(reposPath, baseName))).toBe('fresh')
    })

    it('rejects a base directory holding a different repository', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('clone-collide-origin.git'))
      const originWork = path.join(workspaceRoot, uniqueName('clone-collide-origin-work'))
      createOrigin(origin, originWork)
      const otherOrigin = path.join(workspaceRoot, uniqueName('clone-collide-other.git'))
      const otherWork = path.join(workspaceRoot, uniqueName('clone-collide-other-work'))
      createOrigin(otherOrigin, otherWork)
      const baseName = uniqueName('clone-collide')
      cloneOrigin(otherOrigin, path.join(reposPath, baseName))

      await expect(cloneRepo(db, gitAuth, origin, { directoryName: baseName })).rejects.toMatchObject({ statusCode: 409 })
    })

    it('removes an invalid base directory and reclones', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('clone-invalid-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('clone-invalid-work'))
      createOrigin(origin, work)
      const baseName = uniqueName('clone-invalid')
      mkdirSync(path.join(reposPath, baseName), { recursive: true })
      writeFileSync(path.join(reposPath, baseName, 'stray.txt'), 'stray')

      const repo = await cloneRepo(db, gitAuth, origin, { directoryName: baseName })

      expect(repo.cloneStatus).toBe('ready')
      expect(existsSync(path.join(reposPath, baseName, '.git'))).toBe(true)
    })

    it('enhances a missing local clone error and rolls back the row', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const name = uniqueName('clone-missing-source')

      await expect(cloneRepo(db, gitAuth, path.join(workspaceRoot, 'no-such-origin'), { directoryName: name })).rejects.toThrow(/does not exist/)
      expect(getRepoByLocalPath(db, name)).toBeNull()
    })

    it('maps a repository-not-found clone failure', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const name = uniqueName('clone-not-found')

      await withTlsServer(404, async (port) => {
        const url = `https://127.0.0.1:${port}/404/repo-missing.git`
        process.env.GIT_SSL_NO_VERIFY = 'true'
        try {
          await expect(cloneRepo(db, gitAuth, url, { directoryName: name })).rejects.toThrow(/Repository not found/)
        } finally {
          delete process.env.GIT_SSL_NO_VERIFY
        }
      })

      expect(getRepoByLocalPath(db, name)).toBeNull()
    })

    it('maps an authentication clone failure', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const name = uniqueName('clone-auth')

      await withTlsServer(401, async (port) => {
        const url = `https://user:pass@127.0.0.1:${port}/repo-auth.git`
        process.env.GIT_SSL_NO_VERIFY = 'true'
        try {
          await expect(cloneRepo(db, gitAuth, url, { directoryName: name })).rejects.toThrow(/Authentication failed/)
        } finally {
          delete process.env.GIT_SSL_NO_VERIFY
        }
      })

      expect(getRepoByLocalPath(db, name)).toBeNull()
    })

    it('maps an ssh permission-denied clone failure', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const sshScript = path.join(workspaceRoot, uniqueName('fake-ssh.sh'))
      writeFileSync(sshScript, '#!/bin/sh\necho "Permission denied (publickey)." >&2\nexit 255\n')
      chmodSync(sshScript, 0o755)
      const sshAuth = createGitAuthService({ GIT_SSH_COMMAND: sshScript, GIT_TERMINAL_PROMPT: '0' })
      const name = uniqueName('clone-ssh')

      await expect(cloneRepo(db, sshAuth, 'ssh://git@example.invalid/owner/repo.git', { directoryName: name })).rejects.toThrow(/Access denied/)
      expect(getRepoByLocalPath(db, name)).toBeNull()
    })

    it('maps a scp-style ssh permission-denied clone failure', async () => {
      const { cloneRepo } = await import('../../src/services/repo')
      const sshScript = path.join(workspaceRoot, uniqueName('fake-scp-ssh.sh'))
      writeFileSync(sshScript, '#!/bin/sh\necho "Permission denied (publickey)." >&2\nexit 255\n')
      chmodSync(sshScript, 0o755)
      const sshAuth = createGitAuthService({ GIT_SSH_COMMAND: sshScript, GIT_TERMINAL_PROMPT: '0' })
      const name = uniqueName('clone-scp')

      await expect(cloneRepo(db, sshAuth, 'git@example.invalid:owner/repo.git', { directoryName: name })).rejects.toThrow(/Access denied/)
      expect(getRepoByLocalPath(db, name)).toBeNull()
    })
  })

  describe('worktree helpers', () => {
    it('creates a worktree for a new branch and removes it', async () => {
      const { createWorktreeSafely, removeWorktree } = await import('../../src/services/repo')
      const basePath = path.join(reposPath, uniqueName('wt-base'))
      createCommittedRepo(basePath)
      const worktreePath = path.join(reposPath, `${path.basename(basePath)}-feature`)

      await createWorktreeSafely(basePath, worktreePath, 'feature', {})
      expect(existsSync(worktreePath)).toBe(true)

      await removeWorktree(basePath, worktreePath)
      expect(existsSync(worktreePath)).toBe(false)
    })

    it('creates a worktree for an existing branch', async () => {
      const { createWorktreeSafely } = await import('../../src/services/repo')
      const basePath = path.join(reposPath, uniqueName('wt-existing-base'))
      createCommittedRepo(basePath)
      git(['branch', 'feature'], basePath)
      const worktreePath = path.join(reposPath, `${path.basename(basePath)}-existing`)

      await createWorktreeSafely(basePath, worktreePath, 'feature', {})

      expect(existsSync(worktreePath)).toBe(true)
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)).toBe('feature')
    })

    it('switches off the requested branch before creating its worktree', async () => {
      const { createWorktreeSafely } = await import('../../src/services/repo')
      const basePath = path.join(reposPath, uniqueName('wt-switch-base'))
      createCommittedRepo(basePath)
      git(['checkout', '-b', 'feature'], basePath)
      const worktreePath = path.join(reposPath, `${path.basename(basePath)}-switch`)

      await createWorktreeSafely(basePath, worktreePath, 'feature', {})

      expect(existsSync(worktreePath)).toBe(true)
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)).toBe('feature')
    })

    it('resolves the default branch from origin HEAD and falls back to main', async () => {
      const { resolveDefaultBranch } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('default-branch-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('default-branch-work'))
      createOrigin(origin, work)
      const clonePath = path.join(workspaceRoot, uniqueName('default-branch-clone'))
      cloneOrigin(origin, clonePath)
      git(['remote', 'set-head', 'origin', '--auto'], clonePath)

      expect(await resolveDefaultBranch(clonePath, {})).toBe('main')
      expect(await resolveDefaultBranch(path.join(workspaceRoot, 'no-such-path'), {})).toBe('main')
    })
  })

  describe('mirror helpers', () => {
    it('plans and ensures a mirror worktree', async () => {
      const { ensureMirrorTarget, planMirrorTarget } = await import('../../src/services/repo')
      const baseName = uniqueName('mirror-base')
      const basePath = path.join(reposPath, baseName)
      createCommittedRepo(basePath)
      const base = registerLocalRepo(baseName)

      const inPlace = await planMirrorTarget(db, base, 'main')
      expect(inPlace.kind).toBe('in-place')

      const planned = await planMirrorTarget(db, base, 'feature/x')
      expect(planned.kind).toBe('new')

      const created = await ensureMirrorTarget(db, base, 'feature/x')
      expect(created.created).toBe(true)
      expect(existsSync(created.repo.fullPath)).toBe(true)

      const existing = await ensureMirrorTarget(db, base, 'feature/x')
      expect(existing.created).toBe(false)
      expect(existing.repo.id).toBe(created.repo.id)
    })

    it('resolves the base directory name from a worktree repo row', async () => {
      const { ensureMirrorTarget, planMirrorTarget } = await import('../../src/services/repo')
      const baseName = uniqueName('mirror-name-base')
      const basePath = path.join(reposPath, baseName)
      createCommittedRepo(basePath)
      const base = registerLocalRepo(baseName)
      const created = await ensureMirrorTarget(db, base, 'feature/x')

      const planned = await planMirrorTarget(db, created.repo, 'other')

      expect(planned).toMatchObject({ kind: 'new', localPath: `${baseName}-other` })
    })

    it('creates a unique mirror target path', async () => {
      const { ensureMirrorTargetPath } = await import('../../src/services/repo')
      const name = uniqueName('Mirror Name')
      const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
      const first = ensureMirrorTargetPath(name)
      expect(first.localPath).toBe(slug)

      mkdirSync(first.fullPath, { recursive: true })
      const second = ensureMirrorTargetPath(name)
      expect(second.localPath).toBe(`${slug}-2`)
    })

    it('creates and reuses repo rows', async () => {
      const { createRepoRow } = await import('../../src/services/repo')
      const localPath = uniqueName('row-local')
      const first = createRepoRow(db, { name: 'local', localPath, fullPath: path.join(reposPath, localPath) })
      expect(first.created).toBe(true)

      const again = createRepoRow(db, { name: 'local', localPath, fullPath: path.join(reposPath, localPath) })
      expect(again.created).toBe(false)

      const originUrl = `https://example.com/${uniqueName('row-remote')}.git`
      const remote = createRepoRow(db, { name: 'remote', originUrl, localPath: uniqueName('row-remote-path'), fullPath: '/tmp/remote', branch: 'main' })
      expect(remote.created).toBe(true)

      const remoteAgain = createRepoRow(db, { name: 'remote', originUrl, localPath: uniqueName('row-remote-path-2'), fullPath: '/tmp/remote-2', branch: 'main' })
      expect(remoteAgain.created).toBe(false)
    })

    it('reports repos as not in use', async () => {
      const { isRepoInUse } = await import('../../src/services/repo')
      const repoPath = path.join(reposPath, uniqueName('in-use'))
      createCommittedRepo(repoPath)
      const repo = registerLocalRepo(path.basename(repoPath))

      expect(isRepoInUse(db, repo.id)).toBe(false)
      expect(isRepoInUse(db, 9999)).toBe(false)
    })
  })

  describe('getSiblingRepos', () => {
    it('returns an empty list for an unknown repo', async () => {
      const { getSiblingRepos } = await import('../../src/services/repo')

      expect(await getSiblingRepos(db, 9999, {})).toEqual([])
    })

    it('returns an empty list for a repo that is not ready', async () => {
      const { getSiblingRepos } = await import('../../src/services/repo')
      const repoPath = path.join(reposPath, uniqueName('sibling-cloning'))
      createCommittedRepo(repoPath)
      const repo = createRepo(db, {
        isLocal: true,
        localPath: path.basename(repoPath),
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'cloning',
        clonedAt: Date.now(),
      })

      expect(await getSiblingRepos(db, repo.id, {})).toEqual([])
    })

    it('returns an empty list when the project id cannot be resolved', async () => {
      const { getSiblingRepos } = await import('../../src/services/repo')
      const repoPath = path.join(reposPath, uniqueName('sibling-not-git'))
      mkdirSync(repoPath, { recursive: true })
      const repo = createRepo(db, {
        isLocal: true,
        localPath: path.basename(repoPath),
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })

      expect(await getSiblingRepos(db, repo.id, {})).toEqual([])
    })

    it('returns repos sharing the same origin project', async () => {
      const { getSiblingRepos } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('sibling-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('sibling-work'))
      createOrigin(origin, work)
      const repoA = path.join(reposPath, uniqueName('sibling-a'))
      const repoB = path.join(reposPath, uniqueName('sibling-b'))
      cloneOrigin(origin, repoA)
      cloneOrigin(origin, repoB)
      const a = createRepo(db, {
        isLocal: true,
        localPath: path.basename(repoA),
        sourcePath: repoA,
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })
      const b = createRepo(db, {
        isLocal: true,
        localPath: path.basename(repoB),
        sourcePath: repoB,
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })

      const siblings = await getSiblingRepos(db, a.id, {})

      expect(siblings.map((repo) => repo.id).sort()).toEqual([a.id, b.id].sort())
      expect(siblings.every((repo) => repo.currentBranch === 'main')).toBe(true)
    })

    it('adds filtered workspace siblings from the OpenCode client', async () => {
      const { getSiblingRepos } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('sibling-ws-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('sibling-ws-work'))
      createOrigin(origin, work)
      const repoA = path.join(reposPath, uniqueName('sibling-ws-a'))
      const repoB = path.join(reposPath, uniqueName('sibling-ws-b'))
      cloneOrigin(origin, repoA)
      cloneOrigin(origin, repoB)
      const a = createRepo(db, {
        isLocal: true,
        localPath: path.basename(repoA),
        sourcePath: repoA,
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })
      createRepo(db, {
        isLocal: true,
        localPath: path.basename(repoB),
        sourcePath: repoB,
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })
      const projectId = (await resolveOpenCodeProjectId(repoA))!
      const extraDir = path.join(workspaceRoot, uniqueName('sibling-ws-extra'))
      const duplicateDir = path.join(workspaceRoot, uniqueName('sibling-ws-duplicate'))
      const activeWorktree = path.join(workspaceRoot, uniqueName('sibling-ws-active'))
      const activeWorkspace = path.join(workspaceRoot, uniqueName('sibling-ws-active-dir'))
      mkdirSync(extraDir, { recursive: true })
      mkdirSync(duplicateDir, { recursive: true })
      mkdirSync(activeWorktree, { recursive: true })
      mkdirSync(activeWorkspace, { recursive: true })
      const scheduleDir = path.join(getScheduleWorktreesPath(), uniqueName('sibling-ws-schedule'))
      db.prepare('INSERT INTO schedule_runs (job_id, repo_id, trigger_source, status, started_at, created_at, worktree_path) VALUES (?, ?, ?, ?, ?, ?, ?)').run(1, a.id, 'manual', 'running', Date.now(), Date.now(), activeWorktree)
      db.prepare('INSERT INTO schedule_runs (job_id, repo_id, trigger_source, status, started_at, created_at, worktree_path) VALUES (?, ?, ?, ?, ?, ?, ?)').run(1, a.id, 'manual', 'running', Date.now(), Date.now(), activeWorkspace)
      const client = {
        api: {
          location: {
            get: async () => ({ directory: repoA, project: { id: projectId, directory: repoA, canonical: repoA } }),
          },
          worktree: {
            list: async () => [
              { directory: extraDir, strategy: 'git' },
              { directory: duplicateDir, strategy: 'git' },
              { directory: duplicateDir, strategy: 'git' },
              { directory: repoA, strategy: 'git' },
              { directory: getReposPath(), strategy: 'git' },
              { directory: scheduleDir, strategy: 'git' },
              { directory: activeWorktree, strategy: 'git' },
              { directory: activeWorkspace, strategy: 'git' },
            ],
          },
        },
      } as unknown as OpenCodeClient

      const siblings = await getSiblingRepos(db, a.id, {}, client) as SiblingRepo[]
      const worktreeSiblings = siblings.filter((repo) => isWorktreeSibling(repo))

      expect(worktreeSiblings.map((repo) => repo.fullPath)).toEqual([extraDir, duplicateDir])
      expect(worktreeSiblings.every((repo) => repo.id === -1)).toBe(true)
      expect(worktreeSiblings.every((repo) => repo.localPath === path.basename(repo.fullPath))).toBe(true)
      expect(worktreeSiblings.every((repo) => repo.worktreeStrategy === 'git')).toBe(true)
      expect(worktreeSiblings.every((repo) => repo.branch === undefined && repo.currentBranch === undefined)).toBe(true)
    })

    it('returns repo siblings when the OpenCode client fails', async () => {
      const { getSiblingRepos } = await import('../../src/services/repo')
      const origin = path.join(workspaceRoot, uniqueName('sibling-err-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('sibling-err-work'))
      createOrigin(origin, work)
      const repoA = path.join(reposPath, uniqueName('sibling-err-a'))
      cloneOrigin(origin, repoA)
      const a = createRepo(db, {
        isLocal: true,
        localPath: path.basename(repoA),
        sourcePath: repoA,
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })
      const client = {
        api: {
          location: {
            get: async () => {
              throw new Error('upstream unavailable')
            },
          },
          worktree: {
            list: async () => [],
          },
        },
      } as unknown as OpenCodeClient

      const siblings = await getSiblingRepos(db, a.id, {}, client) as SiblingRepo[]

      expect(siblings.some((repo) => repo.id === a.id)).toBe(true)
      expect(siblings.some((repo) => isWorktreeSibling(repo))).toBe(false)
    })

    it('resolves the project id with the shared resolver', async () => {
      const origin = path.join(workspaceRoot, uniqueName('sibling-resolver-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('sibling-resolver-work'))
      createOrigin(origin, work)
      const repoPath = path.join(reposPath, uniqueName('sibling-resolver'))
      cloneOrigin(origin, repoPath)

      expect(await resolveOpenCodeProjectId(repoPath)).toMatch(/^[0-9a-f]{40}$/)
    })
  })
})
