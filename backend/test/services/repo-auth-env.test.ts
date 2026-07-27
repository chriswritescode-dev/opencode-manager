import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getReposPath } from '@opencode-manager/shared/config/env'
import type { GitAuthService } from '../../src/services/git-auth'

const executeCommand = vi.fn()
const ensureDirectoryExists = vi.fn()
const existsSync = vi.fn()

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

vi.mock('node:fs', () => ({
  existsSync,
  rmSync: vi.fn(),
}))

const setRepoSetting = vi.fn()
const getRepoSetting = vi.fn()

vi.mock('../../src/db/queries', () => ({
  getRepoByUrlAndBranch,
  createRepo,
  updateRepoStatus,
  deleteRepo,
  setRepoSetting,
  getRepoSetting,
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: vi.fn().mockReturnValue({ preferences: { gitCredentials: [] } }),
  })),
}))

vi.mock('../../src/utils/ssh-key-manager', () => ({
  parseSSHHost: vi.fn((url: string) => ({ user: 'git', host: url, port: null })),
  writeTemporarySSHKey: vi.fn(),
  buildSSHCommand: vi.fn(),
  buildSSHCommandWithKnownHosts: vi.fn(),
  cleanupSSHKey: vi.fn(),
}))

const mockEnv = {
  GIT_TERMINAL_PROMPT: '0',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
}

const mockGitAuthService = {
  getGitEnvironment: vi.fn().mockReturnValue(mockEnv),
  getSSHEnvironment: vi.fn().mockReturnValue({}),
  setupSSHKey: vi.fn(),
  cleanupSSHKey: vi.fn(),
  verifyHostKeyBeforeOperation: vi.fn().mockResolvedValue(true),
  setupSSHForRepoUrl: vi.fn().mockResolvedValue(false),
  setSSHPort: vi.fn(),
} as unknown as GitAuthService

describe('repoService.cloneRepo auth env', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRepoSetting.mockReturnValue(null)
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

    existsSync.mockReturnValue(false)
    executeCommand
      .mockResolvedValueOnce('')

    await cloneRepo(database, mockGitAuthService, repoUrl)

    expect(executeCommand).toHaveBeenLastCalledWith(
      ['git', 'clone', 'https://github.com/acme/forge', 'forge'],
      expect.objectContaining({ cwd: getReposPath(), env: mockEnv })
    )

    expect(ensureDirectoryExists).toHaveBeenCalledWith(getReposPath())
    expect(updateRepoStatus).toHaveBeenCalledWith(database, 1, 'ready')
    expect(deleteRepo).not.toHaveBeenCalled()
  })

  it('persists the skipSSHVerification flag at create time so retry can preserve it', async () => {
    const { cloneRepo } = await import('../../src/services/repo')

    const database = {} as any
    const repoUrl = 'ssh://git@example.com/acme/forge.git'

    getRepoByUrlAndBranch.mockReturnValue(null)
    createRepo.mockReturnValue({
      id: 7,
      repoUrl,
      localPath: 'forge',
      defaultBranch: 'main',
      cloneStatus: 'cloning',
      clonedAt: Date.now(),
    })
    existsSync.mockReturnValue(false)
    executeCommand.mockResolvedValue('')

    await cloneRepo(database, mockGitAuthService, repoUrl, { skipSSHVerification: true })

    expect(setRepoSetting).toHaveBeenCalledWith(database, 7, 'skipSSHVerification', 'true')
  })

  it('does not persist a skipSSHVerification row when the flag is false (default)', async () => {
    const { cloneRepo } = await import('../../src/services/repo')

    const database = {} as any
    const repoUrl = 'https://github.com/acme/forge.git'

    getRepoByUrlAndBranch.mockReturnValue(null)
    createRepo.mockReturnValue({
      id: 8,
      repoUrl,
      localPath: 'forge',
      defaultBranch: 'main',
      cloneStatus: 'cloning',
      clonedAt: Date.now(),
    })
    existsSync.mockReturnValue(false)
    executeCommand.mockResolvedValue('')

    await cloneRepo(database, mockGitAuthService, repoUrl)

    expect(setRepoSetting).not.toHaveBeenCalledWith(
      database,
      8,
      'skipSSHVerification',
      expect.anything()
    )
  })
})
