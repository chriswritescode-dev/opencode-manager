import type { Database } from 'bun:sqlite'
import {
  PromptTemplateSchema,
  type PromptTemplate,
  type CreatePromptTemplateRequest,
  type UpdatePromptTemplateRequest,
} from '@opencode-manager/shared/schemas'
import { z } from 'zod'
import { selectRow, selectRows } from './rows'

const PromptTemplateRowSchema = z.object({
  id: z.number(),
  title: z.string(),
  category: z.string(),
  cadence_hint: z.string(),
  suggested_name: z.string(),
  suggested_description: z.string(),
  description: z.string(),
  prompt: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
})

type PromptTemplateRow = z.infer<typeof PromptTemplateRowSchema>

function rowToPromptTemplate(row: PromptTemplateRow): PromptTemplate {
  return PromptTemplateSchema.parse({
    id: row.id,
    title: row.title,
    category: row.category,
    cadenceHint: row.cadence_hint,
    suggestedName: row.suggested_name,
    suggestedDescription: row.suggested_description,
    description: row.description,
    prompt: row.prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

export function listPromptTemplates(db: Database): PromptTemplate[] {
  const rows = selectRows(db, PromptTemplateRowSchema, 'SELECT * FROM prompt_templates ORDER BY id ASC')
  return rows.map(rowToPromptTemplate)
}

export function getPromptTemplateById(db: Database, id: number): PromptTemplate | null {
  const row = selectRow(db, PromptTemplateRowSchema, 'SELECT * FROM prompt_templates WHERE id = ?', id)
  return row ? rowToPromptTemplate(row) : null
}

export function createPromptTemplate(db: Database, data: CreatePromptTemplateRequest): PromptTemplate {
  const now = Date.now()
  const result = db.prepare(`
    INSERT INTO prompt_templates (title, category, cadence_hint, suggested_name, suggested_description, description, prompt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.title, data.category, data.cadenceHint, data.suggestedName, data.suggestedDescription, data.description, data.prompt, now, now)
  return getPromptTemplateById(db, Number(result.lastInsertRowid))!
}

export function updatePromptTemplate(db: Database, id: number, data: UpdatePromptTemplateRequest): PromptTemplate | null {
  const existing = getPromptTemplateById(db, id)
  if (!existing) return null
  const now = Date.now()
  db.prepare(`
    UPDATE prompt_templates SET
      title = ?, category = ?, cadence_hint = ?, suggested_name = ?,
      suggested_description = ?, description = ?, prompt = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.title ?? existing.title,
    data.category ?? existing.category,
    data.cadenceHint ?? existing.cadenceHint,
    data.suggestedName ?? existing.suggestedName,
    data.suggestedDescription ?? existing.suggestedDescription,
    data.description ?? existing.description,
    data.prompt ?? existing.prompt,
    now,
    id,
  )
  return getPromptTemplateById(db, id)
}

export function deletePromptTemplate(db: Database, id: number): boolean {
  const result = db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id)
  return result.changes > 0
}
