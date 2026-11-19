import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { getOpenCodeModelStatePath } from '@opencode-manager/shared/config/env'
import {
  addRecentModel,
  toggleFavoriteModel,
  type ModelPreference,
} from '@opencode-manager/shared/opencode'
import {
  readOpenCodeModelState,
  updateOpenCodeModelState,
} from '../../src/services/opencode-model-state'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

const StoredModelStateSchema = z.object({
  session: z.object({ current: z.string() }).optional(),
  extra: z.number().optional(),
  recent: z.array(z.object({ providerID: z.string(), modelID: z.string() })),
  favorite: z.array(z.object({ providerID: z.string(), modelID: z.string() })),
  variant: z.record(z.string(), z.string()),
})

const emptyState = (): ModelPreference => ({ recent: [], favorite: [], variant: {} })

describe('opencode-model-state', () => {
  let workspace: TempWorkspace
  let modelStatePath: string

  async function readStoredState() {
    return StoredModelStateSchema.parse(JSON.parse(await readFile(modelStatePath, 'utf8')))
  }

  beforeEach(async () => {
    workspace = createTempWorkspace('opencode-model-state-')
    modelStatePath = getOpenCodeModelStatePath()
    await mkdir(path.dirname(modelStatePath), { recursive: true })
  })

  afterEach(() => {
    workspace.restore()
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
      await writeFile(modelStatePath, JSON.stringify(state), 'utf8')

      await expect(readOpenCodeModelState()).resolves.toEqual(state)
    })

    it('drops malformed entries without resetting the whole file', async () => {
      await writeFile(
        modelStatePath,
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
      await writeFile(modelStatePath, JSON.stringify({ recent: 'not-an-array' }), 'utf8')

      await expect(readOpenCodeModelState()).resolves.toEqual(emptyState())
    })
  })

  describe('updateOpenCodeModelState', () => {
    it('writes the mutated state and preserves unknown top-level keys', async () => {
      await writeFile(
        modelStatePath,
        JSON.stringify({ session: { current: 'abc' }, recent: [{ providerID: 'anthropic', modelID: 'claude' }] }),
        'utf8',
      )

      const next = await updateOpenCodeModelState(state =>
        addRecentModel(state, { providerID: 'openai', modelID: 'gpt-4o' }),
      )

      expect(next.recent[0]).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })

      const file = await readStoredState()
      expect(file.session).toEqual({ current: 'abc' })
      expect(file.recent[0]).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      expect(file.favorite).toEqual([])
      expect(file.variant).toEqual({})
    })

    it('preserves unknown top-level keys when toggling a favorite', async () => {
      await writeFile(modelStatePath, JSON.stringify({ extra: 1, recent: [] }), 'utf8')

      await updateOpenCodeModelState(state =>
        toggleFavoriteModel(state, { providerID: 'anthropic', modelID: 'claude' }),
      )

      const file = await readStoredState()
      expect(file.extra).toBe(1)
      expect(file.favorite).toEqual([{ providerID: 'anthropic', modelID: 'claude' }])
    })

    it('recovers from corrupt JSON and writes valid state', async () => {
      await writeFile(modelStatePath, '{ invalid json content }', 'utf8')

      const next = await updateOpenCodeModelState(state =>
        addRecentModel(state, { providerID: 'test', modelID: 'test' }),
      )

      expect(next.recent).toHaveLength(1)
      const file = await readStoredState()
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
