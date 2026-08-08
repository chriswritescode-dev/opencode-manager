import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
import { SettingsService } from '../../../src/services/settings'
import { createInternalGitCredentialsRoutes } from '../../../src/routes/internal/git-credentials'
import type { GitCredential } from '@opencode-manager/shared'

describe('internal git-credentials routes', () => {
  let db: Database
  let settingsService: SettingsService
  let app: ReturnType<typeof createInternalGitCredentialsRoutes>

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
    app = createInternalGitCredentialsRoutes(db)
  })

  it('GET /gh-env returns GH_TOKEN and GITHUB_TOKEN for a GitHub PAT', async () => {
    settingsService.updateSettings({
      gitCredentials: [
        { name: 'github', host: 'github.com', type: 'pat', token: 'ghp_test_token' } as GitCredential,
      ],
    })

    const res = await app.request('/gh-env')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ GH_TOKEN: 'ghp_test_token', GITHUB_TOKEN: 'ghp_test_token' })
  })

  it('GET /gh-env returns an empty object when no GitHub credential exists', async () => {
    const res = await app.request('/gh-env')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })
})
