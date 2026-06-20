import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { SettingsService } from '../../src/services/settings'
import { CredentialProvider } from '../../src/services/credential-provider'
import { AskpassHandler } from '../../src/ipc/askpassHandler'
import type { GitCredential } from '@opencode-manager/shared'

function createGitHubPatCredential(): GitCredential {
  return {
    name: 'github-pat',
    host: 'github.com',
    type: 'pat' as const,
    username: 'x-access-token',
    token: 'ghp_test_token',
  } as GitCredential
}

describe('AskpassHandler', () => {
  let db: Database
  let settingsService: SettingsService
  let provider: CredentialProvider
  let handler: AskpassHandler

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
    settingsService.updateSettings({
      gitCredentials: [createGitHubPatCredential()],
    })
    provider = new CredentialProvider(db)
    handler = new AskpassHandler(undefined, provider)
  })

  it('returns username on Username prompt for configured host', async () => {
    const result = await handler.handle({
      askpassType: 'https',
      argv: ['', '', "Username for 'https://github.com'", '', 'https://github.com'],
    })
    expect(result).toBe('x-access-token')
  })

  it('returns token on Password prompt after Username (cache path)', async () => {
    // First call to populate cache
    await handler.handle({
      askpassType: 'https',
      argv: ['', '', "Username for 'https://github.com'", '', 'https://github.com'],
    })

    // Second call should use cache
    const result = await handler.handle({
      askpassType: 'https',
      argv: ['', '', "Password for 'https://github.com'", '', 'https://github.com'],
    })
    expect(result).toBe('ghp_test_token')
  })

  it('returns empty string for unknown host', async () => {
    const result = await handler.handle({
      askpassType: 'https',
      argv: ['', '', "Username for 'https://unknown.example.com'", '', 'https://unknown.example.com'],
    })
    expect(result).toBe('')
  })
})
