import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getReposPath } from '@opencode-manager/shared/config/env'
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

vi.mock('../../src/services/opencode-sdk-client', () => ({
  opencodeSdkClient: {
    isConfigured: vi.fn().mockReturnValue(false),
    configure: vi.fn(),
    listProjects: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue([]),
    getVersion: vi.fn().mockResolvedValue(null),
    checkHealth: vi.fn().mockResolvedValue(false),
    getCurrentProject: vi.fn().mockResolvedValue(null),
    getAllProjectPaths: vi.fn().mockResolvedValue([]),
    getBaseUrl: vi.fn().mockReturnValue(''),
  },
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
      ['git', 'clone', 'https://github.com/acme/forge', 'forge'],
      { cwd: getReposPath(), env: expectedEnv, silent: undefined }
    )

    expect(ensureDirectoryExists).toHaveBeenCalledWith(getReposPath())
    expect(updateRepoStatus).toHaveBeenCalledWith(database, 1, 'ready')
    expect(deleteRepo).not.toHaveBeenCalled()
  })
})
