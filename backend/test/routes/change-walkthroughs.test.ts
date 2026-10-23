import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { ChangeWalkthroughState } from '@opencode-manager/shared/schemas'
import { createChangeWalkthroughRoutes } from '../../src/routes/change-walkthroughs'
import { ChangeWalkthroughError } from '../../src/services/change-walkthrough-error'
import type { ChangeWalkthroughService } from '../../src/services/change-walkthroughs'

const SESSION_ID = 'ses_walkthrough'

function state(overrides: Partial<ChangeWalkthroughState> = {}): ChangeWalkthroughState {
  return {
    walkthrough: null,
    currentDiffHash: 'hash',
    hasChanges: true,
    stale: false,
    generating: false,
    running: false,
    error: null,
    ...overrides,
  }
}

describe('change walkthrough routes', () => {
  let getState: ReturnType<typeof vi.fn>
  let startGeneration: ReturnType<typeof vi.fn>
  let cancelGeneration: ReturnType<typeof vi.fn>
  let refine: ReturnType<typeof vi.fn>
  let listHelperSessionIds: ReturnType<typeof vi.fn>
  let app: Hono

  beforeEach(() => {
    getState = vi.fn(async () => state())
    startGeneration = vi.fn(async () => state({ generating: true }))
    cancelGeneration = vi.fn(async () => true)
    refine = vi.fn(async () => state({ generating: true }))
    listHelperSessionIds = vi.fn(() => ['ses_helper'])
    app = new Hono()
    app.route(
      '/change-walkthroughs',
      createChangeWalkthroughRoutes({ getState, startGeneration, cancelGeneration, refine, listHelperSessionIds } as unknown as ChangeWalkthroughService),
    )
  })

  it('GET helper-sessions lists walkthrough helper sessions', async () => {
    const res = await app.request('/change-walkthroughs/helper-sessions')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sessionIds: ['ses_helper'] })
    expect(getState).not.toHaveBeenCalled()
  })

  it('GET returns the state for the default source', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(state())
    expect(getState).toHaveBeenCalledWith(SESSION_ID, { kind: 'session' })
  })

  it('GET reads the requested source', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}?source=staged`)

    expect(res.status).toBe(200)
    expect(getState).toHaveBeenCalledWith(SESSION_ID, { kind: 'staged' })
  })

  it('GET rejects an invalid source with 400', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}?source=branch:-x`)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid walkthrough source' })
    expect(getState).not.toHaveBeenCalled()
  })

  it('GET maps a service error', async () => {
    getState.mockRejectedValueOnce(new ChangeWalkthroughError('Session not found', 404))

    const res = await app.request('/change-walkthroughs/ses_missing')

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'Session not found' })
  })

  it('POST returns 202 while generating and forwards the body', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { kind: 'staged' } }),
    })

    expect(res.status).toBe(202)
    expect(startGeneration).toHaveBeenCalledWith(SESSION_ID, { source: { kind: 'staged' } })
  })

  it('POST accepts an empty body', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'POST' })

    expect(res.status).toBe(202)
    expect(startGeneration).toHaveBeenCalledWith(SESSION_ID, {})
  })

  it('POST returns 200 when the walkthrough is ready', async () => {
    startGeneration.mockResolvedValueOnce(state({ generating: false }))

    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'POST' })

    expect(res.status).toBe(200)
  })

  it('POST returns 409 with the service code', async () => {
    startGeneration.mockRejectedValueOnce(
      new ChangeWalkthroughError('No changes', 409, { code: 'WALKTHROUGH_NO_TEXT_CHANGES' }),
    )

    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'POST' })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'WALKTHROUGH_NO_TEXT_CHANGES' })
  })

  it('POST rejects malformed JSON with 400', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })

    expect(res.status).toBe(400)
    expect(startGeneration).not.toHaveBeenCalled()
  })

  it('POST rejects an invalid body with 400', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerate: 'yes' }),
    })

    expect(res.status).toBe(400)
    expect(startGeneration).not.toHaveBeenCalled()
  })

  it('POST returns 404 for a missing session', async () => {
    startGeneration.mockRejectedValueOnce(new ChangeWalkthroughError('Session not found', 404))

    const res = await app.request('/change-walkthroughs/ses_missing', { method: 'POST' })

    expect(res.status).toBe(404)
  })

  it('DELETE awaits the cancel and returns 204', async () => {
    let resolveCancel: (value: boolean) => void = () => {}
    cancelGeneration.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCancel = resolve
        }),
    )

    let settled = false
    const pending = Promise.resolve(app.request(`/change-walkthroughs/${SESSION_ID}`, { method: 'DELETE' })).then((res) => {
      settled = true
      return res
    })

    await vi.waitFor(() => expect(cancelGeneration).toHaveBeenCalledWith(SESSION_ID, { kind: 'session' }))
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveCancel(true)
    const res = await pending
    expect(res.status).toBe(204)
  })

  it('DELETE rejects an invalid source with 400', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}?source=branch:-x`, { method: 'DELETE' })

    expect(res.status).toBe(400)
    expect(cancelGeneration).not.toHaveBeenCalled()
  })

  it('POST refine returns 202 and forwards the text', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Explain the risk section' }),
    })

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toMatchObject({ generating: true })
    expect(refine).toHaveBeenCalledWith(SESSION_ID, { text: 'Explain the risk section' })
  })

  it('POST refine forwards the requested source', async () => {
    await app.request(`/change-walkthroughs/${SESSION_ID}/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { kind: 'staged' }, text: 'more' }),
    })

    expect(refine).toHaveBeenCalledWith(SESSION_ID, { source: { kind: 'staged' }, text: 'more' })
  })

  it('POST refine rejects empty text with 400', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    })

    expect(res.status).toBe(400)
    expect(refine).not.toHaveBeenCalled()
  })

  it('POST refine rejects an empty body with 400', async () => {
    const res = await app.request(`/change-walkthroughs/${SESSION_ID}/refine`, { method: 'POST' })

    expect(res.status).toBe(400)
    expect(refine).not.toHaveBeenCalled()
  })

  it('POST refine maps a service error', async () => {
    refine.mockRejectedValueOnce(
      new ChangeWalkthroughError('The walkthrough is still being built', 409, { code: 'WALKTHROUGH_BUSY' }),
    )

    const res = await app.request(`/change-walkthroughs/${SESSION_ID}/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'more' }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'WALKTHROUGH_BUSY' })
  })
})
