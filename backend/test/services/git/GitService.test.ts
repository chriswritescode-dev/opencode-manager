import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'bun:sqlite'
import { createRepo } from '../../../src/db/queries'
import { createGitService, type GitService } from '../../../src/services/git/GitService'
import type { Repo } from '../../../src/types/repo'
import { applyTestEnv } from '../../helpers/test-env'
import { createTestDatabase } from '../../helpers/test-database'
import { cloneOrigin, createCommittedRepo, createGitAuthService, createOrigin, git, uniqueName } from '../../helpers/git-fixtures'

const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'git-service-'))
const restoreEnv = applyTestEnv({
  WORKSPACE_PATH: workspaceRoot,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
})

const reposPath = path.join(workspaceRoot, 'repos')

interface CloneFixture {
  repo: Repo
  originPath: string
}

describe('GitService', () => {
  let db: Database
  let service: GitService

  beforeEach(() => {
    db = createTestDatabase()
    service = createGitService(createGitAuthService())
    rmSync(reposPath, { recursive: true, force: true })
    mkdirSync(reposPath, { recursive: true })
  })

  afterEach(() => {
    db.close()
  })

  afterAll(() => {
    restoreEnv()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  function initRepo(): Repo {
    const repoPath = path.join(reposPath, uniqueName('repo'))
    createCommittedRepo(repoPath)
    return createRepo(db, {
      isLocal: true,
      sourcePath: repoPath,
      localPath: path.basename(repoPath),
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
    })
  }

  function initClone(extraBranches: string[] = []): CloneFixture {
    const originPath = path.join(workspaceRoot, uniqueName('origin'))
    const workPath = path.join(workspaceRoot, uniqueName('origin-work'))
    createOrigin(originPath, workPath, extraBranches)
    const repoPath = path.join(reposPath, uniqueName('clone'))
    cloneOrigin(originPath, repoPath)
    const repo = createRepo(db, {
      repoUrl: originPath,
      localPath: path.basename(repoPath),
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
    })
    return { repo, originPath }
  }

  function commitFile(repoPath: string, fileName: string, content: string, message: string): string {
    writeFileSync(path.join(repoPath, fileName), content)
    git(['add', fileName], repoPath)
    git(['commit', '-m', message], repoPath)
    return git(['rev-parse', 'HEAD'], repoPath)
  }

  describe('getStatus', () => {
    it('reports a clean repository', async () => {
      const repo = initRepo()

      const status = await service.getStatus(repo.id, db)

      expect(status.branch).toBe('main')
      expect(status.ahead).toBe(0)
      expect(status.behind).toBe(0)
      expect(status.files).toEqual([])
      expect(status.hasChanges).toBe(false)
      expect(status.operation).toBeNull()
    })

    it('reports staged, unstaged and untracked files', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'tracked.txt', 'one\n', 'add tracked')
      writeFileSync(path.join(repo.fullPath, 'tracked.txt'), 'two\n')
      writeFileSync(path.join(repo.fullPath, 'staged.txt'), 'staged\n')
      git(['add', 'staged.txt'], repo.fullPath)
      writeFileSync(path.join(repo.fullPath, 'untracked.txt'), 'untracked\n')

      const status = await service.getStatus(repo.id, db)

      expect(status.files).toEqual(expect.arrayContaining([
        { path: 'tracked.txt', status: 'modified', staged: false },
        { path: 'staged.txt', status: 'added', staged: true },
        { path: 'untracked.txt', status: 'untracked', staged: false },
      ]))
      expect(status.hasChanges).toBe(true)
    })

    it('reports the staged and unstaged halves of a partially staged file', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'both.txt', 'one\n', 'add both')
      writeFileSync(path.join(repo.fullPath, 'both.txt'), 'two\n')
      git(['add', 'both.txt'], repo.fullPath)
      writeFileSync(path.join(repo.fullPath, 'both.txt'), 'three\n')

      const status = await service.getStatus(repo.id, db)

      expect(status.files).toEqual([
        { path: 'both.txt', status: 'modified', staged: true },
        { path: 'both.txt', status: 'modified', staged: false },
      ])
    })

    it('reports a staged rename with its previous path', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'old.txt', 'moved content\n', 'add old')
      git(['mv', 'old.txt', 'new.txt'], repo.fullPath)

      const status = await service.getStatus(repo.id, db)

      expect(status.files).toEqual([
        { path: 'new.txt', status: 'renamed', staged: true, oldPath: 'old.txt' },
      ])
    })

    it('counts commits ahead of the upstream branch', async () => {
      const { repo } = initClone()
      commitFile(repo.fullPath, 'local.txt', 'local\n', 'local commit')

      const status = await service.getStatus(repo.id, db)

      expect(status.ahead).toBe(1)
      expect(status.behind).toBe(0)
    })

    it('throws for an unknown repository', async () => {
      await expect(service.getStatus(4242, db)).rejects.toThrow('Repository not found')
    })
  })

  describe('getFileDiff', () => {
    it('returns an empty diff for a clean file', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'clean.txt', 'clean\n', 'add clean')

      const diff = await service.getFileDiff(repo.id, 'clean.txt', db)

      expect(diff).toEqual({
        path: 'clean.txt',
        status: 'modified',
        diff: '',
        additions: 0,
        deletions: 0,
        isBinary: false,
      })
    })

    it('counts the changes of a modified tracked file', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'file.ts', 'old line\nkept line\n', 'add file')
      writeFileSync(path.join(repo.fullPath, 'file.ts'), 'new line\nkept line\nextra line\n')

      const diff = await service.getFileDiff(repo.id, 'file.ts', db)

      expect(diff.status).toBe('modified')
      expect(diff.additions).toBe(2)
      expect(diff.deletions).toBe(1)
      expect(diff.diff).toContain('+new line')
      expect(await service.getDiff(repo.id, 'file.ts', db)).toBe(diff.diff)
    })

    it('includes staged changes only when requested', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'file.ts', 'old line\n', 'add file')
      writeFileSync(path.join(repo.fullPath, 'file.ts'), 'staged line\n')
      git(['add', 'file.ts'], repo.fullPath)

      const staged = await service.getFileDiff(repo.id, 'file.ts', db, { includeStaged: true })
      const unstaged = await service.getFullDiff(repo.id, 'file.ts', db, false)

      expect(staged.additions).toBe(1)
      expect(staged.deletions).toBe(1)
      expect(unstaged.diff).toBe('')
    })

    it('returns the diff of an untracked file', async () => {
      const repo = initRepo()
      writeFileSync(path.join(repo.fullPath, 'newfile.ts'), 'first\nsecond\n')

      const diff = await service.getFileDiff(repo.id, 'newfile.ts', db)

      expect(diff.status).toBe('untracked')
      expect(diff.additions).toBe(2)
      expect(diff.deletions).toBe(0)
    })

    it('truncates a diff larger than the size limit', async () => {
      const repo = initRepo()
      writeFileSync(path.join(repo.fullPath, 'large.txt'), `${'x'.repeat(600 * 1024)}\n`)

      const diff = await service.getFileDiff(repo.id, 'large.txt', db)

      expect(diff.truncated).toBe(true)
      expect(diff.diff).toContain('... (diff truncated due to size)')
    })

    it('reports a binary file', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'image.bin', 'placeholder\n', 'add image')
      writeFileSync(path.join(repo.fullPath, 'image.bin'), Buffer.from([0, 0, 1, 2, 3, 4]))

      const diff = await service.getFileDiff(repo.id, 'image.bin', db)

      expect(diff.isBinary).toBe(true)
    })
  })

  describe('getLog', () => {
    it('returns the newest commits first with their authors and messages', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'first.txt', 'first\n', 'first commit')
      commitFile(repo.fullPath, 'second.txt', 'second\n', 'fix: merge|conflict|handling')

      const commits = await service.getLog(repo.id, db, 2)

      expect(commits).toHaveLength(2)
      expect(commits[0]?.message).toBe('fix: merge|conflict|handling')
      expect(commits[1]?.message).toBe('first commit')
      expect(commits[0]?.authorName).toBe('Test')
      expect(commits[0]?.authorEmail).toBe('test@test.com')
      expect(commits[0]?.date).toMatch(/^\d+$/)
    })

    it('limits the number of returned commits', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'first.txt', 'first\n', 'first commit')
      commitFile(repo.fullPath, 'second.txt', 'second\n', 'second commit')

      const commits = await service.getLog(repo.id, db, 1)

      expect(commits).toHaveLength(1)
      expect(commits[0]?.message).toBe('second commit')
    })

    it('logs the requested branch', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'main.txt', 'main\n', 'main commit')
      git(['checkout', '-b', 'feature'], repo.fullPath)
      commitFile(repo.fullPath, 'feature.txt', 'feature\n', 'feature commit')
      git(['checkout', 'main'], repo.fullPath)

      const commits = await service.getLog(repo.id, db, 10, 'feature')

      expect(commits[0]?.message).toBe('feature commit')
      expect(commits.map(commit => commit.message)).toContain('main commit')
    })

    it('treats a blank branch as HEAD', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'main.txt', 'main\n', 'main commit')

      const blankBranch = await service.getLog(repo.id, db, 10, '   ')
      const head = await service.getLog(repo.id, db, 10)

      expect(blankBranch).toEqual(head)
    })
  })

  describe('getCommit', () => {
    it('returns the commit for an existing hash', async () => {
      const repo = initRepo()
      const hash = commitFile(repo.fullPath, 'file.txt', 'content\n', 'commit to read')

      const commit = await service.getCommit(repo.id, hash, db)

      expect(commit).toEqual({
        hash,
        authorName: 'Test',
        authorEmail: 'test@test.com',
        date: expect.stringMatching(/^\d+$/),
        message: 'commit to read',
      })
    })

    it('throws for an unknown hash', async () => {
      const repo = initRepo()

      await expect(service.getCommit(repo.id, 'does-not-exist', db)).rejects.toThrow('Failed to get commit')
    })
  })

  describe('staging and committing', () => {
    it('stages files and commits them', async () => {
      const repo = initRepo()
      writeFileSync(path.join(repo.fullPath, 'a.txt'), 'a\n')
      writeFileSync(path.join(repo.fullPath, 'b.txt'), 'b\n')

      await service.stageFiles(repo.id, ['a.txt', 'b.txt'], db)
      const output = await service.commit(repo.id, 'add both files', db)

      expect(output).toContain('add both files')
      const commits = await service.getLog(repo.id, db, 1)
      expect(commits[0]?.message).toBe('add both files')
    })

    it('commits only the given staged paths', async () => {
      const repo = initRepo()
      writeFileSync(path.join(repo.fullPath, 'a.txt'), 'a\n')
      writeFileSync(path.join(repo.fullPath, 'b.txt'), 'b\n')
      await service.stageFiles(repo.id, ['a.txt', 'b.txt'], db)

      await service.commit(repo.id, 'only a', db, ['a.txt'])

      const status = await service.getStatus(repo.id, db)
      expect(status.files).toEqual([{ path: 'b.txt', status: 'added', staged: true }])
    })

    it('unstages files without discarding their changes', async () => {
      const repo = initRepo()
      writeFileSync(path.join(repo.fullPath, 'a.txt'), 'a\n')
      await service.stageFiles(repo.id, ['a.txt'], db)

      await service.unstageFiles(repo.id, ['a.txt'], db)

      const status = await service.getStatus(repo.id, db)
      expect(status.files).toEqual([{ path: 'a.txt', status: 'untracked', staged: false }])
      expect(existsSync(path.join(repo.fullPath, 'a.txt'))).toBe(true)
    })

    it('does nothing when no paths are given', async () => {
      const repo = initRepo()

      expect(await service.stageFiles(repo.id, [], db)).toBe('')
      expect(await service.unstageFiles(repo.id, [], db)).toBe('')
    })
  })

  describe('resetToCommit', () => {
    it('hard resets the branch to the given commit', async () => {
      const repo = initRepo()
      const first = commitFile(repo.fullPath, 'file.txt', 'one\n', 'first commit')
      commitFile(repo.fullPath, 'file.txt', 'two\n', 'second commit')

      await service.resetToCommit(repo.id, first, db)

      expect(await service.getLog(repo.id, db, 10)).toHaveLength(2)
      expect(git(['rev-parse', 'HEAD'], repo.fullPath)).toBe(first)
      expect(readFileSync(path.join(repo.fullPath, 'file.txt'), 'utf-8')).toBe('one\n')
    })
  })

  describe('remote operations', () => {
    it('pushes a local commit to origin', async () => {
      const { repo, originPath } = initClone()
      commitFile(repo.fullPath, 'pushed.txt', 'pushed\n', 'push me')

      await service.push(repo.id, {}, db)

      expect(git(['log', '--format=%s', '-1', 'main'], originPath)).toBe('push me')
    })

    it('pushes a branch that has no upstream with --set-upstream', async () => {
      const { repo, originPath } = initClone()
      git(['checkout', '-b', 'feature'], repo.fullPath)
      commitFile(repo.fullPath, 'feature.txt', 'feature\n', 'feature commit')

      await service.push(repo.id, { setUpstream: true }, db)

      expect(git(['rev-parse', 'feature'], originPath)).toBe(git(['rev-parse', 'feature'], repo.fullPath))
      expect(await service.getBranchStatus(repo.id, db)).toEqual({ ahead: 0, behind: 0 })
    })

    it('fetches new commits from origin', async () => {
      const { repo, originPath } = initClone()
      const otherPath = path.join(workspaceRoot, uniqueName('other'))
      cloneOrigin(originPath, otherPath)
      commitFile(otherPath, 'remote.txt', 'remote\n', 'remote change')
      git(['push', 'origin', 'main'], otherPath)

      await service.fetch(repo.id, db)

      expect(git(['log', '--format=%s', '-1', 'origin/main'], repo.fullPath)).toBe('remote change')
    })

    it('pulls new commits from origin into the working tree', async () => {
      const { repo, originPath } = initClone()
      const otherPath = path.join(workspaceRoot, uniqueName('other'))
      cloneOrigin(originPath, otherPath)
      commitFile(otherPath, 'remote.txt', 'remote\n', 'remote change')
      git(['push', 'origin', 'main'], otherPath)

      await service.pull(repo.id, db)

      expect(readFileSync(path.join(repo.fullPath, 'remote.txt'), 'utf-8')).toBe('remote\n')
    })
  })

  describe('getBranches', () => {
    it('lists local and remote branches and marks the current one', async () => {
      const { repo } = initClone(['feature'])
      git(['branch', 'local-only'], repo.fullPath)

      const branches = await service.getBranches(repo.id, db)

      expect(branches[0]).toMatchObject({ name: 'main', type: 'local', current: true })
      expect(branches).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'local-only', type: 'local', current: false }),
        expect.objectContaining({ name: 'remotes/origin/feature', type: 'remote' }),
      ]))
    })
  })

  describe('discardChanges', () => {
    it('discards staged changes', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'file.ts', 'committed\n', 'add file')
      writeFileSync(path.join(repo.fullPath, 'file.ts'), 'staged\n')
      git(['add', 'file.ts'], repo.fullPath)

      await service.discardChanges(repo.id, ['file.ts'], true, db)

      expect(readFileSync(path.join(repo.fullPath, 'file.ts'), 'utf-8')).toBe('committed\n')
      expect((await service.getStatus(repo.id, db)).files).toEqual([])
    })

    it('discards unstaged tracked changes', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'file.ts', 'committed\n', 'add file')
      writeFileSync(path.join(repo.fullPath, 'file.ts'), 'modified\n')

      await service.discardChanges(repo.id, ['file.ts'], false, db)

      expect(readFileSync(path.join(repo.fullPath, 'file.ts'), 'utf-8')).toBe('committed\n')
      expect((await service.getStatus(repo.id, db)).files).toEqual([])
    })

    it('removes untracked files and directories', async () => {
      const repo = initRepo()
      writeFileSync(path.join(repo.fullPath, 'untracked.txt'), 'untracked\n')
      mkdirSync(path.join(repo.fullPath, 'dir'))
      writeFileSync(path.join(repo.fullPath, 'dir', 'nested.txt'), 'nested\n')

      await service.discardChanges(repo.id, ['untracked.txt', 'dir/'], false, db)

      expect(existsSync(path.join(repo.fullPath, 'untracked.txt'))).toBe(false)
      expect(existsSync(path.join(repo.fullPath, 'dir', 'nested.txt'))).toBe(false)
      expect((await service.getStatus(repo.id, db)).files).toEqual([])
    })

    it('discards tracked and untracked changes in one call', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'modified.ts', 'committed\n', 'add modified')
      writeFileSync(path.join(repo.fullPath, 'modified.ts'), 'modified\n')
      writeFileSync(path.join(repo.fullPath, 'untracked.ts'), 'untracked\n')

      await service.discardChanges(repo.id, ['modified.ts', 'untracked.ts'], false, db)

      expect(readFileSync(path.join(repo.fullPath, 'modified.ts'), 'utf-8')).toBe('committed\n')
      expect(existsSync(path.join(repo.fullPath, 'untracked.ts'))).toBe(false)
    })

    it('does nothing when no paths are given', async () => {
      const repo = initRepo()
      writeFileSync(path.join(repo.fullPath, 'untracked.txt'), 'untracked\n')

      expect(await service.discardChanges(repo.id, [], false, db)).toBe('')
      expect(existsSync(path.join(repo.fullPath, 'untracked.txt'))).toBe(true)
    })

    it('throws for an unknown repository', async () => {
      await expect(service.discardChanges(4242, ['file.ts'], false, db)).rejects.toThrow('Repository not found')
    })

    it('throws when git rejects the command', async () => {
      const repo = initRepo()
      writeFileSync(path.join(repo.fullPath, 'file.ts'), 'modified\n')
      rmSync(path.join(repo.fullPath, '.git'), { recursive: true, force: true })

      await expect(service.discardChanges(repo.id, ['file.ts'], false, db)).rejects.toThrow()
    })
  })

  describe('getCommitDetails', () => {
    it('returns the commit with its per-file changes', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'kept.txt', 'one\nkept\n', 'add kept')
      commitFile(repo.fullPath, 'removed.txt', 'one\ntwo\nthree\n', 'add removed')
      writeFileSync(path.join(repo.fullPath, 'kept.txt'), 'one\nchanged\n')
      writeFileSync(path.join(repo.fullPath, 'added.txt'), 'added\n')
      rmSync(path.join(repo.fullPath, 'removed.txt'))
      git(['add', '-A'], repo.fullPath)
      git(['commit', '-m', 'mixed change'], repo.fullPath)
      const hash = git(['rev-parse', 'HEAD'], repo.fullPath)

      const details = await service.getCommitDetails(repo.id, hash, db)

      expect(details?.hash).toBe(hash)
      expect(details?.message).toBe('mixed change')
      expect(details?.authorName).toBe('Test')
      expect(details?.files).toEqual(expect.arrayContaining([
        { path: 'added.txt', status: 'added', oldPath: undefined, additions: 1, deletions: 0 },
        { path: 'kept.txt', status: 'modified', oldPath: undefined, additions: 1, deletions: 1 },
        { path: 'removed.txt', status: 'deleted', oldPath: undefined, additions: 0, deletions: 3 },
      ]))
    })

    it('reports renamed files with their previous path', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'old.txt', 'stable content\n', 'add old')
      git(['mv', 'old.txt', 'new.txt'], repo.fullPath)
      git(['commit', '-m', 'rename'], repo.fullPath)
      const hash = git(['rev-parse', 'HEAD'], repo.fullPath)

      const details = await service.getCommitDetails(repo.id, hash, db)

      expect(details?.files).toEqual([
        { path: 'new.txt', status: 'renamed', oldPath: 'old.txt', additions: 0, deletions: 0 },
      ])
    })

    it('returns no files for an empty commit', async () => {
      const repo = initRepo()
      const hash = git(['rev-parse', 'HEAD'], repo.fullPath)

      const details = await service.getCommitDetails(repo.id, hash, db)

      expect(details?.files).toEqual([])
    })

    it('marks a local-only commit as unpushed until it is pushed', async () => {
      const { repo } = initClone()
      const hash = commitFile(repo.fullPath, 'local.txt', 'local\n', 'local commit')

      const unpushed = await service.getCommitDetails(repo.id, hash, db)
      await service.push(repo.id, {}, db)
      const pushed = await service.getCommitDetails(repo.id, hash, db)

      expect(unpushed?.unpushed).toBe(true)
      expect(pushed?.unpushed).toBe(false)
    })

    it('keeps pipes in the commit message', async () => {
      const repo = initRepo()
      const hash = commitFile(repo.fullPath, 'file.txt', 'content\n', 'fix: merge|conflict|handling')

      const details = await service.getCommitDetails(repo.id, hash, db)

      expect(details?.message).toBe('fix: merge|conflict|handling')
    })

    it('throws for an unknown repository', async () => {
      await expect(service.getCommitDetails(4242, 'HEAD', db)).rejects.toThrow('Repository not found')
    })

    it('throws for an unknown hash', async () => {
      const repo = initRepo()

      await expect(service.getCommitDetails(repo.id, 'does-not-exist', db)).rejects.toThrow('Failed to get commit details')
    })
  })

  describe('getCommitDiff', () => {
    it('returns the diff of one file in a commit', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'file.ts', 'old line\nkept line\n', 'add file')
      writeFileSync(path.join(repo.fullPath, 'file.ts'), 'new line\nkept line\n')
      git(['add', 'file.ts'], repo.fullPath)
      git(['commit', '-m', 'change file'], repo.fullPath)
      const hash = git(['rev-parse', 'HEAD'], repo.fullPath)

      const diff = await service.getCommitDiff(repo.id, hash, 'file.ts', db)

      expect(diff.path).toBe('file.ts')
      expect(diff.status).toBe('modified')
      expect(diff.diff).toContain('+new line')
      expect(diff.additions).toBe(1)
      expect(diff.deletions).toBe(1)
      expect(diff.isBinary).toBe(false)
    })

    it('reports a binary file', async () => {
      const repo = initRepo()
      writeFileSync(path.join(repo.fullPath, 'image.bin'), Buffer.from([0, 0, 1, 2, 3]))
      git(['add', 'image.bin'], repo.fullPath)
      git(['commit', '-m', 'add image'], repo.fullPath)
      writeFileSync(path.join(repo.fullPath, 'image.bin'), Buffer.from([0, 0, 4, 5, 6]))
      git(['add', 'image.bin'], repo.fullPath)
      git(['commit', '-m', 'change image'], repo.fullPath)
      const hash = git(['rev-parse', 'HEAD'], repo.fullPath)

      const diff = await service.getCommitDiff(repo.id, hash, 'image.bin', db)

      expect(diff.isBinary).toBe(true)
      expect(diff.diff).toContain('Binary files')
    })

    it('counts the deleted lines of a file removed in the commit', async () => {
      const repo = initRepo()
      commitFile(repo.fullPath, 'removed.txt', 'one\ntwo\nthree\n', 'add removed')
      rmSync(path.join(repo.fullPath, 'removed.txt'))
      git(['add', '-A'], repo.fullPath)
      git(['commit', '-m', 'remove file'], repo.fullPath)
      const hash = git(['rev-parse', 'HEAD'], repo.fullPath)

      const diff = await service.getCommitDiff(repo.id, hash, 'removed.txt', db)

      expect(diff.status).toBe('deleted')
      expect(diff.deletions).toBe(3)
      expect(diff.additions).toBe(0)
    })

    it('throws for an unknown repository', async () => {
      await expect(service.getCommitDiff(4242, 'HEAD', 'file.ts', db)).rejects.toThrow('Repository not found')
    })

    it('throws for an unknown hash', async () => {
      const repo = initRepo()

      await expect(service.getCommitDiff(repo.id, 'does-not-exist', 'file.ts', db)).rejects.toThrow('Failed to get commit diff')
    })
  })
})
