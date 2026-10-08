import { describe, it, expect, vi, afterEach } from 'vitest'
import { ManagerApi, ManagerApiError, isManagerRouteMissing, MANAGER_FEATURE_MISSING } from '../src/manager-api.js'
import type { MultiRun, SessionGoal } from '@opencode-manager/shared/schemas'

const BASE_URL = 'http://localhost:5003'

const goal: SessionGoal = {
  id: 7,
  sessionId: 'ses_1',
  directory: '/repo',
  objective: 'fix the flaky test',
  status: 'active',
  stopReason: null,
  turnState: 'waiting',
  continuationCount: 0,
  maxContinuations: 10,
  tokenBudget: null,
  tokensUsed: 0,
  consecutiveBlocked: 0,
  lastVerdict: null,
  lastReason: null,
  createdAt: 1,
  updatedAt: 2,
  finishedAt: null,
}

const run: MultiRun = {
  id: 3,
  repoId: 1,
  name: 'sweep',
  prompt: 'hello',
  isolated: true,
  baseRef: null,
  createdAt: 1,
  entries: [],
  fusions: [],
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve('') }
}

function errorResponse(status: number, text: string) {
  return { ok: false, status, json: () => Promise.reject(new Error('no json')), text: () => Promise.resolve(text) }
}

