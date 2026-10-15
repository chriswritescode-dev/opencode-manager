import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
import { SettingsService } from '../../../src/services/settings'
import { createInternalShellEnvRoutes } from '../../../src/routes/internal/shell-env'
import type { RepoEnvService, ResolvedRepoEnv } from '../../../src/services/repo-env'
import type { GitCredential } from '@opencode-manager/shared'

function createRepoEnvService(resolve: (cwd: string) => Promise<ResolvedRepoEnv>): RepoEnvService {
  return { resolveForDirectory: vi.fn(resolve) } as unknown as RepoEnvService
}

describe('internal shell-env routes', () => {
  let db: Database
  let settingsService: SettingsService

  function appWith(repoEnvService: RepoEnvService) {
    return createInternalShellEnvRoutes(db, repoEnvService)
  }

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
  })

  it('returns GH_TOKEN and GITHUB_TOKEN for a GitHub PAT when no cwd is given', async () => {
    settingsService.updateSettings({
      gitCredentials: [
        { name: 'github', host: 'github.com', type: 'pat', token: 'ghp_test_token' } as GitCredential,
      ],
    })
    const repoEnvService = createRepoEnvService(async () => ({ env: {}, maskValues: [], missing: [] }))
    const app = appWith(repoEnvService)

    const res = await app.request('/')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ env: { GH_TOKEN: 'ghp_test_token', GITHUB_TOKEN: 'ghp_test_token' }, mask: [] })
    expect(repoEnvService.resolveForDirectory).not.toHaveBeenCalled()
  })

  it('returns an empty GH env when no GitHub credential exists', async () => {
    const app = appWith(createRepoEnvService(async () => ({ env: {}, maskValues: [], missing: [] })))

    const res = await app.request('/')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ env: {}, mask: [] })
  })

  it('merges the mapped repository env and mask after the GitHub env for a cwd', async () => {
    settingsService.updateSettings({
      gitCredentials: [
        { name: 'github', host: 'github.com', type: 'pat', token: 'ghp_repo_token' } as GitCredential,
      ],
      gitIdentities: [{ id: 'work', name: 'Work User', email: 'work@example.com' }],
    })
    const repoEnvService = createRepoEnvService(async () => ({
      env: { API_URL: 'https://internal.example', GITHUB_TOKEN: 'mapped' },
      maskValues: ['super-secret'],
      missing: [],
    }))
    const app = appWith(repoEnvService)

    const res = await app.request('/?cwd=/tmp/any-repo')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      env: { GH_TOKEN: 'ghp_repo_token', GITHUB_TOKEN: 'mapped', API_URL: 'https://internal.example' },
      mask: ['super-secret'],
    })
    expect(repoEnvService.resolveForDirectory).toHaveBeenCalledWith('/tmp/any-repo')
  })
})
