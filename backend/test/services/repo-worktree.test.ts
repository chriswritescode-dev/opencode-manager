import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { rm } from 'fs/promises'

import { resolveDefaultBranch, createWorktreeSafely, removeWorktree } from '../../src/services/repo'

describe('repo worktree helpers', () => {
  let baseRepoPath: string
  let originRepoPath: string
  let worktreePath: string
  let tmpDir: string
  const env = process.env as Record<string, string>

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'repo-worktree-test-'))
    originRepoPath = path.join(tmpDir, 'origin.git')
    baseRepoPath = path.join(tmpDir, 'base')
    worktreePath = path.join(tmpDir, 'feature-x')

    // Init bare origin
    execSync(`git init --bare "${originRepoPath}"`, { env })

    // Clone origin to get a working base repo (default branch is "master" in bare repos)
    execSync(`git clone "${originRepoPath}" "${baseRepoPath}"`, { env })

    // Set git config for commits
    execSync(`git -C "${baseRepoPath}" config user.email test@test.com`, { env })
    execSync(`git -C "${baseRepoPath}" config user.name Test`, { env })

    // Rename default branch to "main" and push
    execSync(`git -C "${baseRepoPath}" branch -m master main`, { env })
    execSync(`git -C "${baseRepoPath}" commit --allow-empty -m "Initial commit"`, { env })
    execSync(`git -C "${baseRepoPath}" push origin main`, { env })

    // Set bare repo HEAD to main so origin/HEAD is resolvable
    execSync(`git -C "${originRepoPath}" symbolic-ref HEAD refs/heads/main`, { env })
    execSync(`git -C "${baseRepoPath}" remote set-head origin --auto`, { env })
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('resolveDefaultBranch', () => {
    it('resolves default branch from origin/HEAD', async () => {
      const branch = await resolveDefaultBranch(baseRepoPath, env)
      expect(branch).toBe('main')
    })

    it('falls back to main when origin/HEAD cannot be resolved', async () => {
      const branch = await resolveDefaultBranch('/nonexistent/path', env)
      expect(branch).toBe('main')
    })
  })

  describe('createWorktreeSafely', () => {
    it('creates a worktree for a new branch and checks it out', async () => {
      await createWorktreeSafely(baseRepoPath, worktreePath, 'feature/x', env)

      expect(existsSync(worktreePath)).toBe(true)

      const branch = execSync(`git -C "${worktreePath}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()
      expect(branch).toBe('feature/x')
    })
  })

  describe('removeWorktree', () => {
    it('removes a worktree directory and prunes the worktree entry', async () => {
      expect(existsSync(worktreePath)).toBe(true)

      await removeWorktree(baseRepoPath, worktreePath)

      expect(existsSync(worktreePath)).toBe(false)

      // Verify pruning — the removed worktree should not appear in the list
      const worktreeList = execSync(`git -C "${baseRepoPath}" worktree list`, { encoding: 'utf-8' })
      expect(worktreeList).not.toContain(worktreePath)
    })
  })
})
