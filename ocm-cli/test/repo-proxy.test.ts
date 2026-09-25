import { describe, it, expect, vi } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }
import {
  ManagerTokenInvalidError,
  ManagerTooOldError,
  MIN_MANAGER_VERSION,
  OCM_VERSION,
  RepoProxyNotFoundError,
  RepoProxyResponseError,
  RepoProxyUnreachableError,
  repoProxyBaseUrl,
  repoProxyUrl,
  warmRepoProxy,
} from '../src/repo-proxy.js'

const managerUrl = 'https://manager.example.com'

function fetchReturning(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error('unexpected fetch')
    if (next instanceof Error) throw next
    return next
  })
  return fetchMock
}

const noWait = vi.fn(async () => undefined)

describe('repoProxyUrl', () => {
  it('builds the repo-scoped proxy url', () => {
    expect(repoProxyUrl(managerUrl, 42)).toBe('https://manager.example.com/api/opencode-proxy/repos/42')
  })
})

describe('repoProxyBaseUrl', () => {
  it('builds the manager proxy base url', () => {
    expect(repoProxyBaseUrl(managerUrl)).toBe('https://manager.example.com/api/opencode-proxy')
  })
})

describe('warmRepoProxy', () => {
  it('reports the package version', () => {
    expect(OCM_VERSION).toBe(packageJson.version)
  })

  it('resolves once the repo proxy route responds', async () => {
    const fetchMock = fetchReturning(new Response('[]', { status: 200 }))

    await warmRepoProxy(managerUrl, 'tok', 42, { fetch: fetchMock, wait: noWait })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://manager.example.com/api/opencode-proxy/repos/42/api/session?limit=1',
      { headers: { Authorization: 'Bearer tok' } },
    )
  })

  it('fails with an upgrade message when the Manager has no repo proxy route', async () => {
    const fetchMock = fetchReturning(new Response('Not Found', { status: 404 }))

    const error = await warmRepoProxy(managerUrl, 'tok', 42, { fetch: fetchMock, wait: noWait }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(ManagerTooOldError)
    expect((error as Error).message).toBe(
      `OpenCode Manager at ${managerUrl} is too old for ocm 0.3.0; upgrade the Manager to >= ${MIN_MANAGER_VERSION}`,
    )
    expect(MIN_MANAGER_VERSION).toBe('0.19.0')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('distinguishes a missing repo on a current Manager from an old Manager', async () => {
    const fetchMock = fetchReturning(Response.json({ error: 'Repo not found' }, { status: 404 }))

    await expect(warmRepoProxy(managerUrl, 'tok', 42, { fetch: fetchMock, wait: noWait })).rejects.toBeInstanceOf(RepoProxyNotFoundError)
  })

  it('retries transient failures and reports the last response', async () => {
    const fetchMock = fetchReturning(new Error('ECONNRESET'), new Response('', { status: 502 }), new Response('', { status: 503 }))
    const wait = vi.fn(async () => undefined)

    const error = await warmRepoProxy(managerUrl, 'tok', 42, { fetch: fetchMock, wait }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(RepoProxyResponseError)
    expect((error as Error).message).toContain('HTTP 503')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls).toEqual([[500], [1000]])
  })

  it('reports the status and body of a non-OK response', async () => {
    const fetchMock = fetchReturning(new Response('proxy exploded', { status: 500 }))

    const error = await warmRepoProxy(managerUrl, 'tok', 42, { fetch: fetchMock, wait: noWait, attempts: 1 }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(RepoProxyResponseError)
    expect((error as Error).message).toContain('HTTP 500')
    expect((error as Error).message).toContain('proxy exploded')
  })

  it('reports an invalid manager token on 401 without retrying', async () => {
    const fetchMock = fetchReturning(new Response('Unauthorized', { status: 401 }))

    const error = await warmRepoProxy(managerUrl, 'tok', 42, { fetch: fetchMock, wait: noWait }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(ManagerTokenInvalidError)
    expect((error as Error).message).toContain('Settings -> Manager Internal Token')
    expect((error as Error).message).toContain(`ocm login ${managerUrl}`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports the network cause when the manager is unreachable', async () => {
    const cause = new Error('connect ECONNREFUSED')
    const fetchMock = fetchReturning(cause, cause, cause)

    const error = await warmRepoProxy(managerUrl, 'tok', 42, { fetch: fetchMock, wait: noWait }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(RepoProxyUnreachableError)
    expect((error as Error).message).toContain('connect ECONNREFUSED')
    expect((error as Error).cause).toBe(cause)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('succeeds after a transient failure', async () => {
    const fetchMock = fetchReturning(new Response('', { status: 503 }), new Response('[]', { status: 200 }))

    await warmRepoProxy(managerUrl, 'tok', 42, { fetch: fetchMock, wait: noWait })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
