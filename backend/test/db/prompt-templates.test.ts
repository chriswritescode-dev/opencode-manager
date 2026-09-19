import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import {
  listPromptTemplates,
  getPromptTemplateById,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
} from '../../src/db/prompt-templates'

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

describe('prompt template repository', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
  })

  afterEach(() => {
    db.close()
  })

  it('lists the seeded templates in ascending id order', () => {
    const templates = listPromptTemplates(db)

    expect(templates.length).toBeGreaterThan(0)
    expect(templates.map(template => template.id)).toEqual(
      [...templates].map(template => template.id).sort((a, b) => a - b),
    )
  })

  it('creates a template and reads it back by id', () => {
    const created = createPromptTemplate(db, createTemplateInput())

    expect(created.id).toBeGreaterThan(0)
    expect(created.title).toBe('Daily standup')
    expect(created.prompt).toBe('Summarize my work')
    expect(created.createdAt).toBeGreaterThan(0)
    expect(getPromptTemplateById(db, created.id)).toEqual(created)
  })

  it('includes newly created templates in the list ordered by id', () => {
    const first = createPromptTemplate(db, createTemplateInput({ title: 'First' }))
    const second = createPromptTemplate(db, createTemplateInput({ title: 'Second' }))

    const ids = listPromptTemplates(db).map(template => template.id)
    expect(ids).toContain(first.id)
    expect(ids).toContain(second.id)
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id))
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
  })

  it('returns null for an unknown template id', () => {
    expect(getPromptTemplateById(db, 999)).toBeNull()
  })

  it('updates provided fields and preserves the rest', () => {
    const created = createPromptTemplate(db, createTemplateInput())

    const updated = updatePromptTemplate(db, created.id, {
      title: 'Renamed',
      prompt: 'Updated prompt',
    })

    expect(updated?.title).toBe('Renamed')
    expect(updated?.prompt).toBe('Updated prompt')
    expect(updated?.category).toBe(created.category)
    expect(updated?.suggestedName).toBe(created.suggestedName)
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
    expect(getPromptTemplateById(db, created.id)).toEqual(updated)
  })

  it('returns null when updating an unknown template', () => {
    expect(updatePromptTemplate(db, 999, { title: 'Missing' })).toBeNull()
  })

  it('deletes an existing template and reports success', () => {
    const created = createPromptTemplate(db, createTemplateInput())

    expect(deletePromptTemplate(db, created.id)).toBe(true)
    expect(getPromptTemplateById(db, created.id)).toBeNull()
    expect(listPromptTemplates(db).map(template => template.id)).not.toContain(created.id)
  })

  it('returns false when deleting an unknown template', () => {
    expect(deletePromptTemplate(db, 999)).toBe(false)
  })
})
