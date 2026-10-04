import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
import { createRepo, getRepoByDirectory, getRepoById } from '../../../src/db/queries'
import { createScheduleJob, listScheduleJobsByRepo } from '../../../src/db/schedules'
import { createGitService, GitIntegrationConflictError, type GitService } from '../../../src/services/git/GitService'
import { createWorktreeSafely } from '../../../src/services/repo'
import type { ScheduleJobPersistenceInput } from '../../../src/services/schedule-config'
import { createRepoRoutes } from '../../../src/routes/repos'
import { createStubOpenCodeClient } from '../../helpers/stub-opencode-client'
import { cloneOrigin, createCommittedRepo, createGitAuthService, createOrigin, git, uniqueName } from '../../helpers/git-fixtures'
import { GitOperationError, parseGitError } from '../../../src/utils/git-errors'
import type { GitAuthService } from '../../../src/services/git-auth'
import type { Repo } from '../../../src/types/repo'

const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'git-service-real-'))
process.env.WORKSPACE_PATH = workspaceRoot
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CONFIG_GLOBAL = '/dev/null'

const reposPath = path.join(workspaceRoot, 'repos')

function scheduleJobInput(name: string, branch: string): ScheduleJobPersistenceInput {
  return {
    name,
    description: null,
    enabled: true,
    scheduleMode: 'interval',
    intervalMinutes: 60,
    cronExpression: null,
    timezone: null,
    agentSlug: null,
    prompt: 'do work',
    model: null,
    skillMetadata: null,
    permissionConfig: null,
    mcpServers: [],
    branch,
    nextRunAt: null,
  }
}

