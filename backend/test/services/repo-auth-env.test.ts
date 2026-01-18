import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getReposPath } from '@opencode-manager/shared/config/env'
import type { GitAuthService } from '../../src/services/git-auth'

const executeCommand = vi.fn()
const ensureDirectoryExists = vi.fn()

const getRepoByUrlAndBranch = vi.fn()
const createRepo = vi.fn()
const updateRepoStatus = vi.fn()
const deleteRepo = vi.fn()

vi.mock('../../src/utils/process', () => ({
  executeCommand,
}))

vi.mock('../../src/services/file-operations', () => ({
  ensureDirectoryExists,
}))

vi.mock('../../src/db/queries', () => ({
  getRepoByUrlAndBranch,
  createRepo,
  updateRepoStatus,
  deleteRepo,
}))

const mockEnv = {
  GIT_TERMINAL_PROMPT: '0',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
}

const mockGitAuthService = {
  getGitEnvironment: vi.fn().mockReturnValue(mockEnv),
} as unknown as GitAuthService

describe('repoService.cloneRepo auth env', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes github extraheader env to git clone', async () => {
    const { cloneRepo } = await import('../../src/services/repo')

    const database = {} as any
    const repoUrl = 'https://github.com/acme/forge.git'

    getRepoByUrlAndBranch.mockReturnValue(null)
    createRepo.mockReturnValue({
      id: 1,
      repoUrl,
      localPath: 'forge',
      defaultBranch: 'main',
      cloneStatus: 'cloning',
      clonedAt: Date.now(),
    })

    executeCommand
      .mockResolvedValueOnce('missing')
      .mockResolvedValueOnce('missing')
      .mockResolvedValueOnce('')

    await cloneRepo(database, mockGitAuthService, repoUrl)

    expect(executeCommand).toHaveBeenNthCalledWith(
      3,
      ['git', 'clone', 'https://github.com/acme/forge', 'forge'],
      expect.objectContaining({ cwd: getReposPath(), env: mockEnv })
    )

    expect(ensureDirectoryExists).toHaveBeenCalledWith(getReposPath())
    expect(updateRepoStatus).toHaveBeenCalledWith(database, 1, 'ready')
    expect(deleteRepo).not.toHaveBeenCalled()
  })
})
