import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Database } from 'bun:sqlite'
import type { CreatePromptTemplateRequest } from '@opencode-manager/shared/schemas'
import { createTestDatabase } from '../helpers/test-database'
import { PromptTemplateService, PromptTemplateServiceError } from '../../src/services/prompt-templates'

function createTemplateInput(overrides: Partial<CreatePromptTemplateRequest> = {}): CreatePromptTemplateRequest {
  return {
    title: 'Daily standup',
    category: 'standup',
    cadenceHint: 'daily',
    suggestedName: 'daily-standup',
    suggestedDescription: 'Summarize yesterday',
    description: 'A standup prompt',
    prompt: 'Summarize my work',
    ...overrides,
  }
}

function expectTemplateNotFound(run: () => void): void {
  try {
    run()
    expect.unreachable('expected a PromptTemplateServiceError')
  } catch (error) {
    if (!(error instanceof PromptTemplateServiceError)) throw error
    expect(error.statusCode).toBe(404)
    expect(error.message).toBe('Template not found')
  }
}

describe('PromptTemplateService', () => {
  let db: Database
  let service: PromptTemplateService

  beforeEach(() => {
    db = createTestDatabase()
    service = new PromptTemplateService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('creates, lists, and gets a template', () => {
    const created = service.create(createTemplateInput())

    expect(service.list().map(template => template.id)).toContain(created.id)
    expect(service.getById(created.id)).toEqual(created)
  })

  it('throws a 404 service error when a template is missing', () => {
    expectTemplateNotFound(() => service.getById(999))
  })

  it('updates an existing template', () => {
    const created = service.create(createTemplateInput())

    const updated = service.update(created.id, { title: 'Renamed' })

    expect(updated.title).toBe('Renamed')
    expect(service.getById(created.id).title).toBe('Renamed')
  })

  it('throws a 404 service error when updating a missing template', () => {
    expectTemplateNotFound(() => service.update(999, { title: 'Missing' }))
  })

  it('deletes an existing template', () => {
    const created = service.create(createTemplateInput())

    service.delete(created.id)

    expect(service.list().map(template => template.id)).not.toContain(created.id)
  })

  it('throws a 404 service error when deleting a missing template', () => {
    expectTemplateNotFound(() => service.delete(999))
  })
})
