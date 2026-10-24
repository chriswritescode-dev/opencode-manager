import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import { SecretsService } from '../../src/services/secrets'
import { ProjectConfigService } from '../../src/services/project-config'
import { createGitService } from '../../src/services/git/GitService'
import { createGlobalSecretRoutes, createRepoSecretRoutes } from '../../src/routes/secrets'
import type { GitAuthService } from '../../src/services/git-auth'
import type { SecretEntry } from '@opencode-manager/shared/schemas'

const gitAuthService = { getGitEnvironment: () => ({}) } as unknown as GitAuthService
const jsonHeaders = { 'Content-Type': 'application/json' }

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function createApp(db: Database): Hono {
  const secretsService = new SecretsService(db)
  const projectConfigService = new ProjectConfigService(db, createGitService(gitAuthService), gitAuthService)
  const app = new Hono()
  app.route('/secrets', createGlobalSecretRoutes(secretsService, 'secret'))
  app.route('/variables', createGlobalSecretRoutes(secretsService, 'variable'))
  app.route('/repos', createRepoSecretRoutes({ database: db, projectConfigService, secretsService }, 'secret'))
  app.route('/repos', createRepoSecretRoutes({ database: db, projectConfigService, secretsService }, 'variable'))
  return app
}

function seedRepo(db: Database): number {
  return createRepo(db, {
    localPath: 'repo-a',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isLocal: true,
  }).id
}

async function readItems(res: Response): Promise<SecretEntry[]> {
  const body = await res.json() as { items: SecretEntry[] }
  return body.items
}

describe('secret routes', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = createTestDb()
    app = createApp(db)
  })

  afterEach(() => {
    db.close()
  })

  it('lists global secrets and variables as empty initially', async () => {
    const secrets = await app.request('/secrets')
    const variables = await app.request('/variables')
    expect(secrets.status).toBe(200)
    expect(variables.status).toBe(200)
    expect(await readItems(secrets)).toEqual([])
    expect(await readItems(variables)).toEqual([])
  })

  it('stores a secret without ever returning its value', async () => {
    const put = await app.request('/secrets/token', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ value: 'super-secret' }),
    })
    expect(put.status).toBe(204)

    const list = await app.request('/secrets')
    const items = await readItems(list)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'TOKEN', environment: null })
    expect(items[0]).not.toHaveProperty('value')

    const stored = db.prepare('SELECT value FROM secrets WHERE name = ?').get('TOKEN') as { value: string }
    expect(stored.value).not.toBe('super-secret')
  })

  it('stores a variable and returns its value', async () => {
    const put = await app.request('/variables/log_level', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ value: 'debug' }),
    })
    expect(put.status).toBe(204)

    const items = await readItems(await app.request('/variables'))
    expect(items).toEqual([expect.objectContaining({ name: 'LOG_LEVEL', environment: null, value: 'debug' })])
  })

  it('normalizes names to upper case', async () => {
    await app.request('/secrets/my_token', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ value: 'v' }),
    })

    const items = await readItems(await app.request('/secrets'))
    expect(items[0]?.name).toBe('MY_TOKEN')
  })

  it('rejects invalid, GITHUB_, and reserved names with 400', async () => {
    for (const name of ['1BAD', 'GITHUB_TOKEN', 'PATH', 'OCM_SOMETHING']) {
      const res = await app.request(`/secrets/${name}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ value: 'v' }),
      })
      expect(res.status, name).toBe(400)
    }
  })

  it('enforces the 48 KiB value limit', async () => {
    const atLimit = await app.request('/variables/big', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ value: 'a'.repeat(48 * 1024) }),
    })
    expect(atLimit.status).toBe(204)

    const overLimit = await app.request('/variables/too_big', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ value: 'a'.repeat(48 * 1024 + 1) }),
    })
    expect(overLimit.status).toBe(400)
  })

  it('rejects an environment on a global secret', async () => {
    const res = await app.request('/secrets/token', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ value: 'v', environment: 'prod' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects an invalid JSON body', async () => {
    const global = await app.request('/secrets/token', {
      method: 'PUT',
      headers: jsonHeaders,
      body: '{not json',
    })
    expect(global.status).toBe(400)
    expect(await global.json()).toEqual({ error: 'Invalid JSON' })

    const repoId = seedRepo(db)
    const repo = await app.request(`/repos/${repoId}/secrets/token`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: '{not json',
    })
    expect(repo.status).toBe(400)
    expect(await repo.json()).toEqual({ error: 'Invalid JSON' })
  })

  it('rejects a body that fails validation', async () => {
    const res = await app.request('/secrets/token', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ value: '' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.any(String) })
  })

  it('deletes a global secret and returns 404 when missing', async () => {
    await app.request('/secrets/token', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ value: 'v' }),
    })

    expect((await app.request('/secrets/token', { method: 'DELETE' })).status).toBe(204)
    expect((await app.request('/secrets/token', { method: 'DELETE' })).status).toBe(404)
  })

  it('stores repository secrets against the repo and never returns values', async () => {
    const repoId = seedRepo(db)

    const put = await app.request(`/repos/${repoId}/secrets/token`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ value: 'repo-secret' }),
    })
    expect(put.status).toBe(204)

    const items = await readItems(await app.request(`/repos/${repoId}/secrets`))
    expect(items).toEqual([expect.objectContaining({ name: 'TOKEN', environment: null })])
    expect(items[0]).not.toHaveProperty('value')
  })

  it('supports repository environments and scoped deletes', async () => {
    const repoId = seedRepo(db)

    await app.request(`/repos/${repoId}/variables/deploy_url`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ value: 'https://example.test', environment: 'Production' }),
    })

    const items = await readItems(await app.request(`/repos/${repoId}/variables`))
    expect(items).toEqual([expect.objectContaining({ name: 'DEPLOY_URL', environment: 'production', value: 'https://example.test' })])

    const deleted = await app.request(`/repos/${repoId}/variables/deploy_url?environment=production`, { method: 'DELETE' })
    expect(deleted.status).toBe(204)

    const missing = await app.request(`/repos/${repoId}/variables/deploy_url?environment=production`, { method: 'DELETE' })
    expect(missing.status).toBe(404)
  })

  it('returns 404 for an unknown repository', async () => {
    const res = await app.request('/repos/9999/secrets')
    expect(res.status).toBe(404)
  })
})
