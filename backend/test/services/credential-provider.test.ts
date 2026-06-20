import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { SettingsService } from '../../src/services/settings'
import { CredentialProvider } from '../../src/services/credential-provider'
import type { GitCredential } from '@opencode-manager/shared'

function createPatCredential(name: string, host: string, token: string, username?: string): GitCredential {
  return {
    name,
    host,
    token,
    ...(username ? { username } : {}),
  } as GitCredential
}

function createSshCredential(name: string, host: string): GitCredential {
  return {
    name,
    host,
    type: 'ssh',
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

    it('getGhCliEnv returns GH_TOKEN and GITHUB_TOKEN for GitHub PAT', () => {
      const env = provider.getGhCliEnv()
      expect(env).toEqual({ GH_TOKEN: 'ghp_test_token', GITHUB_TOKEN: 'ghp_test_token' })
    })

    it('getSshCredentialsForHost returns SSH credentials and excludes PATs', () => {
      const sshCreds = provider.getSshCredentialsForHost('github.com')
      expect(sshCreds).toHaveLength(1)
      expect(sshCreds[0]).toMatchObject({ name: 'github-ssh', type: 'ssh' })
    })

    it('getSshCredentialsForHost returns empty array for unmatched host', () => {
      expect(provider.getSshCredentialsForHost('gitlab.com')).toEqual([])
    })

    it('getGitHubCredential returns the GitHub PAT', () => {
      const cred = provider.getGitHubCredential()
      expect(cred).not.toBeNull()
      expect(cred!.host).toBe('github.com')
      expect(cred!.token).toBe('ghp_test_token')
    })

    it('getGitHubCredential excludes SSH credentials', () => {
      const cred = provider.getGitHubCredential()
      expect(cred!.type).not.toBe('ssh')
    })
  })

  describe('with no credentials', () => {
    it('getPatCredentialForHost returns null', () => {
      expect(provider.getPatCredentialForHost('github.com')).toBeNull()
    })

    it('getGhCliEnv returns empty object', () => {
      expect(provider.getGhCliEnv()).toEqual({})
    })

    it('getSshCredentialsForHost returns empty array', () => {
      expect(provider.getSshCredentialsForHost('github.com')).toEqual([])
    })

    it('getGitHubCredential returns null', () => {
      expect(provider.getGitHubCredential()).toBeNull()
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
