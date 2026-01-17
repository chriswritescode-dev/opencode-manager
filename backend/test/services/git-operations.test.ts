import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { gitReuseDir, setupGitTestRepo, cleanupTestRepo, createTestFile, stageAndCommitTestFile } from '../fixtures/git-helpers'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(() => ({
    run: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn()
    }))
  })),
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn()
}))

import { getFileDiff } from '../../src/services/git-operations'

const testRepoPath = gitReuseDir('git-operations-test')

describe('getFileDiff', () => {
  beforeAll(async () => {
    await setupGitTestRepo(testRepoPath)
  })

  afterAll(async () => {
    await cleanupTestRepo(testRepoPath)
  })

  describe('untracked file diff', () => {
    it('should extract diff from git --no-index output when exit code 1', async () => {
      const fileName = 'new-file.txt'
      const content = 'First line\nSecond line\nThird line\n'
      await createTestFile(testRepoPath, fileName, content)

      const result = await getFileDiff(testRepoPath, fileName)

      expect(result.status).toBe('untracked')
      expect(result.diff).toBeTruthy()
      expect(result.diff).toContain('diff --git')
      expect(result.diff).toContain(`a/${fileName}`)
      expect(result.diff).toContain(`b/${fileName}`)
      expect(result.additions).toBe(3)
      expect(result.deletions).toBe(0)
      expect(result.isBinary).toBe(false)
    })

    it('should handle new file with multiple additions', async () => {
      const fileName = 'new-code-file.js'
      const content = 'function hello() {\n  console.log("Hello world");\n  return true;\n}\n'
      await createTestFile(testRepoPath, fileName, content)

      const result = await getFileDiff(testRepoPath, fileName)

      expect(result.status).toBe('untracked')
      expect(result.additions).toBeGreaterThan(0)
      expect(result.diff).toContain('diff --git')
    })
  })

  describe('tracked file diff', () => {
    it('should get diff for modified tracked file', async () => {
      const fileName = 'modified-file.txt'
      const originalContent = 'Original line 1\nOriginal line 2\n'
      await createTestFile(testRepoPath, fileName, originalContent)
      await stageAndCommitTestFile(testRepoPath, fileName)

      const modifiedContent = 'Original line 1\nModified line 2\nNew line 3\n'
      await createTestFile(testRepoPath, fileName, modifiedContent)

      const result = await getFileDiff(testRepoPath, fileName)

      expect(result.status).toBe('modified')
      expect(result.diff).toBeTruthy()
      expect(result.diff).toContain('-Original line 2')
      expect(result.diff).toContain('+Modified line 2')
      expect(result.diff).toContain('+New line 3')
      expect(result.additions).toBe(2)
      expect(result.deletions).toBe(1)
    })
  })
})
