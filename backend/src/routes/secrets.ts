import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import { EnvironmentNameSchema, SecretNameSchema, SetSecretRequestSchema, type SecretKind } from '@opencode-manager/shared/schemas'
import { getRepoById } from '../db/queries'
import { SecretsService, SecretsServiceError } from '../services/secrets'
import type { ProjectConfigService } from '../services/project-config'
import { handleServiceError } from '../utils/route-helpers'

function readName(c: Context): { name: string } | Response {
  const parsed = SecretNameSchema.safeParse(c.req.param('name'))
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid name' }, 400)
  }
  return { name: parsed.data }
}

function readEnvironmentQuery(c: Context): { environment: string | null } | Response {
  const value = c.req.query('environment')
  if (value === undefined) {
    return { environment: null }
  }

  const parsed = EnvironmentNameSchema.safeParse(value)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid environment' }, 400)
  }
  return { environment: parsed.data }
}

export function createGlobalSecretRoutes(secretsService: SecretsService, kind: SecretKind) {
  const app = new Hono()

  app.get('/', (c) => c.json({ items: secretsService.list(kind, null) }))

  app.put('/:name', async (c) => {
    const name = readName(c)
    if (name instanceof Response) return name

    const body = await c.req.json().catch(() => ({}))
    const parsed = SetSecretRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400)
    }

    try {
      secretsService.set(kind, null, parsed.data.environment ?? null, name.name, parsed.data.value)
      return c.body(null, 204)
    } catch (error: unknown) {
      return handleServiceError(c, error, 'Failed to store secret', SecretsServiceError)
    }
  })

  app.delete('/:name', (c) => {
    const name = readName(c)
    if (name instanceof Response) return name

    const deleted = secretsService.delete(kind, null, null, name.name)
    if (!deleted) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.body(null, 204)
  })

  return app
}

export interface RepoSecretRouteDeps {
  database: Database
  projectConfigService: ProjectConfigService
  secretsService: SecretsService
}

export function createRepoSecretRoutes(deps: RepoSecretRouteDeps, kind: SecretKind) {
  const { database, projectConfigService, secretsService } = deps
  const segment = kind === 'secret' ? 'secrets' : 'variables'
  const app = new Hono()

  const resolveProjectRepo = async (c: Context): Promise<Repo | Response> => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid repo id' }, 400)
    }

    const repo = getRepoById(database, id)
    if (!repo) {
      return c.json({ error: 'Repo not found' }, 404)
    }

    return projectConfigService.resolveProjectRepo(repo)
  }

  app.get(`/:id/${segment}`, async (c) => {
    const repo = await resolveProjectRepo(c)
    if (repo instanceof Response) return repo
    return c.json({ items: secretsService.list(kind, repo.id) })
  })

  app.put(`/:id/${segment}/:name`, async (c) => {
    const name = readName(c)
    if (name instanceof Response) return name

    const body = await c.req.json().catch(() => ({}))
    const parsed = SetSecretRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400)
    }

    const repo = await resolveProjectRepo(c)
    if (repo instanceof Response) return repo

    try {
      secretsService.set(kind, repo.id, parsed.data.environment ?? null, name.name, parsed.data.value)
      return c.body(null, 204)
    } catch (error: unknown) {
      return handleServiceError(c, error, 'Failed to store secret', SecretsServiceError)
    }
  })

  app.delete(`/:id/${segment}/:name`, async (c) => {
    const name = readName(c)
    if (name instanceof Response) return name

    const environment = readEnvironmentQuery(c)
    if (environment instanceof Response) return environment

    const repo = await resolveProjectRepo(c)
    if (repo instanceof Response) return repo

    const deleted = secretsService.delete(kind, repo.id, environment.environment, name.name)
    if (!deleted) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.body(null, 204)
  })

  return app
}
