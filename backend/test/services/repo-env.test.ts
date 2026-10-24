import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import { createGitService } from '../../src/services/git/GitService'
import { ProjectConfigService } from '../../src/services/project-config'
import { SecretsService } from '../../src/services/secrets'
import { RepoEnvService } from '../../src/services/repo-env'
import { deleteRepoFiles } from '../../src/services/repo'
import { invalidateRepoEnvCache } from '../../src/utils/repo-env-cache'
import { executeCommand } from '../../src/utils/process'
import { logger } from '../../src/utils/logger'
import type { GitAuthService } from '../../src/services/git-auth'
import type { Repo } from '@opencode-manager/shared/types'

vi.mock('../../src/utils/process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/process')>()
  return { ...actual, executeCommand: vi.fn(actual.executeCommand) }
})

const gitAuthService = { getGitEnvironment: () => ({}) } as unknown as GitAuthService

const EMPTY = { env: {}, maskValues: [] }

function topLevelProbes(): number {
  return vi.mocked(executeCommand).mock.calls.filter(([args]) => args.includes('--show-toplevel')).length
}

describe('RepoEnvService', () => {
  let db: Database
  let projectConfigService: ProjectConfigService
  let secretsService: SecretsService
  let repoEnvService: RepoEnvService
  let tempDirs: string[]

  function createTempDir(prefix: string): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
    tempDirs.push(dir)
    return dir
  }

  function initGitRepo(dir: string): void {
    execSync(`git init "${dir}"`)
    execSync(`git -C "${dir}" config user.email test@test.com`)
    execSync(`git -C "${dir}" config user.name Test`)
    execSync(`git -C "${dir}" commit --allow-empty -m "Initial commit"`)
  }

  function writeProjectFile(dir: string, content: unknown): void {
    const filePath = path.join(dir, '.ocm', 'project.json')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2))
  }

  function registerRepo(dir: string): Repo {
    return createRepo(db, {
      localPath: dir,
      sourcePath: dir,
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    })
  }

  async function trust(dir: string, repo: Repo): Promise<void> {
    const hash = projectConfigService.readRepoFile(dir).hash
    await projectConfigService.trustRepoFile(repo, dir, hash ?? '')
  }

  beforeEach(() => {
    vi.mocked(executeCommand).mockClear()
    db = new Database(':memory:')
    migrate(db, allMigrations)
    projectConfigService = new ProjectConfigService(db, createGitService(gitAuthService), gitAuthService)
    secretsService = new SecretsService(db)
    repoEnvService = new RepoEnvService(db, projectConfigService, secretsService)
    tempDirs = []
  })

  afterEach(() => {
    db.close()
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves a trusted mapping with secret precedence and the selected environment', async () => {
    const root = createTempDir('ocm-repo-env-')
    initGitRepo(root)
    const repo = registerRepo(root)
    writeProjectFile(root, {
      version: 1,
      environment: 'prod',
      env: {
        API_URL: 'https://${{ vars.HOST }}/${{ secrets.TOKEN }}',
        PLAIN: 'literal',
      },
    })
    secretsService.set('variable', repo.id, 'prod', 'HOST', 'example.com')
    secretsService.set('secret', repo.id, null, 'TOKEN', 'repo-token')
    secretsService.set('secret', repo.id, 'prod', 'TOKEN', 'prod-token')
    await trust(root, repo)

    const result = await repoEnvService.resolveForDirectory(root)

    expect(result.env).toEqual({
      API_URL: 'https://example.com/prod-token',
      PLAIN: 'literal',
    })
    expect(result.maskValues).toEqual(['prod-token'])
  })

  it('returns an empty result for an untrusted mapping', async () => {
    const root = createTempDir('ocm-repo-env-')
    initGitRepo(root)
    const repo = registerRepo(root)
    writeProjectFile(root, { version: 1, env: { TOKEN: '${{ secrets.TOKEN }}' } })
    secretsService.set('secret', repo.id, null, 'TOKEN', 'prod-token')

    expect(await repoEnvService.resolveForDirectory(root)).toEqual(EMPTY)
  })

  it('returns an empty result when the file has no env mapping', async () => {
    const root = createTempDir('ocm-repo-env-')
    initGitRepo(root)
    const repo = registerRepo(root)
    writeProjectFile(root, { version: 1, projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }] })
    await trust(root, repo)

    expect(await repoEnvService.resolveForDirectory(root)).toEqual(EMPTY)
  })

  it('resolves from a subdirectory of the checkout', async () => {
    const root = createTempDir('ocm-repo-env-')
    initGitRepo(root)
    const repo = registerRepo(root)
    writeProjectFile(root, { version: 1, env: { PLAIN: 'literal' } })
    await trust(root, repo)
    const nested = path.join(root, 'packages', 'app')
    fs.mkdirSync(nested, { recursive: true })

    const result = await repoEnvService.resolveForDirectory(nested)

    expect(result.env).toEqual({ PLAIN: 'literal' })
  })

  it('resolves a git worktree outside the repository folder to the main repo', async () => {
    const root = createTempDir('ocm-repo-env-')
    initGitRepo(root)
    writeProjectFile(root, { version: 1, env: { PLAIN: 'literal' } })
    execSync(`git -C "${root}" add -A`)
    execSync(`git -C "${root}" commit -m "Add project config"`)
    const repo = registerRepo(root)
    await trust(root, repo)
    const worktreePath = createTempDir('ocm-repo-env-worktree-')
    fs.rmSync(worktreePath, { recursive: true, force: true })
    execSync(`git -C "${root}" worktree add -b feature "${worktreePath}"`)

    const result = await repoEnvService.resolveForDirectory(worktreePath)

    expect(result.env).toEqual({ PLAIN: 'literal' })
  })

  it('returns an empty result for a non-git directory', async () => {
    const plain = createTempDir('ocm-repo-env-plain-')

    expect(await repoEnvService.resolveForDirectory(plain)).toEqual(EMPTY)
  })

  it('resolves missing references to an empty string', async () => {
    const root = createTempDir('ocm-repo-env-')
    initGitRepo(root)
    const repo = registerRepo(root)
    writeProjectFile(root, {
      version: 1,
      env: { MISSING: '${{ secrets.NOPE }}-${{ vars.NOPE2 }}' },
    })
    await trust(root, repo)

    const result = await repoEnvService.resolveForDirectory(root)

    expect(result.env).toEqual({ MISSING: '-' })
  })

  it('excludes vars and short secret values from maskValues', async () => {
    const root = createTempDir('ocm-repo-env-')
    initGitRepo(root)
    const repo = registerRepo(root)
    writeProjectFile(root, {
      version: 1,
      env: {
        LONG: '${{ secrets.LONG }}',
        SHORT: '${{ secrets.SHORT }}',
        FROM_VAR: '${{ vars.VAR }}',
      },
    })
    secretsService.set('secret', repo.id, null, 'LONG', 'longvalue')
    secretsService.set('secret', repo.id, null, 'SHORT', 'abc')
    secretsService.set('variable', repo.id, null, 'VAR', 'variablevalue')
    await trust(root, repo)

    const result = await repoEnvService.resolveForDirectory(root)

    expect(result.maskValues).toEqual(['longvalue'])
  })

  it('returns an empty result and warns when the secrets resolver fails', async () => {
    const root = createTempDir('ocm-repo-env-')
    initGitRepo(root)
    const repo = registerRepo(root)
    writeProjectFile(root, { version: 1, env: { TOKEN: '${{ secrets.TOKEN }}' } })
    await trust(root, repo)
    vi.spyOn(secretsService, 'resolveValues').mockImplementation(() => {
      throw new Error('boom')
    })
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

    expect(await repoEnvService.resolveForDirectory(root)).toEqual(EMPTY)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(root), expect.anything())

    warn.mockRestore()
  })

  describe('caching', () => {
    async function createTrustedRepo(env: Record<string, string>): Promise<{ root: string; repo: Repo }> {
      const root = createTempDir('ocm-repo-env-')
      initGitRepo(root)
      const repo = registerRepo(root)
      writeProjectFile(root, { version: 1, env })
      await trust(root, repo)
      return { root, repo }
    }

    it('reuses the directory resolution within the TTL without spawning git', async () => {
      const { root } = await createTrustedRepo({ PLAIN: 'literal' })

      await repoEnvService.resolveForDirectory(root)
      const probes = topLevelProbes()
      expect(probes).toBeGreaterThan(0)

      const result = await repoEnvService.resolveForDirectory(root)

      expect(result.env).toEqual({ PLAIN: 'literal' })
      expect(topLevelProbes()).toBe(probes)
    })

    it('caches misses for directories without a repository', async () => {
      const plain = createTempDir('ocm-repo-env-plain-')

      expect(await repoEnvService.resolveForDirectory(plain)).toEqual(EMPTY)
      const probes = topLevelProbes()

      expect(await repoEnvService.resolveForDirectory(plain)).toEqual(EMPTY)
      expect(topLevelProbes()).toBe(probes)
    })

    it('re-reads the project file when it changes', async () => {
      const { root, repo } = await createTrustedRepo({ PLAIN: 'first' })
      expect((await repoEnvService.resolveForDirectory(root)).env).toEqual({ PLAIN: 'first' })
      const probes = topLevelProbes()

      writeProjectFile(root, { version: 1, env: { PLAIN: 'second-value' } })
      await trust(root, repo)

      expect((await repoEnvService.resolveForDirectory(root)).env).toEqual({ PLAIN: 'second-value' })
      expect(topLevelProbes()).toBe(probes)
    })

    it('applies a trust decision made after the file was cached', async () => {
      const root = createTempDir('ocm-repo-env-')
      initGitRepo(root)
      const repo = registerRepo(root)
      writeProjectFile(root, { version: 1, env: { PLAIN: 'literal' } })

      expect(await repoEnvService.resolveForDirectory(root)).toEqual(EMPTY)

      await trust(root, repo)

      expect((await repoEnvService.resolveForDirectory(root)).env).toEqual({ PLAIN: 'literal' })
    })

    it('applies secret edits made after the directory was cached', async () => {
      const { root, repo } = await createTrustedRepo({ TOKEN: '${{ secrets.TOKEN }}' })
      secretsService.set('secret', repo.id, null, 'TOKEN', 'first-token')

      expect((await repoEnvService.resolveForDirectory(root)).env).toEqual({ TOKEN: 'first-token' })

      secretsService.set('secret', repo.id, null, 'TOKEN', 'second-token')

      const result = await repoEnvService.resolveForDirectory(root)
      expect(result.env).toEqual({ TOKEN: 'second-token' })
      expect(result.maskValues).toEqual(['second-token'])
    })

    it('invalidates the cached miss when the repository is registered', async () => {
      const root = createTempDir('ocm-repo-env-')
      initGitRepo(root)
      writeProjectFile(root, { version: 1, env: { PLAIN: 'literal' } })

      expect(await repoEnvService.resolveForDirectory(root)).toEqual(EMPTY)

      const repo = registerRepo(root)
      await trust(root, repo)

      expect((await repoEnvService.resolveForDirectory(root)).env).toEqual({ PLAIN: 'literal' })
    })

    it('invalidates the cached resolution when the repository is deleted', async () => {
      const { root, repo } = await createTrustedRepo({ PLAIN: 'literal' })
      expect((await repoEnvService.resolveForDirectory(root)).env).toEqual({ PLAIN: 'literal' })
      const probes = topLevelProbes()

      await deleteRepoFiles(db, repo.id)

      expect(await repoEnvService.resolveForDirectory(root)).toEqual(EMPTY)
      expect(topLevelProbes()).toBeGreaterThan(probes)
    })

    it('invalidates the cached resolution when the repo environment cache is reset', async () => {
      const { root } = await createTrustedRepo({ PLAIN: 'literal' })
      expect((await repoEnvService.resolveForDirectory(root)).env).toEqual({ PLAIN: 'literal' })
      const probes = topLevelProbes()

      invalidateRepoEnvCache()

      expect((await repoEnvService.resolveForDirectory(root)).env).toEqual({ PLAIN: 'literal' })
      expect(topLevelProbes()).toBeGreaterThan(probes)
    })
  })
})
