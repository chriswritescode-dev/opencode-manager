import { beforeEach, describe, expect, it } from 'vitest'
import type { LoaderFunctionArgs } from 'react-router-dom'
import {
  getLoginRedirectTarget,
  loginLoader,
  loginRedirectPath,
  protectedLoader,
  resolveRedirectTarget,
  type AuthConfig,
} from './auth-loaders'
import { STORED_AUTH_USER_KEY } from './authSession'
import { createFetchFake, type FetchRoute } from '@/test/fetchFake'
import { makeAuthConfig, makeAuthSession } from '@/test/fixtures/api'

const STORED_USER_KEY_VALUE = { id: 'user-1', email: 'user@example.com', name: 'Ada' }

const SESSION_ROUTE = '/api/auth/get-session'
const CONFIG_ROUTE = '/api/auth-info/config'

function loaderArgs(url: string): LoaderFunctionArgs {
  return { request: new Request(url), params: {} }
}

function redirectLocation(result: Response | { config: AuthConfig } | null): string | null {
  if (!(result instanceof Response)) return null
  const location = new URL(result.headers.get('Location') ?? '', 'http://localhost')
  return `${location.pathname}${location.search}`
}

function sessionRoute(respond: FetchRoute['respond']): FetchRoute {
  return { method: 'GET', path: SESSION_ROUTE, respond }
}

function configRoute(config = makeAuthConfig()): FetchRoute {
  return { method: 'GET', path: CONFIG_ROUTE, respond: () => ({ json: config }) }
}

function installRoutes(routes: FetchRoute[]): void {
  createFetchFake(routes).install()
}

describe('auth redirect targets', () => {
  it('keeps same-origin relative paths', () => {
    expect(resolveRedirectTarget('/repos/2?tab=workspaces#session')).toBe('/repos/2?tab=workspaces#session')
    expect(resolveRedirectTarget('/')).toBe('/')
  })

  it.each([
    ['protocol-relative', '//evil.example.com/path'],
    ['absolute url', 'https://evil.example.com/path'],
    ['scheme-relative', 'javascript:alert(1)'],
    ['backslash escape', '/\\evil.example.com'],
    ['relative without slash', 'repos/2'],
    ['empty', ''],
    ['non-string', null],
  ])('rejects %s targets', (_label, value) => {
    expect(resolveRedirectTarget(value)).toBe('/')
  })

  it('reads the redirect target from a login query string', () => {
    expect(getLoginRedirectTarget('?redirect=%2Frepos%2F2%3Ftab%3Dworkspaces')).toBe('/repos/2?tab=workspaces')
    expect(getLoginRedirectTarget('?redirect=%2F%2Fevil.example.com')).toBe('/')
    expect(getLoginRedirectTarget('')).toBe('/')
  })

  it('builds the login path with an encoded redirect target', () => {
    expect(loginRedirectPath('/')).toBe('/login')
    expect(loginRedirectPath('/repos/2?tab=workspaces')).toBe('/login?redirect=%2Frepos%2F2%3Ftab%3Dworkspaces')
    expect(loginRedirectPath('//evil.example.com')).toBe('/login')
  })
})

describe('protectedLoader', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('redirects an anonymous visitor to login carrying the requested location', async () => {
    installRoutes([sessionRoute(() => ({ json: null }))])

    const result = await protectedLoader(loaderArgs('http://localhost/repos/2?tab=workspaces#session'))

    expect(redirectLocation(result)).toBe('/login?redirect=%2Frepos%2F2%3Ftab%3Dworkspaces%23session')
  })

  it('lets an authenticated visitor through', async () => {
    installRoutes([sessionRoute(() => ({ json: makeAuthSession() }))])

    await expect(protectedLoader(loaderArgs('http://localhost/repos/2'))).resolves.toBeNull()
  })

  it('remembers the validated user for an offline cold start', async () => {
    installRoutes([sessionRoute(() => ({ json: makeAuthSession() }))])

    await protectedLoader(loaderArgs('http://localhost/repos/2'))

    expect(JSON.parse(localStorage.getItem(STORED_AUTH_USER_KEY) ?? '')).toEqual({
      id: 'test-user',
      email: 'test@example.com',
      name: 'Test User',
    })
  })

  it('lets a stored user through when the session read fails transiently', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER_KEY_VALUE))
    installRoutes([
      sessionRoute(() => {
        throw new TypeError('Failed to fetch')
      }),
    ])

    await expect(protectedLoader(loaderArgs('http://localhost/repos/2'))).resolves.toBeNull()
    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).not.toBeNull()
  })

  it('lets a stored user through on a 5xx response', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER_KEY_VALUE))
    installRoutes([sessionRoute(() => ({ status: 503, json: { error: 'unavailable' } }))])

    await expect(protectedLoader(loaderArgs('http://localhost/repos/2'))).resolves.toBeNull()
  })

  it('redirects when a transient failure has no stored user', async () => {
    installRoutes([
      sessionRoute(() => {
        throw new TypeError('Failed to fetch')
      }),
    ])

    const result = await protectedLoader(loaderArgs('http://localhost/repos/2'))

    expect(redirectLocation(result)).toBe('/login?redirect=%2Frepos%2F2')
  })

  it.each([
    ['a 401 response', () => ({ status: 401, json: { error: 'unauthorized' } })],
    ['a successful response without a user', () => ({ json: null })],
  ])('forgets the stored user and redirects on %s', async (_label, respond) => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER_KEY_VALUE))
    installRoutes([sessionRoute(respond)])

    const result = await protectedLoader(loaderArgs('http://localhost/repos/2'))

    expect(redirectLocation(result)).toBe('/login?redirect=%2Frepos%2F2')
    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).toBeNull()
  })
})

describe('loginLoader', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns an authenticated visitor to the redirect target', async () => {
    installRoutes([configRoute(), sessionRoute(() => ({ json: makeAuthSession() }))])

    const result = await loginLoader(loaderArgs('http://localhost/login?redirect=%2Frepos%2F2%3Ftab%3Dworkspaces'))

    expect(redirectLocation(result)).toBe('/repos/2?tab=workspaces')
  })

  it('returns an authenticated visitor without a target to the app root', async () => {
    installRoutes([configRoute(), sessionRoute(() => ({ json: makeAuthSession() }))])

    const result = await loginLoader(loaderArgs('http://localhost/login'))

    expect(redirectLocation(result)).toBe('/')
  })

  it('ignores an unsafe redirect target', async () => {
    installRoutes([configRoute(), sessionRoute(() => ({ json: makeAuthSession() }))])

    const result = await loginLoader(loaderArgs('http://localhost/login?redirect=%2F%2Fevil.example.com'))

    expect(redirectLocation(result)).toBe('/')
  })
})
