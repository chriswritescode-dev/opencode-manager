import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import type { CreatePromptTemplateRequest } from '@opencode-manager/shared/schemas'
import { PromptTemplateSchema } from '@opencode-manager/shared/schemas'
import { createPromptTemplateRoutes } from '../../src/routes/prompt-templates'
import { createTestDatabase } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'

const TemplatesResponseSchema = z.object({ templates: z.array(PromptTemplateSchema) })
const TemplateResponseSchema = z.object({ template: PromptTemplateSchema })
const ErrorResponseSchema = z.object({ error: z.string() })

const newTemplate: CreatePromptTemplateRequest = {
  title: 'Test Template',
  category: 'Test',
  cadenceHint: 'Daily',
  suggestedName: 'Test job name',
  suggestedDescription: 'Test description',
  description: 'Test description',
  prompt: 'Test prompt content',
}

describe('prompt template routes', () => {
  let db: Database
  let app: ReturnType<typeof createPromptTemplateRoutes>

  beforeEach(() => {
    db = createTestDatabase()
    app = createPromptTemplateRoutes(db)
  })

  it('lists the templates seeded by the migration', async () => {
    const response = await app.request('/')
    expect(response.status).toBe(200)

    const body = await readJson(response, TemplatesResponseSchema)
    expect(body.templates.map((template) => template.title)).toEqual(
      expect.arrayContaining(['Repo Health Report', 'Dependency Watchlist']),
    )
  })

  it('creates a template and returns 201', async () => {
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTemplate),
    })

    expect(response.status).toBe(201)
    const body = await readJson(response, TemplateResponseSchema)
    expect(body.template.title).toBe('Test Template')
    expect(body.template.id).toBeGreaterThan(0)

    const persisted = await readJson(await app.request(`/${body.template.id}`), TemplateResponseSchema)
    expect(persisted.template).toEqual(body.template)
  })

  it('gets a template by id', async () => {
    const created = await readJson(
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTemplate),
      }),
      TemplateResponseSchema,
    )

    const response = await app.request(`/${created.template.id}`)

    expect(response.status).toBe(200)
    const body = await readJson(response, TemplateResponseSchema)
    expect(body.template.id).toBe(created.template.id)
    expect(body.template.title).toBe('Test Template')
  })

  it('returns 404 for a missing template', async () => {
    const response = await app.request('/99999')

    expect(response.status).toBe(404)
    const body = await readJson(response, ErrorResponseSchema)
    expect(body.error).toBe('Template not found')
  })

  it('updates a template and persists the change', async () => {
    const created = await readJson(
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTemplate),
      }),
      TemplateResponseSchema,
    )

    const updateResponse = await app.request(`/${created.template.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title' }),
    })

    expect(updateResponse.status).toBe(200)
    const updated = await readJson(updateResponse, TemplateResponseSchema)
    expect(updated.template.title).toBe('Updated Title')

    const persisted = await readJson(await app.request(`/${created.template.id}`), TemplateResponseSchema)
    expect(persisted.template.title).toBe('Updated Title')
    expect(persisted.template.prompt).toBe(newTemplate.prompt)
  })

  it('returns 404 when updating a missing template', async () => {
    const response = await app.request('/99999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nope' }),
    })

    expect(response.status).toBe(404)
  })

  it('deletes a template and returns 204', async () => {
    const created = await readJson(
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTemplate),
      }),
      TemplateResponseSchema,
    )

    const deleteResponse = await app.request(`/${created.template.id}`, { method: 'DELETE' })
    expect(deleteResponse.status).toBe(204)

    const getResponse = await app.request(`/${created.template.id}`)
    expect(getResponse.status).toBe(404)
  })

  it('returns 404 when deleting a missing template', async () => {
    const response = await app.request('/99999', { method: 'DELETE' })

    expect(response.status).toBe(404)
  })
})
