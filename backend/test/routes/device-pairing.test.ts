import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import {
  DevicePairingAvailabilitySchema,
  DevicePairingLinksResponseSchema,
  buildManagerBrowserPairingLink,
  parseManagerAppLink,
  type DevicePairingAvailability,
  type DevicePairingLinksResponse,
} from '@opencode-manager/shared/schemas'

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../../src/utils/logger', () => ({ logger: loggerMocks }))

import { createTestDb } from '../helpers/assistant-workspace'
import { expectNoSecretsLogged } from '../helpers/log-assertions'
import { CLOUDFLARE_HEADERS, CLOUDFLARE_SECRET_VALUES } from '../helpers/remote-access-headers'
import { writeEncryptedSecret } from '../../src/db/secrets'
import {
  RemoteAccessHeadersService,
  REMOTE_ACCESS_HEADERS_SECRET_KEY,
} from '../../src/services/remote-access-headers'
import { createDevicePairingRoutes } from '../../src/routes/device-pairing'

const CODE = 'pairing-code-0123456789abcdef'
const EXPIRES_AT = new Date('2026-10-22T12:00:00.000Z')

const TRUSTED_ORIGINS = [
  'https://m.example.com',
  'http://192.168.1.20:5003',
  'http://203.0.113.5:5003',
  'http://localhost:5173',
]

const MISSING_ORIGIN_ERROR =
  'The request had no Origin header. Open the Manager at MANAGER_PUBLIC_URL or an address listed in AUTH_TRUSTED_ORIGINS to pair a device.'
const untrustedOriginError = (origin: string) =>
  `This address (${origin}) is not a trusted Manager address. Set MANAGER_PUBLIC_URL to it or add it to AUTH_TRUSTED_ORIGINS, then restart the Manager to pair a device.`
const LOOPBACK_ORIGIN_ERROR =
  'This page is open on localhost, which other devices cannot reach. Open the Manager at its public or LAN address to pair a device.'
const INSECURE_ORIGIN_ERROR =
  'Pairing needs HTTPS on a public address. Serve the Manager over HTTPS, or open it at a private network address.'
const LINKS_FAILED_ERROR = 'Failed to create device pairing links'

const SENSITIVE_VALUES = [CODE, ...CLOUDFLARE_SECRET_VALUES]

const COOKIE_HEADER = 'session=test-session'

const createMintPairingCode = () =>
  vi.fn<(headers: Headers) => Promise<{ code: string; expiresAt: Date }>>(async () => ({
    code: CODE,
    expiresAt: EXPIRES_AT,
  }))

async function readLinksBody(response: Response): Promise<DevicePairingLinksResponse> {
  return DevicePairingLinksResponseSchema.parse(await response.json())
}

async function readAvailabilityBody(response: Response): Promise<DevicePairingAvailability> {
  return DevicePairingAvailabilitySchema.parse(await response.json())
}

