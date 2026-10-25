import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
import { SettingsService } from '../../../src/services/settings'
import { createInternalGitCredentialsRoutes } from '../../../src/routes/internal/git-credentials'
import type { GitCredential } from '@opencode-manager/shared'

describe('legacy internal git-credentials routes', () => {
  let db: Database
  let settingsService: SettingsService

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
  })

  it('answers the adopted-process gh-env path with the flat GitHub CLI env', async () => {
    settingsService.updateSettings({
      gitCredentials: [
        { name: 'github', host: 'github.com', type: 'pat', token: 'ghp_legacy_token' } as GitCredential,
      ],
    })
    const app = createInternalGitCredentialsRoutes(db)

    const res = await app.request('/gh-env')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ GH_TOKEN: 'ghp_legacy_token', GITHUB_TOKEN: 'ghp_legacy_token' })
  })

  it('accepts the legacy cwd query parameter', async () => {
    const app = createInternalGitCredentialsRoutes(db)

    const res = await app.request('/gh-env?cwd=/tmp/any-repo')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })
})