function stubFetch(response: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ManagerApi session goals', () => {
  const api = new ManagerApi(BASE_URL, 'tok')

  it('reads the latest goal for a session', async () => {
    const fetchMock = stubFetch(okResponse({ goal }))

    await expect(api.getLatestSessionGoal('ses_1')).resolves.toEqual(goal)
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/internal/session-goals?sessionId=ses_1`, {
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('returns null when the session has no goal', async () => {
    stubFetch(okResponse({ goal: null }))

    await expect(api.getLatestSessionGoal('ses_1')).resolves.toBeNull()
  })

  it('starts a goal', async () => {
    const fetchMock = stubFetch(okResponse({ goal }))
    const input = { sessionId: 'ses_1', directory: '/repo', objective: 'fix it' }

    await expect(api.startSessionGoal(input)).resolves.toEqual(goal)
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/internal/session-goals`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  })

  it('pauses, resumes, and cancels a goal through the action route', async () => {
    const fetchMock = stubFetch(okResponse({ goal }))

    await expect(api.pauseSessionGoal(7)).resolves.toEqual(goal)
    await expect(api.resumeSessionGoal(7)).resolves.toEqual(goal)
    await expect(api.cancelSessionGoal(7)).resolves.toEqual(goal)

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${BASE_URL}/api/internal/session-goals/7/pause`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${BASE_URL}/api/internal/session-goals/7/resume`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(3, `${BASE_URL}/api/internal/session-goals/7/cancel`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('forwards the abort signal to fetch', async () => {
    const fetchMock = stubFetch(okResponse({ goal }))
    const controller = new AbortController()

    await api.getLatestSessionGoal('ses_1', controller.signal)

    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/internal/session-goals?sessionId=ses_1`, {
      headers: { Authorization: 'Bearer tok' },
      signal: controller.signal,
    })
  })

  it('rejects a goal response that fails schema validation', async () => {
    stubFetch(okResponse({ goal: { ...goal, status: 'bogus' } }))

    await expect(api.getLatestSessionGoal('ses_1')).rejects.toThrow()
  })
})

describe('ManagerApi multi-runs', () => {
  const api = new ManagerApi(BASE_URL, 'tok')

  it('lists runs for a repo', async () => {
    const fetchMock = stubFetch(okResponse({ runs: [run] }))

    await expect(api.listMultiRuns(1)).resolves.toEqual([run])
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/internal/multi-runs?repoId=1`, {
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('launches a run', async () => {
    const fetchMock = stubFetch(okResponse({ run }))
    const request = { repoId: 1, name: 'sweep', prompt: 'hello', models: ['a/b'], isolate: true }

    await expect(api.launchMultiRun(request)).resolves.toEqual(run)
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/internal/multi-runs`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  })

  it('fuses selected entries', async () => {
    const fetchMock = stubFetch(okResponse({ run }))
    const request = { requestId: '11111111-1111-4111-8111-111111111111', entryIds: [1, 2], model: 'a/b' }

    await expect(api.fuseMultiRun(3, request)).resolves.toEqual(run)
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/internal/multi-runs/3/fusions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  })

  it('discards an entry', async () => {
    const fetchMock = stubFetch(okResponse({ run }))

    await expect(api.discardMultiRunEntry(3, 4)).resolves.toEqual(run)
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/internal/multi-runs/3/entries/4/discard`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
  })
})

describe('ManagerApiError', () => {
  const api = new ManagerApi(BASE_URL, 'tok')

  it('reads the machine code from the JSON code field, not the human error text', async () => {
    const details = { unavailableSources: [{ entryId: 1, model: 'a/b', reason: 'running', message: 'still running' }] }
    stubFetch(errorResponse(409, JSON.stringify({ error: 'Fusion unavailable', code: 'FUSION_UNAVAILABLE', details })))

    const error = await api.fuseMultiRun(3, { requestId: '11111111-1111-4111-8111-111111111111', entryIds: [1, 2], model: 'a/b' }).catch((err) => err)

    expect(error).toBeInstanceOf(ManagerApiError)
    expect((error as ManagerApiError).status).toBe(409)
    expect((error as ManagerApiError).code).toBe('FUSION_UNAVAILABLE')
    expect((error as ManagerApiError).message).toContain('Fusion unavailable')
    expect((error as ManagerApiError).details).toEqual(details)
    expect((error as ManagerApiError).jsonBody).toBe(true)
  })

  it('leaves the code null when the body only carries human error text', async () => {
    stubFetch(errorResponse(409, JSON.stringify({ error: 'Fusion unavailable' })))

    const error = await api.fuseMultiRun(3, { requestId: '11111111-1111-4111-8111-111111111111', entryIds: [1, 2], model: 'a/b' }).catch((err) => err)

    expect((error as ManagerApiError).code).toBeNull()
  })

  it('leaves details null when the error body has none', async () => {
    stubFetch(errorResponse(400, JSON.stringify({ error: 'Invalid request' })))

    const error = await api.listMultiRuns(1).catch((err) => err)

    expect((error as ManagerApiError).details).toBeNull()
  })

  it('marks a plain-text error body as non-JSON', async () => {
    stubFetch(errorResponse(500, 'boom'))

    const error = await api.listMultiRuns(1).catch((err) => err)

    expect((error as ManagerApiError).jsonBody).toBe(false)
    expect((error as ManagerApiError).code).toBeNull()
  })
})

describe('ManagerApi feature support', () => {
  const api = new ManagerApi(BASE_URL, 'tok')

  it('maps a 401 to MANAGER_FEATURE_MISSING when the token probe succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(401, JSON.stringify({ error: 'Unauthorized' })))
      .mockResolvedValueOnce(okResponse({ workspaces: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const error = await api.listMultiRuns(1).catch((err) => err)

    expect(error).toBeInstanceOf(ManagerApiError)
    expect((error as ManagerApiError).status).toBe(401)
    expect((error as ManagerApiError).code).toBe(MANAGER_FEATURE_MISSING)
    expect(isManagerRouteMissing(error)).toBe(true)
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${BASE_URL}/api/internal/opencode-workspaces`, {
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('keeps the plain 401 when the token probe is also rejected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(401, JSON.stringify({ error: 'Unauthorized' })))
      .mockResolvedValueOnce(errorResponse(401, JSON.stringify({ error: 'Unauthorized' })))
    vi.stubGlobal('fetch', fetchMock)

    const error = await api.listMultiRuns(1).catch((err) => err)

    expect(error).toBeInstanceOf(ManagerApiError)
    expect((error as ManagerApiError).status).toBe(401)
    expect((error as ManagerApiError).code).toBeNull()
    expect(isManagerRouteMissing(error)).toBe(false)
  })

  it('keeps the plain 401 when the token probe throws', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(401, JSON.stringify({ error: 'Unauthorized' })))
      .mockRejectedValueOnce(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const error = await api.listMultiRuns(1).catch((err) => err)

    expect(error).toBeInstanceOf(ManagerApiError)
    expect((error as ManagerApiError).status).toBe(401)
    expect((error as ManagerApiError).code).toBeNull()
    expect(isManagerRouteMissing(error)).toBe(false)
  })

  it('forwards the caller abort signal to the token probe', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(401, JSON.stringify({ error: 'Unauthorized' })))
      .mockResolvedValueOnce(okResponse({ workspaces: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await api.getLatestSessionGoal('ses_1', controller.signal).catch(() => undefined)

    expect(fetchMock).toHaveBeenNthCalledWith(2, `${BASE_URL}/api/internal/opencode-workspaces`, {
      headers: { Authorization: 'Bearer tok' },
      signal: controller.signal,
    })
  })
})

describe('isManagerRouteMissing', () => {
  const api = new ManagerApi(BASE_URL, 'tok')

  it('is true for a 404 with a non-JSON body', async () => {
    stubFetch(errorResponse(404, '404 Not Found'))

    const error = await api.listMultiRuns(1).catch((err) => err)

    expect(isManagerRouteMissing(error)).toBe(true)
  })

  it('is false for a 404 with a JSON error body', async () => {
    stubFetch(errorResponse(404, JSON.stringify({ error: 'Multi-run not found' })))

    const error = await api.listMultiRuns(1).catch((err) => err)

    expect(isManagerRouteMissing(error)).toBe(false)
  })

  it('is false for non-404 failures and unrelated errors', () => {
    expect(isManagerRouteMissing(new ManagerApiError('x', 500, null, 'op'))).toBe(false)
    expect(isManagerRouteMissing(new Error('nope'))).toBe(false)
    expect(isManagerRouteMissing(null)).toBe(false)
  })
})
