import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from './migration-runner'
import { allMigrations } from './migrations'
import {
  getOpenCodeModelState,
  addRecentOpenCodeModel,
  toggleFavoriteOpenCodeModel,
  setOpenCodeVariant,
  MAX_RECENT_MODELS,
} from './model-state'

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

describe('model-state', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  describe('getOpenCodeModelState', () => {
    it('returns empty defaults when no row exists', () => {
      const state = getOpenCodeModelState(db)
      expect(state).toEqual({ recent: [], favorite: [], variant: {} })
    })

    it('creates the model state table when an existing database is missing it', () => {
      db.run('DROP TABLE opencode_model_state')

      const state = getOpenCodeModelState(db)
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'opencode_model_state'").get()

      expect(state).toEqual({ recent: [], favorite: [], variant: {} })
      expect(table).toBeTruthy()
    })

    it('returns defaults with explicit userId when no row exists', () => {
      const state = getOpenCodeModelState(db, 'user123')
      expect(state).toEqual({ recent: [], favorite: [], variant: {} })
    })
  })

  describe('addRecentOpenCodeModel', () => {
    it('inserts new state and returns the model in recent[0]', () => {
      const model = { providerID: 'anthropic', modelID: 'claude-sonnet-4-20250514' }
      const state = addRecentOpenCodeModel(db, model)
      expect(state.recent).toHaveLength(1)
      expect(state.recent[0]).toEqual(model)
    })

    it('deduplicates re-selections (same model added twice → length 1, model at index 0)', () => {
      const model = { providerID: 'openai', modelID: 'gpt-4o' }
      addRecentOpenCodeModel(db, model)
      const state = addRecentOpenCodeModel(db, model)
      expect(state.recent).toHaveLength(1)
      expect(state.recent[0]).toEqual(model)
    })

    it('caps at MAX_RECENT_MODELS (insert 12 distinct, expect 10)', () => {
      for (let i = 0; i < 12; i++) {
        addRecentOpenCodeModel(db, { providerID: `provider-${i}`, modelID: `model-${i}` })
      }
      const state = getOpenCodeModelState(db)
      expect(state.recent).toHaveLength(MAX_RECENT_MODELS)
      expect(state.recent[0]).toEqual({ providerID: 'provider-11', modelID: 'model-11' })
    })
  })

  describe('toggleFavoriteOpenCodeModel', () => {
    it('adds when missing', () => {
      const model = { providerID: 'anthropic', modelID: 'claude' }
      const state = toggleFavoriteOpenCodeModel(db, model)
      expect(state.favorite).toHaveLength(1)
      expect(state.favorite[0]).toEqual(model)
    })

    it('removes when present', () => {
      const model = { providerID: 'openai', modelID: 'gpt-4' }
      toggleFavoriteOpenCodeModel(db, model)
      const state = toggleFavoriteOpenCodeModel(db, model)
      expect(state.favorite).toHaveLength(0)
    })
  })

  describe('setOpenCodeVariant', () => {
    it('adds variant entry', () => {
      const state = setOpenCodeVariant(db, 'key1', 'variant1')
      expect(state.variant.key1).toBe('variant1')
    })

    it('updates variant entry', () => {
      setOpenCodeVariant(db, 'key1', 'variant1')
      const state = setOpenCodeVariant(db, 'key1', 'variant2')
      expect(state.variant.key1).toBe('variant2')
    })

    it('deletes variant when undefined', () => {
      setOpenCodeVariant(db, 'key1', 'variant1')
      const state = setOpenCodeVariant(db, 'key1', undefined)
      expect(state.variant.key1).toBeUndefined()
    })
  })

  it('corrupt JSON in recent column → getOpenCodeModelState returns [] for recent, preserves valid favorite', () => {
    const now = Date.now()
    db.prepare(`
      INSERT INTO opencode_model_state(user_id, recent, favorite, variant, updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET recent=excluded.recent, favorite=excluded.favorite, variant=excluded.variant, updated_at=excluded.updated_at
    `).run('default', '{ invalid json }', JSON.stringify([{ providerID: 'test', modelID: 'test' }]), '{}', now)

    const state = getOpenCodeModelState(db)
    expect(state.recent).toEqual([])
    expect(state.favorite).toHaveLength(1)
    expect(state.favorite[0]).toEqual({ providerID: 'test', modelID: 'test' })
  })

  it('50 concurrent addRecentOpenCodeModel calls → final recent.length <= MAX_RECENT_MODELS, no exceptions, all entries unique', async () => {
    const db = createTestDb()
    const numOps = 50

    const operations = Array.from({ length: numOps }, (_, i) =>
      addRecentOpenCodeModel(db, { providerID: `provider-${i}`, modelID: `model-${i}` }),
    )

    await Promise.all(operations)
    const finalState = getOpenCodeModelState(db)

    expect(finalState.recent.length).toBeLessThanOrEqual(MAX_RECENT_MODELS)
    expect(finalState.recent.length).toBeGreaterThan(0)

    const uniqueKeys = new Set(finalState.recent.map((m) => `${m.providerID}/${m.modelID}`))
    expect(uniqueKeys.size).toBe(finalState.recent.length)
  })
})
