import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { z } from 'zod'
import { SettingsService } from '../../../src/services/settings'
import { createInternalShellEnvRoutes } from '../../../src/routes/internal/shell-env'
import type { RepoEnvResolver, ResolvedRepoEnv } from '../../../src/services/repo-env'
import { createTestDatabase } from '../../helpers/test-database'
import { readJson } from '../../helpers/read-json'

const ShellEnvResponseSchema = z.object({
  env: z.record(z.string(), z.string()),
  mask: z.array(z.string()),
})

function createRepoEnvService(resolve: (cwd: string) => Promise<ResolvedRepoEnv>): RepoEnvResolver {
  return { resolveForDirectory: vi.fn(resolve) }
}

describe('internal shell-env routes', () => {
  let db: Database
  let settingsService: SettingsService

  function appWith(repoEnvService: RepoEnvResolver) {
    return createInternalShellEnvRoutes(db, repoEnvService)
  }

  beforeEach(() => {
    db = createTestDatabase()
    settingsService = new SettingsService(db)
  })

  it('returns GH_TOKEN and GITHUB_TOKEN for a GitHub PAT when no cwd is given', async () => {
    settingsService.updateSettings({
      gitCredentials: [{ name: 'github', host: 'github.com', type: 'pat', token: 'ghp_test_token' }],
    })
    const repoEnvService = createRepoEnvService(async () => ({ env: {}, maskValues: [] }))
    const app = appWith(repoEnvService)

    const res = await app.request('/')

    expect(res.status).toBe(200)
    expect(await readJson(res, ShellEnvResponseSchema)).toEqual({
      env: { GH_TOKEN: 'ghp_test_token', GITHUB_TOKEN: 'ghp_test_token' },
      mask: [],
    })
    expect(repoEnvService.resolveForDirectory).not.toHaveBeenCalled()
  })

  it('returns an empty GH env when no GitHub credential exists', async () => {
    const app = appWith(createRepoEnvService(async () => ({ env: {}, maskValues: [] })))

    const res = await app.request('/')

    expect(res.status).toBe(200)
    expect(await readJson(res, ShellEnvResponseSchema)).toEqual({ env: {}, mask: [] })
  })

  it('merges the mapped repository env and mask after the GitHub env for a cwd', async () => {
    settingsService.updateSettings({
      gitCredentials: [{ name: 'github', host: 'github.com', type: 'pat', token: 'ghp_repo_token' }],
      gitIdentities: [{ id: 'work', name: 'Work User', email: 'work@example.com' }],
    })
    const repoEnvService = createRepoEnvService(async () => ({
      env: { API_URL: 'https://internal.example', GITHUB_TOKEN: 'mapped' },
      maskValues: ['super-secret'],
    }))
    const app = appWith(repoEnvService)

    const res = await app.request('/?cwd=/tmp/any-repo')

    expect(res.status).toBe(200)
    expect(await readJson(res, ShellEnvResponseSchema)).toEqual({
      env: { GH_TOKEN: 'ghp_repo_token', GITHUB_TOKEN: 'mapped', API_URL: 'https://internal.example' },
      mask: ['super-secret'],
    })
    expect(repoEnvService.resolveForDirectory).toHaveBeenCalledWith('/tmp/any-repo')
  })

  it('skips the repository env resolution when the shell is sandboxed', async () => {
    settingsService.updateSettings({
      gitCredentials: [{ name: 'github', host: 'github.com', type: 'pat', token: 'ghp_repo_token' }],
    })
    const repoEnvService = createRepoEnvService(async () => ({
      env: { API_URL: 'https://internal.example' },
      maskValues: ['super-secret'],
    }))
    const app = appWith(repoEnvService)

    const res = await app.request('/?cwd=/tmp/any-repo&sandboxed=1')

    expect(res.status).toBe(200)
    expect(await readJson(res, ShellEnvResponseSchema)).toEqual({
      env: { GH_TOKEN: 'ghp_repo_token', GITHUB_TOKEN: 'ghp_repo_token' },
      mask: [],
    })
    expect(repoEnvService.resolveForDirectory).not.toHaveBeenCalled()
  })
})
