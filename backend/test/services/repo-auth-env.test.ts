import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getReposPath } from '@opencode-manager/shared'
import { createGitHubGitEnv } from '../../src/utils/git-auth'

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

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: () => ({
      preferences: {
        gitToken: 'ghp_test_token',
      },
      updatedAt: Date.now(),
    }),
  })),
}))

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

    await cloneRepo(database, repoUrl)

    const expectedEnv = createGitHubGitEnv('ghp_test_token')

    expect(executeCommand).toHaveBeenNthCalledWith(
      3,
      ['git', 'clone', repoUrl, 'forge'],
      { cwd: getReposPath(), env: expectedEnv }
    )

    expect(ensureDirectoryExists).toHaveBeenCalledWith(getReposPath())
    expect(updateRepoStatus).toHaveBeenCalledWith(database, 1, 'ready')
    expect(deleteRepo).not.toHaveBeenCalled()
  })
})
