import { describe, it, expect, vi, afterEach } from 'vitest'
import { JsonObjectSchema, type JsonValue } from '@opencode-manager/shared/utils'
import { ManagerApi, ManagerApiError, isManagerRouteMissing, MANAGER_FEATURE_MISSING } from '../src/manager-api.js'
import type { MultiRun } from '@opencode-manager/shared/schemas'

const BASE_URL = 'http://localhost:5003'

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const run: MultiRun = {
  id: 3,
  repoId: 1,
  serverId: 'local',
  directory: null,
  name: 'sweep',
  prompt: 'hello',
  isolated: true,
  baseRef: null,
  createdAt: 1,
  entries: [],
  fusions: [],
}

function okResponse(body: JsonValue): Response {
  return Response.json(body)
}

function errorResponse(status: number, text: string): Response {
  return new Response(text, { status })
}

function stubFetch(respond: FetchImplementation) {
  const fetchMock = vi.fn<FetchImplementation>(respond)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function stubSingleResponse(response: Response) {
  return stubFetch(async () => response)
}

async function expectApiError(request: Promise<unknown>): Promise<ManagerApiError> {
  const failure = await request.then(() => null, (cause) => cause)
  expect(failure).toBeInstanceOf(ManagerApiError)
  if (!(failure instanceof ManagerApiError)) throw new Error('expected a ManagerApiError')
  return failure
}

function errorBody(code: string | null, text: string): JsonValue {
  return code === null ? { error: text } : { error: text, code }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ManagerApi multi-runs', () => {
  const api = new ManagerApi(BASE_URL, 'tok')

  it('lists runs for a repo', async () => {
    const fetchMock = stubSingleResponse(okResponse({ runs: [run] }))

    await expect(api.listMultiRuns(1)).resolves.toEqual([run])
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/internal/multi-runs?repoId=1`, {
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('launches a run', async () => {
    const fetchMock = stubSingleResponse(okResponse({ run }))
    const request = { repoId: 1, name: 'sweep', prompt: 'hello', models: ['a/b'], isolate: true }

    await expect(api.launchMultiRun(request)).resolves.toEqual(run)
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/internal/multi-runs`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  })

  it('fuses selected entries', async () => {
    const fetchMock = stubSingleResponse(okResponse({ run }))
    const request = { requestId: '11111111-1111-4111-8111-111111111111', entryIds: [1, 2], model: 'a/b' }

    await expect(api.fuseMultiRun(3, request)).resolves.toEqual(run)
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/internal/multi-runs/3/fusions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  })

  it('discards an entry', async () => {
    const fetchMock = stubSingleResponse(okResponse({ run }))

    await expect(api.discardMultiRunEntry(3, 4)).resolves.toEqual(run)
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/internal/multi-runs/3/entries/4/discard`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
  })
})

describe('ManagerApiError', () => {
  const api = new ManagerApi(BASE_URL, 'tok')
  const fusion = { requestId: '11111111-1111-4111-8111-111111111111', entryIds: [1, 2], model: 'a/b' }

  it('reads the machine code from the JSON code field, not the human error text', async () => {
    const details = { unavailableSources: [{ entryId: 1, model: 'a/b', reason: 'running', message: 'still running' }] }
    stubSingleResponse(errorResponse(409, JSON.stringify({ error: 'Fusion unavailable', code: 'FUSION_UNAVAILABLE', details })))

    const error = await expectApiError(api.fuseMultiRun(3, fusion))

    expect(error.status).toBe(409)
    expect(error.code).toBe('FUSION_UNAVAILABLE')
    expect(error.message).toContain('Fusion unavailable')
    expect(error.details).toEqual(details)
    expect(error.jsonBody).toBe(true)
  })

  it('leaves the code null when the body only carries human error text', async () => {
    stubSingleResponse(errorResponse(409, JSON.stringify(errorBody(null, 'Fusion unavailable'))))

    const error = await expectApiError(api.fuseMultiRun(3, fusion))

    expect(error.code).toBeNull()
  })

  it('leaves details null when the error body has none', async () => {
    stubSingleResponse(errorResponse(400, JSON.stringify(errorBody(null, 'Invalid request'))))

    const error = await expectApiError(api.listMultiRuns(1))

    expect(error.details).toBeNull()
  })

  it('marks a plain-text error body as non-JSON', async () => {
    stubSingleResponse(errorResponse(500, 'boom'))

    const error = await expectApiError(api.listMultiRuns(1))

    expect(error.jsonBody).toBe(false)
    expect(error.code).toBeNull()
  })
})

describe('ManagerApi feature support', () => {
  const api = new ManagerApi(BASE_URL, 'tok')

  it('maps a 401 to MANAGER_FEATURE_MISSING when the token probe succeeds', async () => {
    const fetchMock = stubFetch(async (input) =>
      String(input).endsWith('/api/internal/opencode-workspaces')
        ? okResponse({ workspaces: [] })
        : errorResponse(401, JSON.stringify(errorBody(null, 'Unauthorized'))),
    )

    const error = await expectApiError(api.listMultiRuns(1))

    expect(error.status).toBe(401)
    expect(error.code).toBe(MANAGER_FEATURE_MISSING)
    expect(isManagerRouteMissing(error)).toBe(true)
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${BASE_URL}/api/internal/opencode-workspaces`, {
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('keeps the plain 401 when the token probe is also rejected', async () => {
    stubFetch(async () => errorResponse(401, JSON.stringify(errorBody(null, 'Unauthorized'))))

    const error = await expectApiError(api.listMultiRuns(1))

    expect(error.status).toBe(401)
    expect(error.code).toBeNull()
    expect(isManagerRouteMissing(error)).toBe(false)
  })

  it('keeps the plain 401 when the token probe throws', async () => {
    const fetchMock = stubFetch(async (input) => {
      if (String(input).endsWith('/api/internal/opencode-workspaces')) throw new Error('network down')
      return errorResponse(401, JSON.stringify(errorBody(null, 'Unauthorized')))
    })

    const error = await expectApiError(api.listMultiRuns(1))

    expect(error.status).toBe(401)
    expect(error.code).toBeNull()
    expect(isManagerRouteMissing(error)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('ManagerApi mirror routes', () => {
  const api = new ManagerApi(BASE_URL, 'tok')

  it('maps a 401 from mirrorCheckouts to MANAGER_FEATURE_MISSING with the move message', async () => {
    const fetchMock = stubFetch(async (input) =>
      String(input).endsWith('/api/internal/opencode-workspaces')
        ? okResponse({ workspaces: [] })
        : errorResponse(401, JSON.stringify(errorBody(null, 'Unauthorized'))),
    )

    const error = await expectApiError(api.mirrorCheckouts(1, 'feature'))

    expect(error.code).toBe(MANAGER_FEATURE_MISSING)
    expect(error.message).toContain('too old for /ocm-move worktrees')
    expect(isManagerRouteMissing(error)).toBe(true)
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${BASE_URL}/api/internal/opencode-workspaces`, {
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('keeps the multi-run feature message unchanged', async () => {
    stubFetch(async (input) =>
      String(input).endsWith('/api/internal/opencode-workspaces')
        ? okResponse({ workspaces: [] })
        : errorResponse(401, JSON.stringify(errorBody(null, 'Unauthorized'))),
    )

    const error = await expectApiError(api.listMultiRuns(1))

    expect(error.code).toBe(MANAGER_FEATURE_MISSING)
    expect(error.message).toContain('too old for ocm multi-runs')
  })

  it('sends the directory query on mirrorHead and mirrorContains', async () => {
    const fetchMock = stubFetch(async () =>
      okResponse({ repoId: 1, branch: null, head: null, dirty: false, contained: false }),
    )

    await api.mirrorHead(1, '/repos/work trees/repo')
    await api.mirrorContains(1, 'abc1234', '/repos/work trees/repo')

    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('directory')).toBe('/repos/work trees/repo')
    expect(new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get('directory')).toBe('/repos/work trees/repo')
  })

  it('parses a checkouts response of typed checkout states', async () => {
    const checkouts = {
      main: { directory: '/repos/repo', branch: 'main', head: 'abc', dirty: false },
      worktrees: [{ directory: '/repos/repo-feature', branch: 'feature', head: 'def', dirty: false }],
      branchHead: 'def',
      branchCheckedOut: true,
      suffixedWorktreeBranch: 'feature-ocm',
    }
    stubSingleResponse(okResponse(checkouts))

    const parsed = await api.mirrorCheckouts(1, 'feature')

    expect(parsed).toEqual(checkouts)
    expect(JsonObjectSchema.safeParse(checkouts).success).toBe(true)
  })
})

describe('isManagerRouteMissing', () => {
  const api = new ManagerApi(BASE_URL, 'tok')

  it('is true for a 404 with a non-JSON body', async () => {
    stubSingleResponse(errorResponse(404, '404 Not Found'))

    const error = await expectApiError(api.listMultiRuns(1))

    expect(isManagerRouteMissing(error)).toBe(true)
  })

  it('is false for a 404 with a JSON error body', async () => {
    stubSingleResponse(errorResponse(404, JSON.stringify(errorBody(null, 'Multi-run not found'))))

    const error = await expectApiError(api.listMultiRuns(1))

    expect(isManagerRouteMissing(error)).toBe(false)
  })

  it('is false for non-404 failures and unrelated errors', () => {
    expect(isManagerRouteMissing(new ManagerApiError('x', 500, null, 'op'))).toBe(false)
    expect(isManagerRouteMissing(new Error('nope'))).toBe(false)
    expect(isManagerRouteMissing(null)).toBe(false)
  })
})
