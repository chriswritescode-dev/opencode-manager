import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import type { OutputDefinitionInput } from '@opencode-manager/shared/schemas'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createOutputDefinitionRoutes } from '../../src/routes/output-definitions'
import { OutputDefinitionRegistry } from '../../src/services/outputs/definition-registry'

const SESSION_ID = 'ses_a'
const DEFINITION_ID = 'report'
const BASE_PATH = '/output-definitions'

interface DefinitionBody {
  definition: { id: string; label: string; origin: string }
}

interface DefinitionsBody {
  definitions: Array<{ id: string; label: string; origin: string }>
}

interface ErrorBody {
  error: string
  code?: string
}

function definitionInput(overrides: Partial<OutputDefinitionInput> = {}): OutputDefinitionInput {
  return {
    id: DEFINITION_ID,
    label: 'Report',
    description: '',
    icon: 'FileText',
    params: [],
    instructions: 'Write a report.',
    dataSchema: { type: 'object', properties: { total: { type: 'number' } } },
    renderer: { kind: 'template', html: '<p>{{total}}</p>' },
    generation: 'separateSession',
    ...overrides,
  }
}

function jsonRequest(body: unknown, method: string): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

describe('output definition routes', () => {
  let db: Database
  let registry: OutputDefinitionRegistry
  let app: Hono

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    registry = new OutputDefinitionRegistry(db)
    app = new Hono()
    app.route(BASE_PATH, createOutputDefinitionRoutes(registry))
  })

  afterEach(() => {
    db.close()
  })

  it('lists the built-in definitions', async () => {
    const response = await app.request(BASE_PATH)

    expect(response.status).toBe(200)
    const body = (await response.json()) as DefinitionsBody
    expect(body.definitions[0]).toMatchObject({ id: 'walkthrough', origin: 'builtin' })
  })

  it('lists a session definition with the sessionId query', async () => {
    registry.defineSession(SESSION_ID, definitionInput())

    const response = await app.request(`${BASE_PATH}?sessionId=${SESSION_ID}`)

    expect(response.status).toBe(200)
    const body = (await response.json()) as DefinitionsBody
    expect(body.definitions).toContainEqual(
      expect.objectContaining({ id: DEFINITION_ID, origin: 'session' }),
    )
  })

  it('creates a global definition and rejects a duplicate', async () => {
    const created = await app.request(BASE_PATH, jsonRequest(definitionInput(), 'POST'))

    expect(created.status).toBe(201)
    const createdBody = (await created.json()) as DefinitionBody
    expect(createdBody.definition).toMatchObject({ id: DEFINITION_ID, origin: 'global' })

    const duplicate = await app.request(BASE_PATH, jsonRequest(definitionInput(), 'POST'))

    expect(duplicate.status).toBe(409)
    const duplicateBody = (await duplicate.json()) as ErrorBody
    expect(duplicateBody.code).toBe('OUTPUT_DEFINITION_EXISTS')
  })

  it('upserts and deletes a global definition', async () => {
    const put = await app.request(
      `${BASE_PATH}/${DEFINITION_ID}`,
      jsonRequest(definitionInput({ label: 'Updated' }), 'PUT'),
    )

    expect(put.status).toBe(200)
    const putBody = (await put.json()) as DefinitionBody
    expect(putBody.definition).toMatchObject({ id: DEFINITION_ID, label: 'Updated', origin: 'global' })

    const deleted = await app.request(`${BASE_PATH}/${DEFINITION_ID}`, { method: 'DELETE' })
    expect(deleted.status).toBe(204)

    const missing = await app.request(`${BASE_PATH}/${DEFINITION_ID}`, { method: 'DELETE' })
    expect(missing.status).toBe(404)
  })

  it('rejects a route-level invalid body', async () => {
    const response = await app.request(BASE_PATH, jsonRequest({}, 'POST'))

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorBody
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('promotes a session definition, requiring replace over an existing global', async () => {
    registry.defineSession(SESSION_ID, definitionInput({ label: 'Session report' }))
    registry.createGlobal(definitionInput({ label: 'Global report' }))

    const conflict = await app.request(
      `${BASE_PATH}/promote`,
      jsonRequest({ sessionId: SESSION_ID, id: DEFINITION_ID }, 'POST'),
    )
    expect(conflict.status).toBe(409)
    expect(((await conflict.json()) as ErrorBody).code).toBe('OUTPUT_DEFINITION_EXISTS')

    const promoted = await app.request(
      `${BASE_PATH}/promote`,
      jsonRequest({ sessionId: SESSION_ID, id: DEFINITION_ID, replace: true }, 'POST'),
    )
    expect(promoted.status).toBe(201)
    expect(((await promoted.json()) as DefinitionBody).definition).toMatchObject({
      id: DEFINITION_ID,
      label: 'Session report',
      origin: 'global',
    })
  })
})
