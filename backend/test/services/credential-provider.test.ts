import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { SettingsService } from '../../src/services/settings'
import { CredentialProvider } from '../../src/services/credential-provider'
import { createRepo, setRepoGitCredentialId } from '../../src/db/queries'
import type { GitCredential } from '@opencode-manager/shared'

function createPatCredential(name: string, host: string, token: string, username?: string, id?: string): GitCredential {
  return {
    ...(id ? { id } : {}),
    name,
    host,
    token,
    ...(username ? { username } : {}),
  } as GitCredential
}

function createSshCredential(name: string, host: string, sshPrivateKeyEncrypted?: string): GitCredential {
  return {
    name,
    host,
    type: 'ssh',
    ...(sshPrivateKeyEncrypted ? { sshPrivateKeyEncrypted } : {}),
  } as GitCredential
}

describe('CredentialProvider', () => {
  let db: Database
  let settingsService: SettingsService
  let provider: CredentialProvider

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
    provider = new CredentialProvider(db)
  })

  describe('with seeded credentials', () => {
    const githubPat: GitCredential = createPatCredential('github-pat', 'github.com', 'ghp_test_token')
    const gitlabPat: GitCredential = createPatCredential('gitlab-pat', 'gitlab.com', 'glpat_test_token', 'custom-user')
    const githubSsh: GitCredential = createSshCredential('github-ssh', 'github.com')

    beforeEach(() => {
      settingsService.updateSettings({ gitCredentials: [githubPat, gitlabPat, githubSsh] })
    })

    it('getPatCredentialForHost returns the matching PAT credential', () => {
      const result = provider.getPatCredentialForHost('github.com')
      expect(result).toEqual({ username: 'x-access-token', password: 'ghp_test_token' })
    })

    it('getPatCredentialForHost uses custom username when provided', () => {
      const result = provider.getPatCredentialForHost('gitlab.com')
      expect(result).toEqual({ username: 'custom-user', password: 'glpat_test_token' })
    })

    it('getPatCredentialForHost returns null for unmatched host', () => {
      expect(provider.getPatCredentialForHost('bitbucket.org')).toBeNull()
    })

    it('getPatCredentialForHost prefers the configured default PAT for the host', () => {
      const first = createPatCredential('first', 'github.com', 'first-token', undefined, 'first-id')
      const second = createPatCredential('second', 'github.com', 'second-token', undefined, 'second-id')
      settingsService.updateSettings({ gitCredentials: [first, second], defaultGitCredentialId: 'second-id' })

      expect(provider.getPatCredentialForHost('github.com')).toEqual({ username: 'x-access-token', password: 'second-token' })
    })

    it('getPatCredentialForHost prefers repo-specific PAT for the cwd', () => {
      const first = createPatCredential('first', 'github.com', 'first-token', undefined, 'first-id')
      const second = createPatCredential('second', 'github.com', 'second-token', undefined, 'second-id')
      settingsService.updateSettings({ gitCredentials: [first, second], defaultGitCredentialId: 'first-id' })
      const repo = createRepo(db, {
        repoUrl: 'https://github.com/acme/repo.git',
        localPath: 'repo',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })
      setRepoGitCredentialId(db, repo.id, 'second-id')

      expect(provider.getPatCredentialForHost('github.com', { cwd: repo.fullPath })).toEqual({ username: 'x-access-token', password: 'second-token' })
    })

    it('getPatCredentialForHost ignores selected credentials for other hosts', () => {
      const github = createPatCredential('github', 'github.com', 'github-token', undefined, 'github-id')
      const gitlab = createPatCredential('gitlab', 'gitlab.com', 'gitlab-token', 'custom-user', 'gitlab-id')
      settingsService.updateSettings({ gitCredentials: [github, gitlab], defaultGitCredentialId: 'github-id' })

      expect(provider.getPatCredentialForHost('gitlab.com')).toEqual({ username: 'custom-user', password: 'gitlab-token' })
    })

    it('getGhCliEnv returns GH_TOKEN and GITHUB_TOKEN for GitHub PAT', () => {
      const env = provider.getGhCliEnv()
      expect(env).toEqual({ GH_TOKEN: 'ghp_test_token', GITHUB_TOKEN: 'ghp_test_token' })
    })

    it('getGhCliEnv prefers the configured default GitHub PAT', () => {
      const first = createPatCredential('first', 'github.com', 'first-token', undefined, 'first-id')
      const second = createPatCredential('second', 'github.com', 'second-token', undefined, 'second-id')
      settingsService.updateSettings({ gitCredentials: [first, second], defaultGitCredentialId: 'second-id' })

      expect(provider.getGhCliEnv()).toEqual({ GH_TOKEN: 'second-token', GITHUB_TOKEN: 'second-token' })
    })

    it('getGhCliEnv prefers repo-specific GitHub PAT for the cwd', () => {
      const first = createPatCredential('first', 'github.com', 'first-token', undefined, 'first-id')
      const second = createPatCredential('second', 'github.com', 'second-token', undefined, 'second-id')
      settingsService.updateSettings({ gitCredentials: [first, second], defaultGitCredentialId: 'first-id' })
      const repo = createRepo(db, {
        repoUrl: 'https://github.com/acme/repo.git',
        localPath: 'repo',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
      })
      setRepoGitCredentialId(db, repo.id, 'second-id')

      expect(provider.getGhCliEnv({ cwd: repo.fullPath })).toEqual({ GH_TOKEN: 'second-token', GITHUB_TOKEN: 'second-token' })
    })

    it('getGitEnv returns git config env for configured PATs', () => {
      const env = provider.getGitEnv()
      expect(env.GIT_TERMINAL_PROMPT).toBe('0')
      expect(env.GIT_CONFIG_COUNT).toBe('2')
    })

    it('getSshCredentialsForHost returns SSH credentials and excludes PATs', () => {
      const sshCreds = provider.getSshCredentialsForHost('github.com')
      expect(sshCreds).toHaveLength(1)
      expect(sshCreds[0]).toMatchObject({ name: 'github-ssh', type: 'ssh' })
    })

    it('getSshCredentialsForHost returns empty array for unmatched host', () => {
      expect(provider.getSshCredentialsForHost('gitlab.com')).toEqual([])
    })

    it('getSshCredentialsWithPrivateKey returns only encrypted SSH credentials', () => {
      const encryptedSsh = createSshCredential('encrypted-ssh', 'example.com', 'encrypted-key')
      settingsService.updateSettings({ gitCredentials: [githubPat, githubSsh, encryptedSsh] })
      expect(provider.getSshCredentialsWithPrivateKey()).toEqual([encryptedSsh])
    })
  })

  describe('with no credentials', () => {
    it('getPatCredentialForHost returns null', () => {
      expect(provider.getPatCredentialForHost('github.com')).toBeNull()
    })

    it('getGhCliEnv returns empty object', () => {
      expect(provider.getGhCliEnv()).toEqual({})
    })

    it('getGitEnv returns disabled terminal prompt defaults', () => {
      expect(provider.getGitEnv()).toEqual({ GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '0' })
    })

    it('getSshCredentialsForHost returns empty array', () => {
      expect(provider.getSshCredentialsForHost('github.com')).toEqual([])
    })

    it('getSshCredentialsWithPrivateKey returns empty array', () => {
      expect(provider.getSshCredentialsWithPrivateKey()).toEqual([])
    })
  })

  describe('getGitCredentials', () => {
    it('returns empty array when no credentials are stored', () => {
      expect(provider.getGitCredentials()).toEqual([])
    })

    it('returns all stored credentials', () => {
      const creds = [createPatCredential('test', 'example.com', 'tok'), createSshCredential('ssh-test', 'example.com')]
      settingsService.updateSettings({ gitCredentials: creds })
      expect(provider.getGitCredentials()).toHaveLength(2)
    })
  })
})
