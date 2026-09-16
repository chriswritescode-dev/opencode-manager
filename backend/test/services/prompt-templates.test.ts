import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { PromptTemplateService, PromptTemplateServiceError } from '../../src/services/prompt-templates'

function createTemplateInput(overrides: Record<string, unknown> = {}) {
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

describe('PromptTemplateService', () => {
  let db: Database
  let service: PromptTemplateService

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
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
    expect(() => service.getById(999)).toThrow(PromptTemplateServiceError)

    try {
      service.getById(999)
    } catch (error) {
      expect(error).toBeInstanceOf(PromptTemplateServiceError)
      expect((error as PromptTemplateServiceError).statusCode).toBe(404)
      expect((error as Error).message).toBe('Template not found')
    }
  })

  it('updates an existing template', () => {
    const created = service.create(createTemplateInput())

    const updated = service.update(created.id, { title: 'Renamed' })

    expect(updated.title).toBe('Renamed')
    expect(service.getById(created.id).title).toBe('Renamed')
  })

  it('throws a 404 service error when updating a missing template', () => {
    try {
      service.update(999, { title: 'Missing' })
      throw new Error('expected update to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PromptTemplateServiceError)
      expect((error as PromptTemplateServiceError).statusCode).toBe(404)
    }
  })

  it('deletes an existing template', () => {
    const created = service.create(createTemplateInput())

    service.delete(created.id)

    expect(service.list().map(template => template.id)).not.toContain(created.id)
  })

  it('throws a 404 service error when deleting a missing template', () => {
    try {
      service.delete(999)
      throw new Error('expected delete to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PromptTemplateServiceError)
      expect((error as PromptTemplateServiceError).statusCode).toBe(404)
    }
  })
})
