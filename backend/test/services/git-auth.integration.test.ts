import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { SettingsService } from '../../src/services/settings'
import { GitAuthService } from '../../src/services/git-auth'
import type { GitCredential } from '@opencode-manager/shared'

// Mock side-effect modules
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('../../src/utils/crypto', () => ({
  encryptSecret: vi.fn((s: string) => `encrypted:${s}`),
  decryptSecret: vi.fn((s: string) => {
    if (!s.startsWith('encrypted:')) throw new Error('Decryption failed')
    return s.slice(10)
  }),
}))

vi.mock('../../src/utils/ssh-key-manager', () => ({
  writeTemporarySSHKey: vi.fn().mockResolvedValue('/tmp/test-key'),
  cleanupSSHKey: vi.fn().mockResolvedValue(undefined),
  buildSSHCommand: vi.fn(() => ({ command: 'ssh ...' })),
  buildSSHCommandWithKnownHosts: vi.fn(() => 'ssh ...'),
  parseSSHHost: vi.fn(() => ({ host: 'github.com', port: '22' })),
  isSSHUrl: vi.fn(() => false),
  normalizeSSHUrl: vi.fn((u: string) => u),
  extractHostFromSSHUrl: vi.fn(() => 'github.com'),
}))

vi.mock('../../src/ipc/sshHostKeyHandler', () => ({
  SSHHostKeyHandler: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getKnownHostsPath: vi.fn().mockReturnValue(null),
    getEnv: vi.fn().mockReturnValue({}),
  })),
}))

function createGitHubPatCredential(): GitCredential {
  return {
    name: 'github-pat',
    host: 'github.com',
    type: 'pat',
    username: 'x-access-token',
    token: 'ghp_test_token',
  } as GitCredential
}

describe('GitAuthService integration (real CredentialProvider)', () => {
  let db: Database
  let settingsService: SettingsService
  let gitAuthService: GitAuthService

  beforeEach(async () => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
    gitAuthService = new GitAuthService()
    await gitAuthService.initialize(undefined, db)
  })

  describe('getGitEnvironment', () => {
    it('includes GH_TOKEN and GITHUB_TOKEN when a GitHub PAT is seeded', () => {
      settingsService.updateSettings({
        gitCredentials: [createGitHubPatCredential()],
      })

      const env = gitAuthService.getGitEnvironment()

      expect(env.GH_TOKEN).toBe('ghp_test_token')
      expect(env.GITHUB_TOKEN).toBe('ghp_test_token')
    })

    it('does not include GH_TOKEN when no GitHub credential is available', () => {
      const env = gitAuthService.getGitEnvironment()

      expect(env.GH_TOKEN).toBeUndefined()
      expect(env.GITHUB_TOKEN).toBeUndefined()
    })
  })
})
