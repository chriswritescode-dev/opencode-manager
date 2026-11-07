import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { WALKTHROUGH_OUTPUT_DEFINITION, type OutputState } from '@opencode-manager/shared/schemas'
import { createOutputRoutes } from '../../src/routes/outputs'
import { OutputError } from '../../src/services/outputs/output-error'
import type { OutputService } from '../../src/services/outputs/output-service'

const SESSION_ID = 'ses_output'
const STAGED_PARAMS = { source: { kind: 'staged' } }
const ENCODED_PARAMS = encodeURIComponent(JSON.stringify(STAGED_PARAMS))

function state(overrides: Partial<OutputState> = {}): OutputState {
  return {
    definition: WALKTHROUGH_OUTPUT_DEFINITION,
    output: null,
    currentInputHash: 'hash',
    hasInput: true,
    stale: false,
    generating: false,
    running: false,
    error: null,
    ...overrides,
  }
}

describe('output routes', () => {
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
      '/outputs',
      createOutputRoutes({ getState, startGeneration, cancelGeneration, refine, listHelperSessionIds } as unknown as OutputService),
    )
  })

  it('GET helper-sessions lists helper sessions without reading state', async () => {
    const res = await app.request('/outputs/helper-sessions')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sessionIds: ['ses_helper'] })
    expect(getState).not.toHaveBeenCalled()
  })

  it('GET returns the state for a definition', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}?definitionId=walkthrough`)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(state())
    expect(getState).toHaveBeenCalledWith(SESSION_ID, 'walkthrough', undefined)
  })

  it('GET forwards parsed params', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}?definitionId=walkthrough&params=${ENCODED_PARAMS}`)

    expect(res.status).toBe(200)
    expect(getState).toHaveBeenCalledWith(SESSION_ID, 'walkthrough', STAGED_PARAMS)
  })

  it('GET without definitionId returns 400 and does not call the service', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}`)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'definitionId is required' })
    expect(getState).not.toHaveBeenCalled()
  })

  it('GET rejects malformed params JSON with 400', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}?definitionId=walkthrough&params=%7Bnot-json`)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid params JSON' })
    expect(getState).not.toHaveBeenCalled()
  })

  it('GET rejects a non-object params value with 400', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}?definitionId=walkthrough&params=${encodeURIComponent('[]')}`)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid params JSON' })
    expect(getState).not.toHaveBeenCalled()
  })

  it('GET maps a service error', async () => {
    getState.mockRejectedValueOnce(new OutputError('Session not found', 404))

    const res = await app.request('/outputs/ses_missing?definitionId=walkthrough')

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'Session not found' })
  })

  it('POST returns 202 while generating and forwards the request', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitionId: 'walkthrough', params: STAGED_PARAMS }),
    })

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toMatchObject({ generating: true })
    expect(startGeneration).toHaveBeenCalledWith(SESSION_ID, {
      definitionId: 'walkthrough',
      params: STAGED_PARAMS,
    })
  })

  it('POST returns 200 when the output is not generating', async () => {
    startGeneration.mockResolvedValueOnce(state({ generating: false }))

    const res = await app.request(`/outputs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitionId: 'walkthrough' }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ generating: false })
  })

  it('POST with an empty body returns 400 and does not call the service', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}`, { method: 'POST' })

    expect(res.status).toBe(400)
    expect(startGeneration).not.toHaveBeenCalled()
  })

  it('POST without definitionId returns 400 and does not call the service', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
    expect(startGeneration).not.toHaveBeenCalled()
  })

  it('POST rejects malformed JSON with 400', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })

    expect(res.status).toBe(400)
    expect(startGeneration).not.toHaveBeenCalled()
  })

  it('POST rejects an invalid body with 400', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitionId: 'walkthrough', regenerate: 'yes' }),
    })

    expect(res.status).toBe(400)
    expect(startGeneration).not.toHaveBeenCalled()
  })

  it('POST maps 409 with the service code', async () => {
    startGeneration.mockRejectedValueOnce(
      new OutputError('No changes', 409, { code: 'OUTPUT_NO_TEXT_CHANGES' }),
    )

    const res = await app.request(`/outputs/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitionId: 'walkthrough' }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'OUTPUT_NO_TEXT_CHANGES' })
  })

  it('POST returns 404 for a missing session', async () => {
    startGeneration.mockRejectedValueOnce(new OutputError('Session not found', 404))

    const res = await app.request('/outputs/ses_missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitionId: 'walkthrough' }),
    })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'Session not found' })
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
    const pending = Promise.resolve(
      app.request(`/outputs/${SESSION_ID}?definitionId=walkthrough`, { method: 'DELETE' }),
    ).then((res) => {
      settled = true
      return res
    })

    await vi.waitFor(() =>
      expect(cancelGeneration).toHaveBeenCalledWith(SESSION_ID, 'walkthrough', undefined),
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveCancel(true)
    const res = await pending
    expect(res.status).toBe(204)
  })

  it('DELETE forwards parsed params', async () => {
    const res = await app.request(
      `/outputs/${SESSION_ID}?definitionId=walkthrough&params=${ENCODED_PARAMS}`,
      { method: 'DELETE' },
    )

    expect(res.status).toBe(204)
    expect(cancelGeneration).toHaveBeenCalledWith(SESSION_ID, 'walkthrough', STAGED_PARAMS)
  })

  it('DELETE without definitionId returns 400 and does not cancel', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}`, { method: 'DELETE' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'definitionId is required' })
    expect(cancelGeneration).not.toHaveBeenCalled()
  })

  it('DELETE maps an unknown definition to 404 with the service code', async () => {
    cancelGeneration.mockRejectedValueOnce(
      new OutputError('Output definition "deleted-global" not found', 404, {
        code: 'OUTPUT_DEFINITION_NOT_FOUND',
      }),
    )

    const res = await app.request(
      `/outputs/${SESSION_ID}?definitionId=deleted-global`,
      { method: 'DELETE' },
    )

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Output definition "deleted-global" not found',
      code: 'OUTPUT_DEFINITION_NOT_FOUND',
    })
  })

  it('DELETE maps invalid params to 400 with the service code', async () => {
    cancelGeneration.mockRejectedValueOnce(
      new OutputError('Changes is not a valid change source', 400, { code: 'OUTPUT_PARAMS_INVALID' }),
    )

    const res = await app.request(
      `/outputs/${SESSION_ID}?definitionId=walkthrough&params=${ENCODED_PARAMS}`,
      { method: 'DELETE' },
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Changes is not a valid change source',
      code: 'OUTPUT_PARAMS_INVALID',
    })
  })

  it('DELETE rejects malformed params with 400', async () => {
    const res = await app.request(
      `/outputs/${SESSION_ID}?definitionId=walkthrough&params=%7Bnot-json`,
      { method: 'DELETE' },
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid params JSON' })
    expect(cancelGeneration).not.toHaveBeenCalled()
  })

  it('POST refine returns 202 and forwards the body', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitionId: 'walkthrough', text: 'Explain the risk section' }),
    })

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toMatchObject({ generating: true })
    expect(refine).toHaveBeenCalledWith(SESSION_ID, {
      definitionId: 'walkthrough',
      text: 'Explain the risk section',
    })
  })

  it('POST refine forwards params too', async () => {
    await app.request(`/outputs/${SESSION_ID}/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitionId: 'walkthrough', params: STAGED_PARAMS, text: 'more' }),
    })

    expect(refine).toHaveBeenCalledWith(SESSION_ID, {
      definitionId: 'walkthrough',
      params: STAGED_PARAMS,
      text: 'more',
    })
  })

  it('POST refine rejects whitespace text with 400 and does not call the service', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitionId: 'walkthrough', text: '   ' }),
    })

    expect(res.status).toBe(400)
    expect(refine).not.toHaveBeenCalled()
  })

  it('POST refine rejects an empty body with 400', async () => {
    const res = await app.request(`/outputs/${SESSION_ID}/refine`, { method: 'POST' })

    expect(res.status).toBe(400)
    expect(refine).not.toHaveBeenCalled()
  })

  it('POST refine maps a busy service error', async () => {
    refine.mockRejectedValueOnce(
      new OutputError('The output is still being built', 409, { code: 'OUTPUT_BUSY' }),
    )

    const res = await app.request(`/outputs/${SESSION_ID}/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitionId: 'walkthrough', text: 'more' }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'OUTPUT_BUSY' })
  })
})
