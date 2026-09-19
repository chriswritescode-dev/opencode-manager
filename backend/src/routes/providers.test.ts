import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createProvidersRoutes } from './providers'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import type { OpenCodeModelStateRecord } from '../services/opencode-model-state'

const modelStateMock = vi.hoisted(() => ({
  readOpenCodeModelState: vi.fn(),
  updateOpenCodeModelState: vi.fn(),
}))

vi.mock('../services/opencode-model-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/opencode-model-state')>()
  return {
    ...actual,
    readOpenCodeModelState: modelStateMock.readOpenCodeModelState,
    updateOpenCodeModelState: modelStateMock.updateOpenCodeModelState,
  }
})

function createTestApp(): Hono {
  const app = new Hono()
  app.route('/providers', createProvidersRoutes(createStubOpenCodeClient()))
  return app
}

describe('providers routes', () => {
  let app: Hono
  let storedState: OpenCodeModelStateRecord

  beforeEach(() => {
    vi.clearAllMocks()
    storedState = { recent: [], favorite: [], variant: {} }
    modelStateMock.readOpenCodeModelState.mockImplementation(async () => storedState)
    modelStateMock.updateOpenCodeModelState.mockImplementation(
      async (mutate: (state: OpenCodeModelStateRecord) => OpenCodeModelStateRecord) => {
        storedState = mutate(storedState)
        return storedState
      },
    )
    app = createTestApp()
  })

  describe('GET /model-state', () => {
    it('returns the state owned by the service', async () => {
      const res = await app.request('/providers/model-state')
      expect(res.status).toBe(200)
      const data = (await res.json()) as { recent: unknown[]; favorite: unknown[]; variant: Record<string, unknown> }
      expect(data).toEqual({ recent: [], favorite: [], variant: {} })
      expect(modelStateMock.readOpenCodeModelState).toHaveBeenCalledTimes(1)
    })
  })

  describe('POST /model-state', () => {
    it('with recent returns 200 with recent[0] set', async () => {
      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recent: { providerID: 'anthropic', modelID: 'claude' } }),
      })
      expect(res.status).toBe(200)
      const data = (await res.json()) as { recent: Array<{ providerID: string; modelID: string }> }
      expect(data.recent).toHaveLength(1)
      expect(data.recent[0]).toEqual({ providerID: 'anthropic', modelID: 'claude' })
    })

    it('with removeRecent removes the model', async () => {
      storedState = {
        recent: [{ providerID: 'openai', modelID: 'gpt-4' }],
        favorite: [],
        variant: {},
      }

      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeRecent: { providerID: 'openai', modelID: 'gpt-4' } }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { recent: Array<{ providerID: string; modelID: string }> }
      expect(data.recent).toHaveLength(0)
    })

    it('with favorite toggles favorite (add then remove)', async () => {
      const body = { favorite: { providerID: 'openai', modelID: 'gpt-4' } }

      const res1 = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res1.status).toBe(200)
      const data1 = (await res1.json()) as { favorite: Array<{ providerID: string; modelID: string }> }
      expect(data1.favorite).toHaveLength(1)

      const res2 = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res2.status).toBe(200)
      const data2 = (await res2.json()) as { favorite: Array<{ providerID: string; modelID: string }> }
      expect(data2.favorite).toHaveLength(0)
    })

    it('with invalid body returns 400', async () => {
      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'data' }),
      })
      expect(res.status).toBe(400)
      const data = (await res.json()) as { error: string }
      expect(data.error).toBe('Invalid request data')
      expect(modelStateMock.updateOpenCodeModelState).not.toHaveBeenCalled()
    })

    it('returns 500 when the service rejects', async () => {
      modelStateMock.updateOpenCodeModelState.mockRejectedValueOnce(new Error('disk full'))

      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recent: { providerID: 'test', modelID: 'test' } }),
      })

      expect(res.status).toBe(500)
      const data = (await res.json()) as { error: string }
      expect(data.error).toBe('Failed to update OpenCode model state')
    })
  })
})
