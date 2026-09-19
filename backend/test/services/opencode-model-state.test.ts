import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const paths = vi.hoisted(() => ({ modelState: '' }))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getOpenCodeModelStatePath: () => paths.modelState,
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import {
  MAX_RECENT_MODELS,
  addRecentModel,
  readOpenCodeModelState,
  removeRecentModel,
  toggleFavoriteModel,
  updateOpenCodeModelState,
  type OpenCodeModelStateRecord,
} from '../../src/services/opencode-model-state'
import { logger } from '../../src/utils/logger'

const emptyState = (): OpenCodeModelStateRecord => ({ recent: [], favorite: [], variant: {} })

describe('opencode-model-state', () => {
  let workDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    workDir = await mkdtemp(path.join(tmpdir(), 'opencode-model-state-'))
    paths.modelState = path.join(workDir, 'model.json')
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  describe('addRecentModel', () => {
    it('adds a new model to the front', () => {
      const state = addRecentModel(emptyState(), { providerID: 'anthropic', modelID: 'claude' })
      expect(state.recent).toEqual([{ providerID: 'anthropic', modelID: 'claude' }])
    })

    it('deduplicates and moves a re-selected model to the front', () => {
      const model = { providerID: 'openai', modelID: 'gpt-4o' }
      const first = addRecentModel(emptyState(), model)
      const second = addRecentModel(first, { providerID: 'anthropic', modelID: 'claude' })
      const third = addRecentModel(second, model)

      expect(third.recent).toEqual([
        model,
        { providerID: 'anthropic', modelID: 'claude' },
      ])
    })

    it('caps recent at MAX_RECENT_MODELS', () => {
      let state = emptyState()
      for (let i = 0; i < MAX_RECENT_MODELS + 2; i += 1) {
        state = addRecentModel(state, { providerID: `provider-${i}`, modelID: `model-${i}` })
      }

      expect(state.recent).toHaveLength(MAX_RECENT_MODELS)
      expect(state.recent[0]).toEqual({ providerID: 'provider-11', modelID: 'model-11' })
    })
  })

  describe('removeRecentModel', () => {
    it('removes the matching model and keeps the rest', () => {
      const state = {
        recent: [
          { providerID: 'anthropic', modelID: 'claude' },
          { providerID: 'openai', modelID: 'gpt-4o' },
        ],
        favorite: [],
        variant: {},
      }

      expect(removeRecentModel(state, { providerID: 'anthropic', modelID: 'claude' }).recent).toEqual([
        { providerID: 'openai', modelID: 'gpt-4o' },
      ])
    })
  })

  describe('toggleFavoriteModel', () => {
    it('adds when missing', () => {
      const state = toggleFavoriteModel(emptyState(), { providerID: 'anthropic', modelID: 'claude' })
      expect(state.favorite).toEqual([{ providerID: 'anthropic', modelID: 'claude' }])
    })

    it('removes when present', () => {
      const model = { providerID: 'openai', modelID: 'gpt-4' }
      const added = toggleFavoriteModel(emptyState(), model)
      expect(toggleFavoriteModel(added, model).favorite).toEqual([])
    })
  })

  describe('readOpenCodeModelState', () => {
    it('returns empty defaults when the file is missing', async () => {
      await expect(readOpenCodeModelState()).resolves.toEqual(emptyState())
    })

    it('returns the parsed state when the file is valid', async () => {
      const state = {
        recent: [{ providerID: 'anthropic', modelID: 'claude' }],
        favorite: [{ providerID: 'openai', modelID: 'gpt-4' }],
        variant: { anthropic: 'thinking' },
      }
      await writeFile(paths.modelState, JSON.stringify(state), 'utf8')

      await expect(readOpenCodeModelState()).resolves.toEqual(state)
    })

    it('warns and returns empty defaults when the file has invalid structure', async () => {
      await writeFile(paths.modelState, JSON.stringify({ recent: 'not-an-array' }), 'utf8')

      await expect(readOpenCodeModelState()).resolves.toEqual(emptyState())
      expect(logger.warn).toHaveBeenCalled()
    })
  })

  describe('updateOpenCodeModelState', () => {
    it('writes the mutated state and preserves unknown top-level keys', async () => {
      await writeFile(
        paths.modelState,
        JSON.stringify({ session: { current: 'abc' }, recent: [{ providerID: 'anthropic', modelID: 'claude' }] }),
        'utf8',
      )

      const next = await updateOpenCodeModelState(state =>
        addRecentModel(state, { providerID: 'openai', modelID: 'gpt-4o' }),
      )

      expect(next.recent[0]).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })

      const file = JSON.parse(await readFile(paths.modelState, 'utf8')) as {
        session: unknown
        recent: unknown[]
        favorite: unknown[]
        variant: Record<string, unknown>
      }
      expect(file.session).toEqual({ current: 'abc' })
      expect(file.recent[0]).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      expect(file.favorite).toEqual([])
      expect(file.variant).toEqual({})
    })

    it('recovers from corrupt JSON and writes valid state', async () => {
      await writeFile(paths.modelState, '{ invalid json content }', 'utf8')

      const next = await updateOpenCodeModelState(state =>
        addRecentModel(state, { providerID: 'test', modelID: 'test' }),
      )

      expect(next.recent).toHaveLength(1)
      const file = JSON.parse(await readFile(paths.modelState, 'utf8')) as { recent: unknown[] }
      expect(file.recent).toHaveLength(1)
    })

    it('serializes concurrent updates without losing entries or exceeding the cap', async () => {
      const numOps = 20

      const operations = Array.from({ length: numOps }, (_, i) =>
        updateOpenCodeModelState(state => addRecentModel(state, { providerID: `provider-${i}`, modelID: `model-${i}` })),
      )

      await Promise.all(operations)

      const finalState = await readOpenCodeModelState()
      expect(finalState.recent.length).toBeLessThanOrEqual(MAX_RECENT_MODELS)
      expect(finalState.recent.length).toBeGreaterThan(0)

      const uniqueKeys = new Set(finalState.recent.map((m) => `${m.providerID}/${m.modelID}`))
      expect(uniqueKeys.size).toBe(finalState.recent.length)
    })
  })
})