describe('GitService real git', () => {
  let db: Database
  let gitAuth: GitAuthService
  let service: GitService

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    gitAuth = createGitAuthService()
    service = createGitService(gitAuth)
    rmSync(reposPath, { recursive: true, force: true })
    mkdirSync(reposPath, { recursive: true })
  })

  afterEach(() => {
    db.close()
  })

  afterAll(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  function registerClone(origin: string, repoPath: string, branch = 'main'): Repo {
    return createRepo(db, {
      repoUrl: origin,
      localPath: path.basename(repoPath),
      branch,
      defaultBranch: branch,
      cloneStatus: 'ready',
      clonedAt: Date.now(),
    })
  }

  describe('getRepoByDirectory', () => {
    it('matches a repo row through a symlinked path', () => {
      const realPath = path.join(workspaceRoot, uniqueName('symlink-real'))
      mkdirSync(realPath, { recursive: true })
      const repo = createRepo(db, {
        isLocal: true,
        localPath: path.basename(realPath),
        sourcePath: realPath,
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })

      const aliasPath = path.join(workspaceRoot, uniqueName('symlink-alias'))
      symlinkSync(realPath, aliasPath)

      expect(getRepoByDirectory(db, aliasPath)?.id).toBe(repo.id)
    })
  })

  describe('renameBranch', () => {
    it('renames the checked-out branch and updates the repo row', async () => {
      const origin = path.join(workspaceRoot, uniqueName('rename-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('rename-work'))
      createOrigin(origin, work)
      const repoPath = path.join(reposPath, uniqueName('rename-clone'))
      cloneOrigin(origin, repoPath)
      const repo = registerClone(origin, repoPath)

      await service.renameBranch(repo.id, 'main', 'renamed', db)

      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).toBe('renamed')
      expect(git(['branch', '--list', 'renamed'], repoPath)).toContain('renamed')
      expect(getRepoById(db, repo.id)?.branch).toBe('renamed')
    })

    it('leaves the repo row unchanged when renaming another branch', async () => {
      const origin = path.join(workspaceRoot, uniqueName('rename-other-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('rename-other-work'))
      createOrigin(origin, work)
      const repoPath = path.join(reposPath, uniqueName('rename-other-clone'))
      cloneOrigin(origin, repoPath)
      git(['branch', 'feature'], repoPath)
      const repo = registerClone(origin, repoPath)

      await service.renameBranch(repo.id, 'feature', 'feature-renamed', db)

      expect(git(['branch', '--list', 'feature-renamed'], repoPath)).toContain('feature-renamed')
      expect(getRepoById(db, repo.id)?.branch).toBe('main')
    })

    it('rejects an option-like source branch and preserves refs', async () => {
      const origin = path.join(workspaceRoot, uniqueName('rename-force-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('rename-force-work'))
      createOrigin(origin, work)
      const repoPath = path.join(reposPath, uniqueName('rename-force-clone'))
      cloneOrigin(origin, repoPath)
      git(['branch', 'victim'], repoPath)
      const victimBefore = git(['rev-parse', 'victim'], repoPath)
      const repo = registerClone(origin, repoPath)

      const error = await service
        .renameBranch(repo.id, '--force', 'victim', db)
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(Error)
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).toBe('main')
      expect(git(['branch', '--list', 'main'], repoPath)).toContain('main')
      expect(git(['branch', '--list', 'victim'], repoPath)).toContain('victim')
      expect(git(['rev-parse', 'victim'], repoPath)).toBe(victimBefore)
      expect(getRepoById(db, repo.id)?.branch).toBe('main')
    })

    it('rejects renaming a branch checked out in another worktree', async () => {
      const origin = path.join(workspaceRoot, uniqueName('rename-wt-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('rename-wt-work'))
      createOrigin(origin, work)
      const baseRepoPath = path.join(reposPath, uniqueName('rename-wt-base'))
      cloneOrigin(origin, baseRepoPath)
      const baseRepo = registerClone(origin, baseRepoPath)

      const worktreeName = uniqueName('rename-wt-feature')
      const worktreePath = path.join(reposPath, worktreeName)
      git(['worktree', 'add', '-b', 'feature', worktreePath], baseRepoPath)
      const worktreeRepo = createRepo(db, {
        repoUrl: origin,
        localPath: worktreeName,
        branch: 'feature',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        isWorktree: true,
      })

      const error = await service
        .renameBranch(baseRepo.id, 'feature', 'feature-renamed', db)
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(Error)
      const parsed = parseGitError(error)
      expect(parsed.statusCode).toBe(409)
      expect(parsed.code).toBe('BRANCH_IN_OTHER_WORKTREE')
      expect(git(['branch', '--list', 'feature'], baseRepoPath)).toContain('feature')
      expect(git(['branch', '--list', 'feature-renamed'], baseRepoPath)).toBe('')
      expect(getRepoById(db, worktreeRepo.id)?.branch).toBe('feature')
    })

    it('renames a branch from the worktree that owns it and updates its row', async () => {
      const origin = path.join(workspaceRoot, uniqueName('rename-wt-own-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('rename-wt-own-work'))
      createOrigin(origin, work)
      const baseRepoPath = path.join(reposPath, uniqueName('rename-wt-own-base'))
      cloneOrigin(origin, baseRepoPath)
      registerClone(origin, baseRepoPath)

      const worktreeName = uniqueName('rename-wt-own-feature')
      const worktreePath = path.join(reposPath, worktreeName)
      git(['worktree', 'add', '-b', 'feature', worktreePath], baseRepoPath)
      const worktreeRepo = createRepo(db, {
        repoUrl: origin,
        localPath: worktreeName,
        branch: 'feature',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        isWorktree: true,
      })

      await service.renameBranch(worktreeRepo.id, 'feature', 'feature-renamed', db)

      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)).toBe('feature-renamed')
      expect(git(['branch', '--list', 'feature-renamed'], worktreePath)).toContain('feature-renamed')
      expect(getRepoById(db, worktreeRepo.id)?.branch).toBe('feature-renamed')
    })

    it('updates schedule base branches across worktrees of the same repository only', async () => {
      const origin = path.join(workspaceRoot, uniqueName('rename-sched-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('rename-sched-work'))
      createOrigin(origin, work)
      const baseRepoPath = path.join(reposPath, uniqueName('rename-sched-base'))
      cloneOrigin(origin, baseRepoPath)
      const baseRepo = registerClone(origin, baseRepoPath)

      const worktreeName = uniqueName('rename-sched-feature')
      const worktreePath = path.join(reposPath, worktreeName)
      git(['worktree', 'add', '-b', 'feature', worktreePath], baseRepoPath)
      const worktreeRepo = createRepo(db, {
        repoUrl: origin,
        localPath: worktreeName,
        branch: 'feature',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        isWorktree: true,
      })

      const unrelatedPath = path.join(workspaceRoot, uniqueName('rename-sched-unrelated'))
      createCommittedRepo(unrelatedPath)
      const unrelatedRepo = createRepo(db, {
        isLocal: true,
        localPath: path.basename(unrelatedPath),
        sourcePath: unrelatedPath,
        branch: 'feature',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })

      createScheduleJob(db, baseRepo.id, scheduleJobInput('base schedule', 'feature'))
      createScheduleJob(db, worktreeRepo.id, scheduleJobInput('worktree schedule', 'feature'))
      createScheduleJob(db, unrelatedRepo.id, scheduleJobInput('unrelated schedule', 'feature'))

      await service.renameBranch(worktreeRepo.id, 'feature', 'renamed', db)

      expect(listScheduleJobsByRepo(db, baseRepo.id).map((job) => job.branch)).toEqual(['renamed'])
      expect(listScheduleJobsByRepo(db, worktreeRepo.id).map((job) => job.branch)).toEqual(['renamed'])
      expect(listScheduleJobsByRepo(db, unrelatedRepo.id).map((job) => job.branch)).toEqual(['feature'])
    })
  })

  describe('deleteBranch', () => {
    it('deletes a merged local branch', async () => {
      const origin = path.join(workspaceRoot, uniqueName('delete-merged-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('delete-merged-work'))
      createOrigin(origin, work)
      const repoPath = path.join(reposPath, uniqueName('delete-merged-clone'))
      cloneOrigin(origin, repoPath)
      git(['branch', 'feature'], repoPath)
      const repo = registerClone(origin, repoPath)

      const result = await service.deleteBranch(repo.id, { name: 'feature', force: false, deleteRemote: false }, db)

      expect(result.remoteDeleted).toBe(false)
      expect(git(['branch', '--list', 'feature'], repoPath)).toBe('')
    })

    it('refuses to delete an unmerged branch without force and succeeds with it', async () => {
      const origin = path.join(workspaceRoot, uniqueName('delete-unmerged-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('delete-unmerged-work'))
      createOrigin(origin, work)
      const repoPath = path.join(reposPath, uniqueName('delete-unmerged-clone'))
      cloneOrigin(origin, repoPath)
      git(['checkout', '-b', 'feature'], repoPath)
      git(['commit', '--allow-empty', '-m', 'unmerged'], repoPath)
      git(['checkout', 'main'], repoPath)
      const repo = registerClone(origin, repoPath)

      await expect(
        service.deleteBranch(repo.id, { name: 'feature', force: false, deleteRemote: false }, db)
      ).rejects.toThrow()
      expect(git(['branch', '--list', 'feature'], repoPath)).toContain('feature')

      const result = await service.deleteBranch(repo.id, { name: 'feature', force: true, deleteRemote: false }, db)

      expect(result.remoteDeleted).toBe(false)
      expect(git(['branch', '--list', 'feature'], repoPath)).toBe('')
    })

    it('deletes the upstream remote branch and reports remoteDeleted', async () => {
      const origin = path.join(workspaceRoot, uniqueName('delete-remote-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('delete-remote-work'))
      createOrigin(origin, work, ['feature'])
      const repoPath = path.join(reposPath, uniqueName('delete-remote-clone'))
      cloneOrigin(origin, repoPath)
      git(['checkout', '-b', 'feature', 'origin/feature'], repoPath)
      git(['checkout', 'main'], repoPath)
      const repo = registerClone(origin, repoPath)

      const result = await service.deleteBranch(repo.id, { name: 'feature', force: false, deleteRemote: true }, db)

      expect(result.remoteDeleted).toBe(true)
      expect(git(['branch', '--list', 'feature'], repoPath)).toBe('')
      expect(git(['branch', '--list', 'feature'], origin)).toBe('')
    })

    it('reports remoteDeleted false when the branch has no upstream', async () => {
      const origin = path.join(workspaceRoot, uniqueName('delete-no-upstream-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('delete-no-upstream-work'))
      createOrigin(origin, work)
      const repoPath = path.join(reposPath, uniqueName('delete-no-upstream-clone'))
      cloneOrigin(origin, repoPath)
      git(['branch', 'feature'], repoPath)
      const repo = registerClone(origin, repoPath)

      const result = await service.deleteBranch(repo.id, { name: 'feature', force: false, deleteRemote: true }, db)

      expect(result.remoteDeleted).toBe(false)
      expect(git(['branch', '--list', 'feature'], repoPath)).toBe('')
    })

    it('rejects deleting the checked-out branch with a conflict error', async () => {
      const origin = path.join(workspaceRoot, uniqueName('delete-current-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('delete-current-work'))
      createOrigin(origin, work)
      const repoPath = path.join(reposPath, uniqueName('delete-current-clone'))
      cloneOrigin(origin, repoPath)
      const repo = registerClone(origin, repoPath)

      const error = await service
        .deleteBranch(repo.id, { name: 'main', force: true, deleteRemote: false }, db)
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(Error)
      const parsed = parseGitError(error)
      expect(parsed.statusCode).toBe(409)
      expect(parsed.code).toBe('BRANCH_CHECKED_OUT')
      expect(git(['branch', '--list', 'main'], repoPath)).toContain('main')
    })

    it('rejects deleting a branch of an unknown repo', async () => {
      await expect(
        service.deleteBranch(9999, { name: 'main', force: false, deleteRemote: false }, db)
      ).rejects.toThrow(/Repository not found/)
    })

    it('rejects an option-like branch name without altering branches', async () => {
      const origin = path.join(workspaceRoot, uniqueName('delete-option-origin.git'))
      const work = path.join(workspaceRoot, uniqueName('delete-option-work'))
      createOrigin(origin, work)
      const repoPath = path.join(reposPath, uniqueName('delete-option-clone'))
      cloneOrigin(origin, repoPath)
      const repo = registerClone(origin, repoPath)

      await expect(
        service.deleteBranch(repo.id, { name: '--force', force: true, deleteRemote: false }, db)
      ).rejects.toThrow(/must not start with/)

      expect(git(['branch', '--list', 'main'], repoPath)).toContain('main')
    })
  })

  describe('stash', () => {
    function setupStashRepo(prefix: string): { repo: Repo; repoPath: string } {
      const origin = path.join(workspaceRoot, uniqueName(`${prefix}-origin.git`))
      const work = path.join(workspaceRoot, uniqueName(`${prefix}-work`))
      createOrigin(origin, work)
      const repoPath = path.join(reposPath, uniqueName(`${prefix}-clone`))
      cloneOrigin(origin, repoPath)
      const repo = registerClone(origin, repoPath)
      return { repo, repoPath }
    }

    async function stashHash(repo: Repo, index = 0): Promise<string> {
      const stashes = await service.listStashes(repo.id, db)
      return stashes[index]!.hash
    }

    it('pushes an untracked file into a stash and lists it with the message and branch', async () => {
      const { repo, repoPath } = setupStashRepo('stash-push')
      writeFileSync(path.join(repoPath, 'note.txt'), 'hello\n')

      await service.pushStash(repo.id, { message: 'wip note', includeUntracked: true }, db)

      expect(existsSync(path.join(repoPath, 'note.txt'))).toBe(false)
      const stashes = await service.listStashes(repo.id, db)
      expect(stashes).toHaveLength(1)
      expect(stashes[0]).toMatchObject({ index: 0, ref: 'stash@{0}', message: 'wip note', branch: 'main' })
      expect(stashes[0]?.hash).toMatch(/^[0-9a-f]{40}$/)
    })

    it('applies a stash, restoring files and keeping the entry', async () => {
      const { repo, repoPath } = setupStashRepo('stash-apply')
      writeFileSync(path.join(repoPath, 'note.txt'), 'hello\n')
      await service.pushStash(repo.id, { message: 'wip note', includeUntracked: true }, db)

      await service.applyStash(repo.id, 0, await stashHash(repo), false, db)

      expect(readFileSync(path.join(repoPath, 'note.txt'), 'utf-8')).toBe('hello\n')
      expect(await service.listStashes(repo.id, db)).toHaveLength(1)
    })

    it('pops a stash, restoring files and removing the entry', async () => {
      const { repo, repoPath } = setupStashRepo('stash-pop')
      writeFileSync(path.join(repoPath, 'note.txt'), 'hello\n')
      await service.pushStash(repo.id, { message: 'wip note', includeUntracked: true }, db)

      await service.applyStash(repo.id, 0, await stashHash(repo), true, db)

      expect(readFileSync(path.join(repoPath, 'note.txt'), 'utf-8')).toBe('hello\n')
      expect(await service.listStashes(repo.id, db)).toHaveLength(0)
    })

    it('drops a stash without restoring files', async () => {
      const { repo, repoPath } = setupStashRepo('stash-drop')
      writeFileSync(path.join(repoPath, 'note.txt'), 'hello\n')
      await service.pushStash(repo.id, { message: 'wip note', includeUntracked: true }, db)

      await service.dropStash(repo.id, 0, await stashHash(repo), db)

      expect(existsSync(path.join(repoPath, 'note.txt'))).toBe(false)
      expect(await service.listStashes(repo.id, db)).toHaveLength(0)
    })

    it('rejects a non-integer or negative stash index', async () => {
      const { repo } = setupStashRepo('stash-invalid')

      await expect(service.applyStash(repo.id, 1.5, 'hash', false, db)).rejects.toThrow(/Invalid stash index/)
      await expect(service.dropStash(repo.id, -1, 'hash', db)).rejects.toThrow(/Invalid stash index/)
    })

    it('rejects a stale stash hash and leaves both stashes intact', async () => {
      const { repo, repoPath } = setupStashRepo('stash-stale')
      writeFileSync(path.join(repoPath, 'first.txt'), 'first\n')
      await service.pushStash(repo.id, { message: 'first', includeUntracked: true }, db)
      const staleHash = await stashHash(repo)

      writeFileSync(path.join(repoPath, 'second.txt'), 'second\n')
      await service.pushStash(repo.id, { message: 'second', includeUntracked: true }, db)

      const applyError = await service.applyStash(repo.id, 0, staleHash, false, db).catch((caught: unknown) => caught)
      expect(parseGitError(applyError).code).toBe('STASH_CHANGED')
      expect(parseGitError(applyError).statusCode).toBe(409)

      const dropError = await service.dropStash(repo.id, 0, staleHash, db).catch((caught: unknown) => caught)
      expect(parseGitError(dropError).code).toBe('STASH_CHANGED')

      expect(await service.listStashes(repo.id, db)).toHaveLength(2)
      expect(existsSync(path.join(repoPath, 'first.txt'))).toBe(false)
      expect(existsSync(path.join(repoPath, 'second.txt'))).toBe(false)
    })

    it('rejects applying a stash index that no longer exists', async () => {
      const { repo } = setupStashRepo('stash-missing')

      const error = await service.applyStash(repo.id, 0, 'deadbeef', false, db).catch((caught: unknown) => caught)
      expect(parseGitError(error).code).toBe('STASH_CHANGED')
    })

    function prepareConflictingStash(repoPath: string): void {
      writeFileSync(path.join(repoPath, 'file.txt'), 'original\n')
      git(['add', 'file.txt'], repoPath)
      git(['commit', '-m', 'add file'], repoPath)
      writeFileSync(path.join(repoPath, 'file.txt'), 'stashed change\n')
    }

    it('surfaces a merge conflict and keeps the stash when applying over a competing commit', async () => {
      const { repo, repoPath } = setupStashRepo('stash-conflict-apply')
      prepareConflictingStash(repoPath)
      await service.pushStash(repo.id, { message: 'wip', includeUntracked: false }, db)
      const hash = await stashHash(repo)
      writeFileSync(path.join(repoPath, 'file.txt'), 'competing change\n')
      git(['add', 'file.txt'], repoPath)
      git(['commit', '-m', 'competing'], repoPath)

      let error: unknown
      try {
        await service.applyStash(repo.id, 0, hash, false, db)
      } catch (caught) {
        error = caught
      }

      expect(error).toBeInstanceOf(Error)
      expect(parseGitError(error).code).toBe('MERGE_CONFLICT')
      expect(git(['status', '--porcelain'], repoPath)).toContain('UU file.txt')
      expect(await service.listStashes(repo.id, db)).toHaveLength(1)
    })

    it('surfaces a merge conflict and keeps the stash when a pop fails', async () => {
      const { repo, repoPath } = setupStashRepo('stash-conflict-pop')
      prepareConflictingStash(repoPath)
      await service.pushStash(repo.id, { message: 'wip', includeUntracked: false }, db)
      const hash = await stashHash(repo)
      writeFileSync(path.join(repoPath, 'file.txt'), 'competing change\n')
      git(['add', 'file.txt'], repoPath)
      git(['commit', '-m', 'competing'], repoPath)

      let error: unknown
      try {
        await service.applyStash(repo.id, 0, hash, true, db)
      } catch (caught) {
        error = caught
      }

      expect(error).toBeInstanceOf(Error)
      expect(parseGitError(error).code).toBe('MERGE_CONFLICT')
      expect(await service.listStashes(repo.id, db)).toHaveLength(1)
    })
  })

  describe('operations', () => {
    function setupOperationRepo(prefix: string): { repo: Repo; repoPath: string } {
      const origin = path.join(workspaceRoot, uniqueName(`${prefix}-origin.git`))
      const work = path.join(workspaceRoot, uniqueName(`${prefix}-work`))
      createOrigin(origin, work)
      const repoPath = path.join(reposPath, uniqueName(`${prefix}-clone`))
      cloneOrigin(origin, repoPath)
      const repo = registerClone(origin, repoPath)
      return { repo, repoPath }
    }

    function commitConflictingChange(repoPath: string): string {
      writeFileSync(path.join(repoPath, 'file.txt'), 'base\n')
      git(['add', 'file.txt'], repoPath)
      git(['commit', '-m', 'add file'], repoPath)
      git(['checkout', '-b', 'feature'], repoPath)
      writeFileSync(path.join(repoPath, 'file.txt'), 'feature\n')
      git(['commit', '-am', 'feature change'], repoPath)
      const featureHash = git(['rev-parse', 'HEAD'], repoPath)
      git(['checkout', 'main'], repoPath)
      writeFileSync(path.join(repoPath, 'file.txt'), 'main change\n')
      git(['commit', '-am', 'main change'], repoPath)
      return featureHash
    }

    it('reports no operation for a clean repository', async () => {
      const { repo } = setupOperationRepo('op-clean')

      const status = await service.getStatus(repo.id, db)

      expect(status.operation).toBeNull()
    })

    it('reports a merge with its conflicted files after a conflicting merge', async () => {
      const { repo, repoPath } = setupOperationRepo('op-merge')
      commitConflictingChange(repoPath)
      try {
        git(['merge', 'feature'], repoPath)
      } catch {
        void 0
      }

      const status = await service.getStatus(repo.id, db)

      expect(status.operation).toEqual({ kind: 'merge', conflictedFiles: ['file.txt'] })
    })

    it('aborts a conflicting merge and clears the operation state', async () => {
      const { repo, repoPath } = setupOperationRepo('op-abort')
      commitConflictingChange(repoPath)
      try {
        git(['merge', 'feature'], repoPath)
      } catch {
        void 0
      }

      await service.abortOperation(repo.id, db)

      expect((await service.getStatus(repo.id, db)).operation).toBeNull()
      expect(git(['status', '--porcelain'], repoPath)).toBe('')
    })

    it('continues a merge after the conflict is resolved and staged', async () => {
      const { repo, repoPath } = setupOperationRepo('op-continue')
      commitConflictingChange(repoPath)
      try {
        git(['merge', 'feature'], repoPath)
      } catch {
        void 0
      }
      writeFileSync(path.join(repoPath, 'file.txt'), 'resolved\n')
      git(['add', 'file.txt'], repoPath)

      await service.continueOperation(repo.id, db)

      expect((await service.getStatus(repo.id, db)).operation).toBeNull()
      expect(git(['log', '-1', '--format=%P'], repoPath).split(' ')).toHaveLength(2)
    })

    it('reports the next conflict when a rebase continue stops on a later commit', async () => {
      const { repo, repoPath } = setupOperationRepo('op-rebase-multi')
      writeFileSync(path.join(repoPath, 'file.txt'), 'base\n')
      writeFileSync(path.join(repoPath, 'other.txt'), 'base\n')
      git(['add', 'file.txt', 'other.txt'], repoPath)
      git(['commit', '-m', 'add files'], repoPath)
      git(['checkout', '-b', 'feature'], repoPath)
      writeFileSync(path.join(repoPath, 'file.txt'), 'feature\n')
      git(['commit', '-am', 'feature file'], repoPath)
      writeFileSync(path.join(repoPath, 'other.txt'), 'feature\n')
      git(['commit', '-am', 'feature other'], repoPath)
      git(['checkout', 'main'], repoPath)
      writeFileSync(path.join(repoPath, 'file.txt'), 'main\n')
      writeFileSync(path.join(repoPath, 'other.txt'), 'main\n')
      git(['commit', '-am', 'main change'], repoPath)

      git(['checkout', 'feature'], repoPath)
      try {
        git(['rebase', 'main'], repoPath)
      } catch {
        void 0
      }

      expect((await service.getStatus(repo.id, db)).operation).toEqual({
        kind: 'rebase',
        conflictedFiles: ['file.txt'],
      })

      writeFileSync(path.join(repoPath, 'file.txt'), 'resolved\n')
      git(['add', 'file.txt'], repoPath)

      const error = await service.continueOperation(repo.id, db).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(Error)

      expect((await service.getStatus(repo.id, db)).operation).toEqual({
        kind: 'rebase',
        conflictedFiles: ['other.txt'],
      })
    })

    it('reports a cherry-pick with its conflicted files', async () => {
      const { repo, repoPath } = setupOperationRepo('op-cherry-pick')
      const featureHash = commitConflictingChange(repoPath)
      try {
        git(['cherry-pick', featureHash], repoPath)
      } catch {
        void 0
      }

      const status = await service.getStatus(repo.id, db)

      expect(status.operation).toEqual({ kind: 'cherry-pick', conflictedFiles: ['file.txt'] })
    })

    it('reports exact conflicted paths for unicode and special-character file names', async () => {
      const { repo, repoPath } = setupOperationRepo('op-filenames')
      const unicodeName = 'café.txt'
      const specialName = 'a b"c.txt'
      writeFileSync(path.join(repoPath, unicodeName), 'base\n')
      writeFileSync(path.join(repoPath, specialName), 'base\n')
      git(['add', unicodeName, specialName], repoPath)
      git(['commit', '-m', 'add files'], repoPath)
      git(['checkout', '-b', 'feature'], repoPath)
      writeFileSync(path.join(repoPath, unicodeName), 'feature\n')
      writeFileSync(path.join(repoPath, specialName), 'feature\n')
      git(['commit', '-am', 'feature change'], repoPath)
      git(['checkout', 'main'], repoPath)
      writeFileSync(path.join(repoPath, unicodeName), 'main\n')
      writeFileSync(path.join(repoPath, specialName), 'main\n')
      git(['commit', '-am', 'main change'], repoPath)
      try {
        git(['merge', 'feature'], repoPath)
      } catch {
        void 0
      }

      const status = await service.getStatus(repo.id, db)

      expect(status.operation?.kind).toBe('merge')
      expect(status.operation?.conflictedFiles).toEqual(
        expect.arrayContaining([unicodeName, specialName])
      )
      expect(status.operation?.conflictedFiles).toHaveLength(2)
    })

    it('rejects continue and abort when no operation is in progress', async () => {
      const { repo } = setupOperationRepo('op-none')

      const continueError = await service.continueOperation(repo.id, db).catch((caught: unknown) => caught)
      const abortError = await service.abortOperation(repo.id, db).catch((caught: unknown) => caught)

      expect(parseGitError(continueError).code).toBe('NO_OPERATION_IN_PROGRESS')
      expect(parseGitError(continueError).statusCode).toBe(409)
      expect(parseGitError(abortError).code).toBe('NO_OPERATION_IN_PROGRESS')
    })
  })

  describe('integrateBranch', () => {
    interface WorktreeFixture {
      origin: string
      base: Repo
      basePath: string
      worktree: Repo
      worktreePath: string
    }

    async function setupWorktreeRepo(prefix: string): Promise<WorktreeFixture> {
      const origin = path.join(workspaceRoot, uniqueName(`${prefix}-origin.git`))
      const work = path.join(workspaceRoot, uniqueName(`${prefix}-work`))
      createOrigin(origin, work)
      const basePath = path.join(reposPath, uniqueName(`${prefix}-base`))
      cloneOrigin(origin, basePath)
      const base = registerClone(origin, basePath)

      const worktreeName = uniqueName(`${prefix}-feature`)
      const worktreePath = path.join(reposPath, worktreeName)
      await createWorktreeSafely(basePath, worktreePath, 'feature', {}, 'main')
      const worktree = createRepo(db, {
        repoUrl: origin,
        localPath: worktreeName,
        branch: 'feature',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        isWorktree: true,
      })

      return { origin, base, basePath, worktree, worktreePath }
    }

    it('merges the worktree branch into the target and counts integrated commits', async () => {
      const { base, basePath, worktree, worktreePath } = await setupWorktreeRepo('integrate-merge')
      writeFileSync(path.join(worktreePath, 'a.txt'), 'a\n')
      git(['add', 'a.txt'], worktreePath)
      git(['commit', '-m', 'add a'], worktreePath)
      writeFileSync(path.join(worktreePath, 'b.txt'), 'b\n')
      git(['add', 'b.txt'], worktreePath)
      git(['commit', '-m', 'add b'], worktreePath)

      const result = await service.integrateBranch(worktree.id, { targetBranch: 'main', strategy: 'merge' }, db)

      expect(result).toEqual({ targetRepoId: base.id, integratedCommits: 2 })
      expect(existsSync(path.join(basePath, 'a.txt'))).toBe(true)
      expect(existsSync(path.join(basePath, 'b.txt'))).toBe(true)
      expect(git(['log', '-1', '--format=%P'], basePath).split(' ')).toHaveLength(2)
    })

    it('cherry-picks the worktree commits linearly into the target', async () => {
      const { basePath, worktree, worktreePath } = await setupWorktreeRepo('integrate-cherry')
      writeFileSync(path.join(worktreePath, 'a.txt'), 'a\n')
      git(['add', 'a.txt'], worktreePath)
      git(['commit', '-m', 'add a'], worktreePath)
      writeFileSync(path.join(worktreePath, 'b.txt'), 'b\n')
      git(['add', 'b.txt'], worktreePath)
      git(['commit', '-m', 'add b'], worktreePath)

      const result = await service.integrateBranch(worktree.id, { targetBranch: 'main', strategy: 'cherry-pick' }, db)

      expect(result.integratedCommits).toBe(2)
      expect(git(['log', '-2', '--format=%s'], basePath).split('\n')).toEqual(['add b', 'add a'])
      expect(git(['log', '-1', '--format=%P'], basePath).split(' ')).toHaveLength(1)
    })

    it('rejects a target with tracked changes', async () => {
      const { basePath, worktree, worktreePath } = await setupWorktreeRepo('integrate-dirty')
      writeFileSync(path.join(basePath, 'tracked.txt'), 'base\n')
      git(['add', 'tracked.txt'], basePath)
      git(['commit', '-m', 'tracked'], basePath)
      writeFileSync(path.join(worktreePath, 'feature.txt'), 'feature\n')
      git(['add', 'feature.txt'], worktreePath)
      git(['commit', '-m', 'feature'], worktreePath)
      writeFileSync(path.join(basePath, 'tracked.txt'), 'modified\n')

      await expect(
        service.integrateBranch(worktree.id, { targetBranch: 'main', strategy: 'merge' }, db)
      ).rejects.toThrow(/uncommitted changes/i)
    })

    it('rejects a target branch that is not checked out in any worktree', async () => {
      const { basePath, worktree } = await setupWorktreeRepo('integrate-no-checkout')
      git(['branch', 'unchecked'], basePath)

      await expect(
        service.integrateBranch(worktree.id, { targetBranch: 'unchecked', strategy: 'merge' }, db)
      ).rejects.toThrow(/not checked out in any worktree/i)
    })

    it('rejects integrating a branch into itself', async () => {
      const { worktree } = await setupWorktreeRepo('integrate-self')

      await expect(
        service.integrateBranch(worktree.id, { targetBranch: 'feature', strategy: 'merge' }, db)
      ).rejects.toThrow(/into itself/i)
    })

    it('throws a conflict error for a conflicting merge and reports the operation on the target', async () => {
      const { base, basePath, worktree, worktreePath } = await setupWorktreeRepo('integrate-conflict-merge')
      writeFileSync(path.join(basePath, 'file.txt'), 'base\n')
      git(['add', 'file.txt'], basePath)
      git(['commit', '-m', 'base'], basePath)
      writeFileSync(path.join(worktreePath, 'file.txt'), 'feature\n')
      git(['add', 'file.txt'], worktreePath)
      git(['commit', '-m', 'feature change'], worktreePath)
      writeFileSync(path.join(basePath, 'file.txt'), 'main change\n')
      git(['commit', '-am', 'main change'], basePath)

      const error = await service
        .integrateBranch(worktree.id, { targetBranch: 'main', strategy: 'merge' }, db)
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(GitIntegrationConflictError)
      const conflict = error as GitIntegrationConflictError
      expect(conflict.targetRepoId).toBe(base.id)
      expect(conflict.operation.kind).toBe('merge')
      expect(conflict.operation.conflictedFiles).toContain('file.txt')

      const status = await service.getStatus(base.id, db)
      expect(status.operation).toEqual({ kind: 'merge', conflictedFiles: ['file.txt'] })
    })

    it('throws a conflict error for a conflicting cherry-pick', async () => {
      const { base, basePath, worktree, worktreePath } = await setupWorktreeRepo('integrate-conflict-cherry')
      writeFileSync(path.join(basePath, 'file.txt'), 'base\n')
      git(['add', 'file.txt'], basePath)
      git(['commit', '-m', 'base'], basePath)
      writeFileSync(path.join(worktreePath, 'file.txt'), 'feature\n')
      git(['add', 'file.txt'], worktreePath)
      git(['commit', '-m', 'feature change'], worktreePath)
      writeFileSync(path.join(basePath, 'file.txt'), 'main change\n')
      git(['commit', '-am', 'main change'], basePath)

      const error = await service
        .integrateBranch(worktree.id, { targetBranch: 'main', strategy: 'cherry-pick' }, db)
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(GitIntegrationConflictError)
      const conflict = error as GitIntegrationConflictError
      expect(conflict.targetRepoId).toBe(base.id)
      expect(conflict.operation.kind).toBe('cherry-pick')

      const status = await service.getStatus(base.id, db)
      expect(status.operation?.kind).toBe('cherry-pick')
    })

    it('merges the selected heads when tags collide with the source and target branch names', async () => {
      const { base, basePath, worktree, worktreePath } = await setupWorktreeRepo('integrate-tag-merge')
      writeFileSync(path.join(worktreePath, 'feature.txt'), 'feature\n')
      git(['add', 'feature.txt'], worktreePath)
      git(['commit', '-m', 'add feature'], worktreePath)
      writeFileSync(path.join(worktreePath, 'feature2.txt'), 'feature2\n')
      git(['add', 'feature2.txt'], worktreePath)
      git(['commit', '-m', 'add feature2'], worktreePath)

      const baseSha = git(['rev-parse', 'refs/heads/main'], basePath)
      const firstFeatureSha = git(['rev-parse', 'HEAD~1'], worktreePath)
      git(['tag', 'feature', baseSha], basePath)
      git(['tag', 'main', firstFeatureSha], basePath)

      const result = await service.integrateBranch(worktree.id, { targetBranch: 'main', strategy: 'merge' }, db)

      expect(result).toEqual({ targetRepoId: base.id, integratedCommits: 2 })
      expect(existsSync(path.join(basePath, 'feature.txt'))).toBe(true)
      expect(existsSync(path.join(basePath, 'feature2.txt'))).toBe(true)
    })

    it('cherry-picks the selected heads when tags collide with the source and target branch names', async () => {
      const { basePath, worktree, worktreePath } = await setupWorktreeRepo('integrate-tag-cherry')
      writeFileSync(path.join(worktreePath, 'feature.txt'), 'feature\n')
      git(['add', 'feature.txt'], worktreePath)
      git(['commit', '-m', 'add feature'], worktreePath)
      writeFileSync(path.join(worktreePath, 'feature2.txt'), 'feature2\n')
      git(['add', 'feature2.txt'], worktreePath)
      git(['commit', '-m', 'add feature2'], worktreePath)

      const baseSha = git(['rev-parse', 'refs/heads/main'], basePath)
      const firstFeatureSha = git(['rev-parse', 'HEAD~1'], worktreePath)
      git(['tag', 'feature', baseSha], basePath)
      git(['tag', 'main', firstFeatureSha], basePath)

      const result = await service.integrateBranch(worktree.id, { targetBranch: 'main', strategy: 'cherry-pick' }, db)

      expect(result.integratedCommits).toBe(2)
      expect(git(['log', '-2', '--format=%s'], basePath).split('\n')).toEqual(['add feature2', 'add feature'])
      expect(existsSync(path.join(basePath, 'feature.txt'))).toBe(true)
      expect(existsSync(path.join(basePath, 'feature2.txt'))).toBe(true)
    })

    it('rejects a target worktree nested inside a managed repo without its own row', async () => {
      const { basePath, worktree, worktreePath } = await setupWorktreeRepo('integrate-unmanaged-nested')
      const nestedPath = path.join(basePath, 'nested')
      git(['worktree', 'add', '-b', 'nested', nestedPath], basePath)
      writeFileSync(path.join(worktreePath, 'feature.txt'), 'feature\n')
      git(['add', 'feature.txt'], worktreePath)
      git(['commit', '-m', 'feature work'], worktreePath)

      const nestedHeadBefore = git(['rev-parse', 'HEAD'], nestedPath)
      const nestedStatusBefore = git(['status', '--porcelain'], nestedPath)

      const error = await service
        .integrateBranch(worktree.id, { targetBranch: 'nested', strategy: 'merge' }, db)
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(GitOperationError)
      expect(parseGitError(error).statusCode).toBe(409)
      expect((error as GitOperationError).message).toMatch(/not a managed repository/i)
      expect(git(['rev-parse', 'HEAD'], nestedPath)).toBe(nestedHeadBefore)
      expect(git(['status', '--porcelain'], nestedPath)).toBe(nestedStatusBefore)
    })

    it('integrates into a nested target once it has its own managed row', async () => {
      const { origin, basePath, worktree, worktreePath } = await setupWorktreeRepo('integrate-managed-nested')
      const nestedPath = path.join(basePath, 'nested')
      git(['worktree', 'add', '-b', 'nested', nestedPath], basePath)
      const nestedRepo = createRepo(db, {
        repoUrl: origin,
        localPath: `${path.basename(basePath)}/nested`,
        branch: 'nested',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        isWorktree: true,
      })

      writeFileSync(path.join(worktreePath, 'feature.txt'), 'feature\n')
      git(['add', 'feature.txt'], worktreePath)
      git(['commit', '-m', 'feature work'], worktreePath)

      const result = await service.integrateBranch(worktree.id, { targetBranch: 'nested', strategy: 'merge' }, db)

      expect(result.targetRepoId).toBe(nestedRepo.id)
      expect(result.integratedCommits).toBe(1)
      expect(existsSync(path.join(nestedPath, 'feature.txt'))).toBe(true)
    })
  })

  describe('DELETE /repos/:id worktree branch cleanup', () => {
    interface DeleteWorktreeFixture {
      origin: string
      basePath: string
      worktree: Repo
      worktreePath: string
    }

    async function setupDeleteWorktree(prefix: string): Promise<DeleteWorktreeFixture> {
      const origin = path.join(workspaceRoot, uniqueName(`${prefix}-origin.git`))
      const work = path.join(workspaceRoot, uniqueName(`${prefix}-work`))
      createOrigin(origin, work)
      const baseName = uniqueName(`${prefix}-base`)
      const basePath = path.join(reposPath, baseName)
      cloneOrigin(origin, basePath)
      const repoUrl = `https://example.com/owner/${baseName}.git`
      createRepo(db, { repoUrl, localPath: baseName, branch: 'main', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now() })

      const worktreeName = uniqueName(`${prefix}-feature`)
      const worktreePath = path.join(reposPath, worktreeName)
      await createWorktreeSafely(basePath, worktreePath, 'feature', {}, 'main')
      const worktree = createRepo(db, {
        repoUrl,
        localPath: worktreeName,
        branch: 'feature',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        isWorktree: true,
      })

      writeFileSync(path.join(worktreePath, 'feature.txt'), 'feature\n')
      git(['add', 'feature.txt'], worktreePath)
      git(['commit', '-m', 'feature work'], worktreePath)

      return { origin, basePath, worktree, worktreePath }
    }

    function mergeFeatureIntoMain(basePath: string): void {
      git(['merge', 'feature'], basePath)
    }

    function pushFeatureWithUpstream(worktreePath: string): void {
      git(['push', '-u', 'origin', 'feature'], worktreePath)
    }

    function createDeleteApp(): Hono {
      const app = new Hono()
      const scheduleService = { prepareRepoDelete: () => {} } as unknown as Parameters<typeof createRepoRoutes>[2]
      app.route('/repos', createRepoRoutes(db, gitAuth, scheduleService, createStubOpenCodeClient()))
      return app
    }

    function rejectPushes(origin: string): void {
      const hooksDir = path.join(origin, 'hooks')
      mkdirSync(hooksDir, { recursive: true })
      const hookPath = path.join(hooksDir, 'pre-receive')
      writeFileSync(hookPath, '#!/bin/sh\necho "rejected by test hook" >&2\nexit 1\n')
      chmodSync(hookPath, 0o755)
    }

    async function setupLocalWorktree(prefix: string): Promise<{ basePath: string; worktree: Repo; worktreePath: string }> {
      const baseName = uniqueName(`${prefix}-local-base`)
      const basePath = path.join(reposPath, baseName)
      mkdirSync(basePath, { recursive: true })
      git(['init', '-b', 'main'], basePath)
      git(['config', 'user.email', 'test@test.com'], basePath)
      git(['config', 'user.name', 'Test'], basePath)
      git(['commit', '--allow-empty', '-m', 'init'], basePath)

      const worktreeName = uniqueName(`${prefix}-local-feature`)
      const worktreePath = path.join(reposPath, worktreeName)
      await createWorktreeSafely(basePath, worktreePath, 'feature', {}, 'main')
      const worktree = createRepo(db, {
        localPath: worktreeName,
        branch: 'feature',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        isLocal: true,
        isWorktree: true,
      })

      return { basePath, worktree, worktreePath }
    }

    it('deletes the worktree directory and its local branch when the branch is merged', async () => {
      const { basePath, worktree, worktreePath } = await setupDeleteWorktree('delete-wt-local')
      mergeFeatureIntoMain(basePath)

      const res = await createDeleteApp().request(`/repos/${worktree.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteBranch: 'local' }),
      })

      expect(res.status).toBe(200)
      const data = await res.json() as { success: boolean; branch?: { name: string; deleted: boolean; remoteDeleted: boolean; error?: string } }
      expect(data.success).toBe(true)
      expect(data.branch).toEqual({ name: 'feature', deleted: true, remoteDeleted: false })
      expect(existsSync(worktreePath)).toBe(false)
      expect(git(['branch', '--list', 'feature'], basePath)).toBe('')
      expect(getRepoById(db, worktree.id)).toBeNull()
    })

    it('keeps an unmerged branch and reports why the worktree branch was not deleted', async () => {
      const { basePath, worktree, worktreePath } = await setupDeleteWorktree('delete-wt-unmerged')

      const res = await createDeleteApp().request(`/repos/${worktree.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteBranch: 'local' }),
      })

      expect(res.status).toBe(200)
      const data = await res.json() as { success: boolean; branch?: { name: string; deleted: boolean; remoteDeleted: boolean; error?: string } }
      expect(data.success).toBe(true)
      expect(data.branch).toEqual({
        name: 'feature',
        deleted: false,
        remoteDeleted: false,
        error: "Branch 'feature' was kept because it has unmerged commits.",
      })
      expect(existsSync(worktreePath)).toBe(false)
      expect(git(['branch', '--list', 'feature'], basePath)).toContain('feature')
      expect(getRepoById(db, worktree.id)).toBeNull()
    })

    it('also deletes the pushed origin branch with local-and-remote', async () => {
      const { origin, basePath, worktree, worktreePath } = await setupDeleteWorktree('delete-wt-remote')
      pushFeatureWithUpstream(worktreePath)

      const res = await createDeleteApp().request(`/repos/${worktree.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteBranch: 'local-and-remote' }),
      })

      expect(res.status).toBe(200)
      const data = await res.json() as { success: boolean; branch?: { name: string; deleted: boolean; remoteDeleted: boolean; error?: string } }
      expect(data.success).toBe(true)
      expect(data.branch?.deleted).toBe(true)
      expect(data.branch?.remoteDeleted).toBe(true)
      expect(existsSync(worktreePath)).toBe(false)
      expect(git(['branch', '--list', 'feature'], basePath)).toBe('')
      expect(git(['branch', '--list', 'feature'], origin)).toBe('')
    })

    it('deletes a local worktree without a repoUrl together with its branch', async () => {
      const { basePath, worktree, worktreePath } = await setupLocalWorktree('delete-wt-local-no-url')
      mergeFeatureIntoMain(basePath)

      const res = await createDeleteApp().request(`/repos/${worktree.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteBranch: 'local' }),
      })

      expect(res.status).toBe(200)
      const data = await res.json() as { success: boolean; branch?: { name: string; deleted: boolean; remoteDeleted: boolean; error?: string } }
      expect(data.success).toBe(true)
      expect(data.branch).toEqual({ name: 'feature', deleted: true, remoteDeleted: false })
      expect(existsSync(worktreePath)).toBe(false)
      expect(git(['branch', '--list', 'feature'], basePath)).toBe('')
      expect(git(['worktree', 'list', '--porcelain'], basePath)).not.toContain(worktreePath)
      expect(getRepoById(db, worktree.id)).toBeNull()
    })

    it('reports local deletion as complete when the remote rejects the branch deletion', async () => {
      const { origin, basePath, worktree, worktreePath } = await setupDeleteWorktree('delete-wt-reject')
      pushFeatureWithUpstream(worktreePath)
      rejectPushes(origin)

      const res = await createDeleteApp().request(`/repos/${worktree.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteBranch: 'local-and-remote' }),
      })

      expect(res.status).toBe(200)
      const data = await res.json() as { success: boolean; branch?: { name: string; deleted: boolean; remoteDeleted: boolean; error?: string } }
      expect(data.success).toBe(true)
      expect(data.branch?.name).toBe('feature')
      expect(data.branch?.deleted).toBe(true)
      expect(data.branch?.remoteDeleted).toBe(false)
      expect(data.branch?.error).toBeTruthy()
      expect(existsSync(worktreePath)).toBe(false)
      expect(git(['branch', '--list', 'feature'], basePath)).toBe('')
      expect(git(['branch', '--list', 'feature'], origin)).toContain('feature')
      expect(getRepoById(db, worktree.id)).toBeNull()
    })
  })
})