describe('device pairing link routes', () => {
  let db: Database
  let remoteAccessHeaders: RemoteAccessHeadersService
  let mintPairingCode: ReturnType<typeof createMintPairingCode>
  let allowPrivateNetwork: boolean
  let development: boolean
  let publicOrigin: string | null
  let app: Hono

  beforeEach(() => {
    allowPrivateNetwork = false
    development = false
    publicOrigin = null
    db = createTestDb()
    remoteAccessHeaders = new RemoteAccessHeadersService(db)
    remoteAccessHeaders.replace({ headers: CLOUDFLARE_HEADERS })
    mintPairingCode = createMintPairingCode()
    app = new Hono()
    app.route(
      '/device-pairing',
      createDevicePairingRoutes({
        mintPairingCode,
        remoteAccessHeaders,
        readAllowPrivateNetworkHttp: () => allowPrivateNetwork,
        resolveTrustedOrigins: () => TRUSTED_ORIGINS,
        isDevelopment: () => development,
        resolvePublicOrigin: () => publicOrigin,
      }),
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  const postLinks = (origin?: string, body?: unknown) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      cookie: COOKIE_HEADER,
    }
    if (origin) headers.origin = origin

    return app.request('/device-pairing/links', {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
    })
  }

  const getAvailability = (origin?: string) => {
    const path =
      origin === undefined
        ? '/device-pairing/availability'
        : `/device-pairing/availability?origin=${encodeURIComponent(origin)}`

    return app.request(path, { headers: { cookie: COOKIE_HEADER } })
  }

  it('rejects a request without an origin', async () => {
    const res = await postLinks()

    expect(res.status).toBe(400)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    await expect(res.json()).resolves.toEqual({
      error: MISSING_ORIGIN_ERROR,
      code: 'untrusted-origin',
    })
    expect(mintPairingCode).not.toHaveBeenCalled()
  })

  it('rejects an untrusted origin', async () => {
    const res = await postLinks('https://evil.example')

    expect(res.status).toBe(400)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json() as { error: string; code: string }
    expect(body.error).toBe(untrustedOriginError('https://evil.example'))
    expect(body.error).toContain('AUTH_TRUSTED_ORIGINS')
    expect(body.code).toBe('untrusted-origin')
    expect(mintPairingCode).not.toHaveBeenCalled()
  })

  it('rejects the null origin', async () => {
    const res = await postLinks('null')

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: untrustedOriginError('null'),
      code: 'untrusted-origin',
    })
    expect(mintPairingCode).not.toHaveBeenCalled()
  })

  it('builds links for a trusted https origin', async () => {
    const res = await postLinks('https://m.example.com')

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await readLinksBody(res)

    expect(parseManagerAppLink(body.appLink ?? '')).toEqual({
      kind: 'manager',
      name: 'm.example.com',
      baseUrl: 'https://m.example.com',
      code: CODE,
      headers: CLOUDFLARE_HEADERS,
    })
    expect(body.browserLink).toBe(buildManagerBrowserPairingLink('https://m.example.com', CODE))
    expect(body.headerNames).toEqual(['CF-Access-Client-Id', 'CF-Access-Client-Secret'])
    expect(body.warnings).toEqual([])
    expect(body.appLinkBlockedReason).toBeNull()
    expect(body.expiresAt).toBe(EXPIRES_AT.toISOString())

    expect(mintPairingCode).toHaveBeenCalledTimes(1)
    const forwardedHeaders = mintPairingCode.mock.calls[0]?.[0]
    expect(forwardedHeaders).toBeInstanceOf(Headers)
    expect(forwardedHeaders?.get('cookie')).toBe(COOKIE_HEADER)
  })

  it('builds links on the public address from a trusted localhost page', async () => {
    publicOrigin = 'https://m.example.com'
    development = false

    const res = await postLinks('http://localhost:5173')

    expect(res.status).toBe(200)
    const body = await readLinksBody(res)

    expect(parseManagerAppLink(body.appLink ?? '')).toMatchObject({
      kind: 'manager',
      name: 'm.example.com',
      baseUrl: 'https://m.example.com',
      code: CODE,
      headers: CLOUDFLARE_HEADERS,
    })
    expect(body.appLink).toContain('url=https%3A%2F%2Fm.example.com')
    expect(body.browserLink).toBe(buildManagerBrowserPairingLink('https://m.example.com', CODE))
    expect(body.browserLink.startsWith('https://m.example.com/pair#c=')).toBe(true)
    expect(body.appLinkBlockedReason).toBeNull()
    expect(body.warnings).toEqual([])
    expect(mintPairingCode).toHaveBeenCalledTimes(1)
  })

  it('uses the supplied device name in the app link', async () => {
    const res = await postLinks('https://m.example.com', { name: 'Office' })

    expect(res.status).toBe(200)
    const body = await readLinksBody(res)

    expect(parseManagerAppLink(body.appLink ?? '')?.name).toBe('Office')
  })

  it('blocks a private network http origin when the toggle is off', async () => {
    const res = await postLinks('http://192.168.1.20:5003')

    expect(res.status).toBe(200)
    const body = await readLinksBody(res)

    expect(body.appLink).toBeNull()
    expect(body.appLinkBlockedReason).toBe('insecure-origin')
    expect(body.warnings).toEqual(['plain-http'])
    expect(body.browserLink).toBe(buildManagerBrowserPairingLink('http://192.168.1.20:5003', CODE))
  })

  it('allows a private network http origin when the toggle is on', async () => {
    allowPrivateNetwork = true

    const res = await postLinks('http://192.168.1.20:5003')

    expect(res.status).toBe(200)
    const body = await readLinksBody(res)

    expect(parseManagerAppLink(body.appLink ?? '')?.baseUrl).toBe('http://192.168.1.20:5003')
    expect(body.warnings).toEqual(['plain-http'])
  })

  it('blocks a public http origin even when the toggle is on', async () => {
    allowPrivateNetwork = true

    const res = await postLinks('http://203.0.113.5:5003')

    expect(res.status).toBe(400)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    await expect(res.json()).resolves.toEqual({
      error: INSECURE_ORIGIN_ERROR,
      code: 'insecure-origin',
    })
    expect(mintPairingCode).not.toHaveBeenCalled()
  })

  it('blocks a loopback origin outside development', async () => {
    allowPrivateNetwork = true
    development = false

    const res = await postLinks('http://localhost:5173')

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: LOOPBACK_ORIGIN_ERROR,
      code: 'loopback',
    })
    expect(mintPairingCode).not.toHaveBeenCalled()
  })

  it('allows a loopback origin in development', async () => {
    allowPrivateNetwork = true
    development = true

    const res = await postLinks('http://localhost:5173')

    expect(res.status).toBe(200)
    const body = await readLinksBody(res)

    expect(parseManagerAppLink(body.appLink ?? '')?.baseUrl).toBe('http://localhost:5173')
    expect(body.warnings).toEqual(['plain-http', 'loopback'])
  })

  it('reports unreadable stored headers', async () => {
    writeEncryptedSecret(
      db,
      REMOTE_ACCESS_HEADERS_SECRET_KEY,
      JSON.stringify([{ name: 'Cookie', value: 'stolen' }]),
    )

    const res = await postLinks('https://m.example.com')

    expect(res.status).toBe(200)
    const body = await readLinksBody(res)

    expect(body.headerNames).toEqual([])
    expect(body.warnings).toContain('headers-unreadable')
    expect(parseManagerAppLink(body.appLink ?? '')?.headers).toEqual([])
  })

  it('fails without logging pairing secrets', async () => {
    await postLinks('https://m.example.com')
    mintPairingCode.mockRejectedValueOnce(new Error('mint failed'))

    const res = await postLinks('https://m.example.com')

    expect(res.status).toBe(500)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    await expect(res.json()).resolves.toEqual({ error: LINKS_FAILED_ERROR })

    expectNoSecretsLogged(loggerMocks, SENSITIVE_VALUES)
  })

  describe('GET availability', () => {
    it('reports a trusted https origin as available without minting', async () => {
      const res = await getAvailability('https://m.example.com')

      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      await expect(readAvailabilityBody(res)).resolves.toEqual({
        available: true,
        reason: null,
        message: null,
      })
      expect(mintPairingCode).not.toHaveBeenCalled()
    })

    it('reports a trusted localhost page available when a public origin is configured', async () => {
      publicOrigin = 'https://m.example.com'
      development = false

      const res = await getAvailability('http://localhost:5173')

      expect(res.status).toBe(200)
      await expect(readAvailabilityBody(res)).resolves.toEqual({
        available: true,
        reason: null,
        message: null,
      })
      expect(mintPairingCode).not.toHaveBeenCalled()
    })

    it('reports an untrusted origin', async () => {
      const res = await getAvailability('https://evil.example')

      expect(res.status).toBe(200)
      await expect(readAvailabilityBody(res)).resolves.toEqual({
        available: false,
        reason: 'untrusted-origin',
        message: untrustedOriginError('https://evil.example'),
      })
      expect(mintPairingCode).not.toHaveBeenCalled()
    })

    it('reports a loopback origin outside development', async () => {
      development = false

      const res = await getAvailability('http://localhost:5173')

      expect(res.status).toBe(200)
      await expect(readAvailabilityBody(res)).resolves.toEqual({
        available: false,
        reason: 'loopback',
        message: LOOPBACK_ORIGIN_ERROR,
      })
      expect(mintPairingCode).not.toHaveBeenCalled()
    })

    it('reports a loopback origin in development as available', async () => {
      development = true

      const res = await getAvailability('http://localhost:5173')

      expect(res.status).toBe(200)
      await expect(readAvailabilityBody(res)).resolves.toEqual({
        available: true,
        reason: null,
        message: null,
      })
      expect(mintPairingCode).not.toHaveBeenCalled()
    })

    it('reports a public http origin as insecure', async () => {
      allowPrivateNetwork = true

      const res = await getAvailability('http://203.0.113.5:5003')

      expect(res.status).toBe(200)
      await expect(readAvailabilityBody(res)).resolves.toEqual({
        available: false,
        reason: 'insecure-origin',
        message: INSECURE_ORIGIN_ERROR,
      })
      expect(mintPairingCode).not.toHaveBeenCalled()
    })

    it('keeps a private network http origin available so the browser link can be shown', async () => {
      const res = await getAvailability('http://192.168.1.20:5003')

      expect(res.status).toBe(200)
      await expect(readAvailabilityBody(res)).resolves.toEqual({
        available: true,
        reason: null,
        message: null,
      })
      expect(mintPairingCode).not.toHaveBeenCalled()
    })

    it('normalises the supplied address to its origin', async () => {
      const res = await getAvailability('https://m.example.com/settings?tab=pairing')

      expect(res.status).toBe(200)
      await expect(readAvailabilityBody(res)).resolves.toEqual({
        available: true,
        reason: null,
        message: null,
      })
    })

    it('rejects a missing origin query parameter', async () => {
      const res = await getAvailability()

      expect(res.status).toBe(400)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const body = await res.json() as { error: string }
      expect(body.error).toContain('origin query parameter')
      expect(mintPairingCode).not.toHaveBeenCalled()
    })

    it.each([
      ['garbage text', 'not a url'],
      ['a non-http scheme', 'ocm://link?v=2&kind=manager'],
      ['a scheme-relative address', '//m.example.com'],
    ])('rejects %s in the origin query parameter', async (_label, origin) => {
      const res = await getAvailability(origin)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('absolute http or https URL')
      expect(mintPairingCode).not.toHaveBeenCalled()
    })
  })
})
