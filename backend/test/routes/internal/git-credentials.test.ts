import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { z } from 'zod'
import { SettingsService } from '../../../src/services/settings'
import { createInternalGitCredentialsRoutes } from '../../../src/routes/internal/git-credentials'
import { createTestDatabase } from '../../helpers/test-database'
import { readJson } from '../../helpers/read-json'

const GhCliEnvSchema = z.record(z.string(), z.string())

describe('legacy internal git-credentials routes', () => {
  let db: Database
  let settingsService: SettingsService

  beforeEach(() => {
    db = createTestDatabase()
    settingsService = new SettingsService(db)
  })

  it('answers the adopted-process gh-env path with the flat GitHub CLI env', async () => {
    settingsService.updateSettings({
      gitCredentials: [{ name: 'github', host: 'github.com', type: 'pat', token: 'ghp_legacy_token' }],
    })
    const app = createInternalGitCredentialsRoutes(db)

    const res = await app.request('/gh-env')

    expect(res.status).toBe(200)
    expect(await readJson(res, GhCliEnvSchema)).toEqual({
      GH_TOKEN: 'ghp_legacy_token',
      GITHUB_TOKEN: 'ghp_legacy_token',
    })
  })

  it('accepts the legacy cwd query parameter', async () => {
    const app = createInternalGitCredentialsRoutes(db)

    const res = await app.request('/gh-env?cwd=/tmp/any-repo')

    expect(res.status).toBe(200)
    expect(await readJson(res, GhCliEnvSchema)).toEqual({})
  })
})
