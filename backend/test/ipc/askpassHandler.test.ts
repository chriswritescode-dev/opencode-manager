import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'bun:sqlite'
import { SettingsService } from '../../src/services/settings'
import { CredentialProvider } from '../../src/services/credential-provider'
import { AskpassHandler } from '../../src/ipc/askpassHandler'
import { createRepo, setRepoGitCredentialId } from '../../src/db/queries'
import type { GitCredential } from '@opencode-manager/shared'
import { createTestDatabase } from '../helpers/test-database'

function createGitHubPatCredential(token: string = 'ghp_test_token', id?: string): GitCredential {
  const credential: GitCredential = {
    name: 'github-pat',
    host: 'github.com',
    type: 'pat',
    username: 'x-access-token',
    token,
  }
  if (id !== undefined) credential.id = id
  return credential
}

describe('AskpassHandler', () => {
  let db: Database
  let settingsService: SettingsService
  let provider: CredentialProvider
  let handler: AskpassHandler

  beforeEach(() => {
    db = createTestDatabase()
    settingsService = new SettingsService(db)
    settingsService.updateSettings({
      gitCredentials: [createGitHubPatCredential()],
    })
    provider = new CredentialProvider(db)
    handler = new AskpassHandler(undefined, provider)
  })

  afterEach(() => {
    db.close()
  })

  it('returns username on Username prompt for configured host', async () => {
    const result = await handler.handle({
      askpassType: 'https',
      argv: ['', '', "Username for 'https://github.com'", '', 'https://github.com'],
    })
    expect(result).toBe('x-access-token')
  })

  it('returns token on Password prompt after Username (cache path)', async () => {
    await handler.handle({
      askpassType: 'https',
      argv: ['', '', "Username for 'https://github.com'", '', 'https://github.com'],
    })

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

  it('returns the repo-specific token for askpass requests with repo cwd', async () => {
    const defaultCredential = createGitHubPatCredential('default-token', 'default-id')
    const repoCredential = createGitHubPatCredential('repo-token', 'repo-id')
    settingsService.updateSettings({
      gitCredentials: [defaultCredential, repoCredential],
      defaultGitCredentialId: 'default-id',
    })
    const repo = createRepo(db, {
      repoUrl: 'https://github.com/acme/repo.git',
      localPath: 'repo',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
    })
    setRepoGitCredentialId(db, repo.id, 'repo-id')

    await handler.handle({
      askpassType: 'https',
      argv: ['', '', "Username for 'https://github.com'", '', 'https://github.com'],
      cwd: repo.fullPath,
    })
    const result = await handler.handle({
      askpassType: 'https',
      argv: ['', '', "Password for 'https://github.com'", '', 'https://github.com'],
      cwd: repo.fullPath,
    })

    expect(result).toBe('repo-token')
  })

  it('keeps askpass cache separate per repo cwd', async () => {
    const repoOneCredential = createGitHubPatCredential('repo-one-token', 'repo-one-id')
    const repoTwoCredential = createGitHubPatCredential('repo-two-token', 'repo-two-id')
    settingsService.updateSettings({ gitCredentials: [repoOneCredential, repoTwoCredential] })
    const repoOne = createRepo(db, {
      repoUrl: 'https://github.com/acme/one.git',
      localPath: 'one',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
    })
    const repoTwo = createRepo(db, {
      repoUrl: 'https://github.com/acme/two.git',
      localPath: 'two',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
    })
    setRepoGitCredentialId(db, repoOne.id, 'repo-one-id')
    setRepoGitCredentialId(db, repoTwo.id, 'repo-two-id')

    await handler.handle({
      askpassType: 'https',
      argv: ['', '', "Username for 'https://github.com'", '', 'https://github.com'],
      cwd: repoOne.fullPath,
    })
    await handler.handle({
      askpassType: 'https',
      argv: ['', '', "Username for 'https://github.com'", '', 'https://github.com'],
      cwd: repoTwo.fullPath,
    })

    const repoOnePassword = await handler.handle({
      askpassType: 'https',
      argv: ['', '', "Password for 'https://github.com'", '', 'https://github.com'],
      cwd: repoOne.fullPath,
    })
    const repoTwoPassword = await handler.handle({
      askpassType: 'https',
      argv: ['', '', "Password for 'https://github.com'", '', 'https://github.com'],
      cwd: repoTwo.fullPath,
    })

    expect(repoOnePassword).toBe('repo-one-token')
    expect(repoTwoPassword).toBe('repo-two-token')
  })
})
