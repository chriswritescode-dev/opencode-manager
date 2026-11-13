import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getOpenCodeModelStatePath } from '@opencode-manager/shared/config/env'
import type { Migration } from '../migration-runner'
import { logger } from '../../utils/logger'
import { JsonObjectSchema, JsonValueSchema } from '@opencode-manager/shared/utils'
import { z } from 'zod'
import { selectRow } from '../rows'

const ModelStateRowSchema = z.object({
  recent: z.string(),
  favorite: z.string(),
  variant: z.string(),
  updated_at: z.number(),
})

type ModelStateRow = z.infer<typeof ModelStateRowSchema>

function readDefaultRow(db: Parameters<Migration['up']>[0]): ModelStateRow | null {
  try {
    return selectRow(
      db,
      ModelStateRowSchema,
      "SELECT recent, favorite, variant, updated_at FROM opencode_model_state WHERE user_id = 'default'",
    )
  } catch {
    return null
  }
}

function parseJsonText<Schema extends z.ZodType>(value: string, schema: Schema, fallback: z.infer<Schema>): z.infer<Schema> {
  try {
    const parsed = schema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : fallback
  } catch {
    return fallback
  }
}

function restoreModelStateFile(row: ModelStateRow): void {
  const filePath = getOpenCodeModelStatePath()
  const fileExists = existsSync(filePath)

  if (fileExists && statSync(filePath).mtimeMs >= row.updated_at) {
    return
  }

  const existing = fileExists
    ? parseJsonText(readFileSync(filePath, 'utf8'), JsonObjectSchema, {})
    : {}

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify({
    ...existing,
    recent: parseJsonText(row.recent, z.array(JsonValueSchema), []),
    favorite: parseJsonText(row.favorite, z.array(JsonValueSchema), []),
    variant: parseJsonText(row.variant, JsonObjectSchema, {}),
  }, null, 2))
}

const migration: Migration = {
  id: '020-drop-opencode-model-state',
  legacy: { version: 20, name: 'drop-opencode-model-state' },

  up(db) {
    const row = readDefaultRow(db)
    if (row) {
      try {
        restoreModelStateFile(row)
      } catch (error) {
        logger.warn('Failed to restore the OpenCode model state file', error)
      }
    }

    db.run('DROP INDEX IF EXISTS idx_opencode_model_state_user')
    db.run('DROP TABLE IF EXISTS opencode_model_state')
  },

  down(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS opencode_model_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT 'default',
        recent TEXT NOT NULL DEFAULT '[]',
        favorite TEXT NOT NULL DEFAULT '[]',
        variant TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id)
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_opencode_model_state_user ON opencode_model_state(user_id)')
  },
}

export default migration
