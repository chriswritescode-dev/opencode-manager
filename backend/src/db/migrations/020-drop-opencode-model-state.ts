import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getOpenCodeModelStatePath } from '@opencode-manager/shared/config/env'
import type { Migration } from '../migration-runner'
import { logger } from '../../utils/logger'

interface ModelStateRow {
  recent: string
  favorite: string
  variant: string
  updated_at: number
}

function readDefaultRow(db: Parameters<Migration['up']>[0]): ModelStateRow | undefined {
  try {
    return db.prepare("SELECT recent, favorite, variant, updated_at FROM opencode_model_state WHERE user_id = 'default'").get() as ModelStateRow | undefined
  } catch {
    return undefined
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
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
    ? parseJson<Record<string, unknown>>(readFileSync(filePath, 'utf8'), {})
    : {}

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify({
    ...existing,
    recent: parseJson<unknown[]>(row.recent, []),
    favorite: parseJson<unknown[]>(row.favorite, []),
    variant: parseJson<Record<string, unknown>>(row.variant, {}),
  }, null, 2))
}

const migration: Migration = {
  version: 20,
  name: 'drop-opencode-model-state',

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
