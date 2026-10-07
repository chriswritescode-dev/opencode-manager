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
  addRecentModel,
  toggleFavoriteModel,
  type ModelPreference,
} from '@opencode-manager/shared/opencode'
import {
  readOpenCodeModelState,
  updateOpenCodeModelState,
} from '../../src/services/opencode-model-state'

const emptyState = (): ModelPreference => ({ recent: [], favorite: [], variant: {} })

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

    it('drops malformed entries without resetting the whole file', async () => {
      await writeFile(
        paths.modelState,
        JSON.stringify({
          recent: [{ providerID: 'a', modelID: 'b' }, { providerID: '' }],
          variant: { 'a/b': 'default', x: '' },
          extra: 1,
        }),
        'utf8',
      )

      const state = await readOpenCodeModelState()
      expect(state.recent).toEqual([{ providerID: 'a', modelID: 'b' }])
      expect(state.variant).toEqual({ 'a/b': 'default' })
      expect(state).not.toHaveProperty('extra')
    })

    it('returns empty defaults when the file has an unexpected shape', async () => {
      await writeFile(paths.modelState, JSON.stringify({ recent: 'not-an-array' }), 'utf8')

      await expect(readOpenCodeModelState()).resolves.toEqual(emptyState())
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

    it('preserves unknown top-level keys when toggling a favorite', async () => {
      await writeFile(paths.modelState, JSON.stringify({ extra: 1, recent: [] }), 'utf8')

      await updateOpenCodeModelState(state =>
        toggleFavoriteModel(state, { providerID: 'anthropic', modelID: 'claude' }),
      )

      const file = JSON.parse(await readFile(paths.modelState, 'utf8')) as {
        extra: unknown
        favorite: unknown[]
      }
      expect(file.extra).toBe(1)
      expect(file.favorite).toEqual([{ providerID: 'anthropic', modelID: 'claude' }])
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
      expect(finalState.recent.length).toBeLessThanOrEqual(10)
      expect(finalState.recent.length).toBeGreaterThan(0)

      const uniqueKeys = new Set(finalState.recent.map((m) => `${m.providerID}/${m.modelID}`))
      expect(uniqueKeys.size).toBe(finalState.recent.length)
    })
  })
})
