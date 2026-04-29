import { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'

export interface ModelSelectionRecord {
  providerID: string
  modelID: string
}

export interface OpenCodeModelStateRecord {
  recent: ModelSelectionRecord[]
  favorite: ModelSelectionRecord[]
  variant: Record<string, string | undefined>
}

export const MAX_RECENT_MODELS = 10

const EMPTY_STATE: OpenCodeModelStateRecord = { recent: [], favorite: [], variant: {} }

export function ensureOpenCodeModelStateTable(db: Database): void {
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
}

function parseJsonSafe<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch (error) {
    logger.warn(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`)
    return fallback
  }
}

export function getOpenCodeModelState(db: Database, userId = 'default'): OpenCodeModelStateRecord {
  ensureOpenCodeModelStateTable(db)

  const row = db.prepare('SELECT recent, favorite, variant FROM opencode_model_state WHERE user_id = ?').get(userId) as
    | { recent: string; favorite: string; variant: string }
    | undefined

  if (!row) {
    return EMPTY_STATE
  }

  const recent = parseJsonSafe<ModelSelectionRecord[]>(row.recent, [])
  const favorite = parseJsonSafe<ModelSelectionRecord[]>(row.favorite, [])
  const variant = parseJsonSafe<Record<string, string | undefined>>(row.variant, {})

  return { recent, favorite, variant }
}

export function addRecentOpenCodeModel(
  db: Database,
  model: ModelSelectionRecord,
  userId = 'default',
): OpenCodeModelStateRecord {
  const insertMany = db.transaction(() => {
    const current = getOpenCodeModelState(db, userId)
    const deduped = [model, ...current.recent.filter(m => m.providerID !== model.providerID || m.modelID !== model.modelID)]
    const sliced = deduped.slice(0, MAX_RECENT_MODELS)
    const now = Date.now()

    db.prepare(`
      INSERT INTO opencode_model_state(user_id, recent, favorite, variant, updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET recent=excluded.recent, updated_at=excluded.updated_at
    `).run(userId, JSON.stringify(sliced), JSON.stringify(current.favorite), JSON.stringify(current.variant), now)

    return { recent: sliced, favorite: current.favorite, variant: current.variant }
  })

  return insertMany()
}

export function toggleFavoriteOpenCodeModel(
  db: Database,
  model: ModelSelectionRecord,
  userId = 'default',
): OpenCodeModelStateRecord {
  const toggle = db.transaction(() => {
    const current = getOpenCodeModelState(db, userId)
    const exists = current.favorite.some(
      m => m.providerID === model.providerID && m.modelID === model.modelID,
    )

    const updated = exists
      ? current.favorite.filter(m => m.providerID !== model.providerID || m.modelID !== model.modelID)
      : [...current.favorite, model]

    const now = Date.now()

    db.prepare(`
      INSERT INTO opencode_model_state(user_id, recent, favorite, variant, updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET favorite=excluded.favorite, updated_at=excluded.updated_at
    `).run(userId, JSON.stringify(current.recent), JSON.stringify(updated), JSON.stringify(current.variant), now)

    return { recent: current.recent, favorite: updated, variant: current.variant }
  })

  return toggle()
}

export function setOpenCodeVariant(
  db: Database,
  key: string,
  variant: string | undefined,
  userId = 'default',
): OpenCodeModelStateRecord {
  const setVariant = db.transaction(() => {
    const current = getOpenCodeModelState(db, userId)
    const updated = { ...current.variant }

    if (variant === undefined) {
      delete updated[key]
    } else {
      updated[key] = variant
    }

    const now = Date.now()

    db.prepare(`
      INSERT INTO opencode_model_state(user_id, recent, favorite, variant, updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET variant=excluded.variant, updated_at=excluded.updated_at
    `).run(userId, JSON.stringify(current.recent), JSON.stringify(current.favorite), JSON.stringify(updated), now)

    return { recent: current.recent, favorite: current.favorite, variant: updated }
  })

  return setVariant()
}
