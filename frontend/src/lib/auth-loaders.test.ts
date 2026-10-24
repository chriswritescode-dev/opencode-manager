import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoaderFunctionArgs } from 'react-router-dom'
import { getLoginRedirectTarget, loginLoader, loginRedirectPath, protectedLoader, resolveRedirectTarget } from './auth-loaders'
import { STORED_AUTH_USER_KEY } from './authSession'

const STORED_USER_KEY_VALUE = { id: 'user-1', email: 'user@example.com', name: 'Ada' }

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

vi.mock('./auth-client', () => ({ getSession: mocks.getSession }))

function loaderArgs(url: string): LoaderFunctionArgs {
  return { request: new Request(url), params: {}, context: {} } as LoaderFunctionArgs
}

function redirectLocation(result: Awaited<ReturnType<typeof protectedLoader>>): string | null {
  if (!(result instanceof Response)) return null
  return new URL(result.headers.get('Location') ?? '', 'http://localhost').pathname
    + new URL(result.headers.get('Location') ?? '', 'http://localhost').search
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
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('redirects an anonymous visitor to login carrying the requested location', async () => {
    mocks.getSession.mockResolvedValue({ data: null, error: null })

    const result = await protectedLoader(loaderArgs('http://localhost/repos/2?tab=workspaces#session'))

    expect(redirectLocation(result)).toBe('/login?redirect=%2Frepos%2F2%3Ftab%3Dworkspaces%23session')
  })

  it('lets an authenticated visitor through', async () => {
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    await expect(protectedLoader(loaderArgs('http://localhost/repos/2'))).resolves.toBeNull()
  })

  it('remembers the validated user for an offline cold start', async () => {
    mocks.getSession.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@example.com', name: 'Ada' } },
      error: null,
    })

    await protectedLoader(loaderArgs('http://localhost/repos/2'))

    expect(JSON.parse(localStorage.getItem(STORED_AUTH_USER_KEY) ?? '')).toEqual({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Ada',
    })
  })

  it('lets a stored user through when the session read fails transiently', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER_KEY_VALUE))
    mocks.getSession.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(protectedLoader(loaderArgs('http://localhost/repos/2'))).resolves.toBeNull()
    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).not.toBeNull()
  })

  it('lets a stored user through on a 5xx response', async () => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER_KEY_VALUE))
    mocks.getSession.mockResolvedValue({
      data: null,
      error: { status: 503, statusText: 'Service Unavailable' },
    })

    await expect(protectedLoader(loaderArgs('http://localhost/repos/2'))).resolves.toBeNull()
  })

  it('redirects when a transient failure has no stored user', async () => {
    mocks.getSession.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await protectedLoader(loaderArgs('http://localhost/repos/2'))

    expect(redirectLocation(result)).toBe('/login?redirect=%2Frepos%2F2')
  })

  it.each([
    ['a 401 response', { status: 401, statusText: 'Unauthorized' }],
    ['a successful response without a user', null],
  ])('forgets the stored user and redirects on %s', async (_label, error) => {
    localStorage.setItem(STORED_AUTH_USER_KEY, JSON.stringify(STORED_USER_KEY_VALUE))
    mocks.getSession.mockResolvedValue({ data: null, error })

    const result = await protectedLoader(loaderArgs('http://localhost/repos/2'))

    expect(redirectLocation(result)).toBe('/login?redirect=%2Frepos%2F2')
    expect(localStorage.getItem(STORED_AUTH_USER_KEY)).toBeNull()
  })
})

describe('loginLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabledProviders: ['credentials'], registrationEnabled: true, isFirstUser: false, adminConfigured: true }),
    }))
  })

  it('returns an authenticated visitor to the redirect target', async () => {
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    const result = await loginLoader(loaderArgs('http://localhost/login?redirect=%2Frepos%2F2%3Ftab%3Dworkspaces'))

    expect(redirectLocation(result)).toBe('/repos/2?tab=workspaces')
  })

  it('returns an authenticated visitor without a target to the app root', async () => {
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    const result = await loginLoader(loaderArgs('http://localhost/login'))

    expect(redirectLocation(result)).toBe('/')
  })

  it('ignores an unsafe redirect target', async () => {
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    const result = await loginLoader(loaderArgs('http://localhost/login?redirect=%2F%2Fevil.example.com'))

    expect(redirectLocation(result)).toBe('/')
  })
})
