import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rm } from 'node:fs/promises'

import { cloneOrigin, createOrigin, git, uniqueName } from '../helpers/git-fixtures'
import { createWorktreeSafely, removeWorktree, resolveDefaultBranch } from '../../src/services/repo'

interface WorktreeCreator {
  label: string
  create: (repoPath: string, target: string, branch: string) => Promise<void>
}

const worktreeCreators: WorktreeCreator[] = [
  {
    label: 'createWorktreeSafely',
    create: async (repoPath, target, branch) => {
      await createWorktreeSafely(repoPath, target, branch, {})
    },
  },
  {
    label: 'git worktree add',
    create: async (repoPath, target, branch) => {
      git(['worktree', 'add', '-b', branch, target], repoPath)
    },
  },
]

describe('repo worktree helpers', () => {
  let tmpDir: string
  let baseRepoPath: string

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'repo-worktree-test-'))
    const originRepoPath = path.join(tmpDir, 'origin.git')
    baseRepoPath = path.join(tmpDir, 'base')
    createOrigin(originRepoPath, path.join(tmpDir, 'seed'))
    cloneOrigin(originRepoPath, baseRepoPath)
    git(['remote', 'set-head', 'origin', '--auto'], baseRepoPath)
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('resolveDefaultBranch', () => {
    it('resolves the default branch from origin/HEAD', async () => {
      await expect(resolveDefaultBranch(baseRepoPath, {})).resolves.toBe('main')
    })

    it('falls back to main when origin/HEAD cannot be resolved', async () => {
      await expect(resolveDefaultBranch(path.join(tmpDir, 'missing-repo'), {})).resolves.toBe('main')
    })
  })

  describe('createWorktreeSafely', () => {
    it('creates a worktree for a new branch and checks it out', async () => {
      const worktreePath = path.join(tmpDir, uniqueName('feature'))

      await createWorktreeSafely(baseRepoPath, worktreePath, 'feature/x', {})

      expect(existsSync(worktreePath)).toBe(true)
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)).toBe('feature/x')
    })
  })

  describe('removeWorktree', () => {
    it.each(worktreeCreators)('removes and prunes a worktree created with $label', async ({ create }) => {
      const worktreePath = path.join(tmpDir, uniqueName('worktree'))
      const branch = path.basename(worktreePath)

      await create(baseRepoPath, worktreePath, branch)
      expect(existsSync(worktreePath)).toBe(true)

      await removeWorktree(baseRepoPath, worktreePath)

      expect(existsSync(worktreePath)).toBe(false)
      expect(git(['worktree', 'list'], baseRepoPath)).not.toContain(worktreePath)
    })
  })
})
