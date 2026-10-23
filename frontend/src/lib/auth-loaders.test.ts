import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoaderFunctionArgs } from 'react-router-dom'
import { getLoginRedirectTarget, loginLoader, loginRedirectPath, protectedLoader, resolveRedirectTarget } from './auth-loaders'

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
  })

  it('redirects an anonymous visitor to login carrying the requested location', async () => {
    mocks.getSession.mockResolvedValue({ data: null })

    const result = await protectedLoader(loaderArgs('http://localhost/repos/2?tab=workspaces#session'))

    expect(redirectLocation(result)).toBe('/login?redirect=%2Frepos%2F2%3Ftab%3Dworkspaces%23session')
  })

  it('lets an authenticated visitor through', async () => {
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    await expect(protectedLoader(loaderArgs('http://localhost/repos/2'))).resolves.toBeNull()
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
