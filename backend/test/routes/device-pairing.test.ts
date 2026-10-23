import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import {
  DevicePairingLinksResponseSchema,
  buildManagerBrowserPairingLink,
  parseManagerAppLink,
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
  'The request had no Origin header. Open the Manager at an address listed in AUTH_TRUSTED_ORIGINS to pair a device.'
const untrustedOriginError = (origin: string) =>
  `This address (${origin}) is not in AUTH_TRUSTED_ORIGINS. Add it and restart the Manager to pair a device.`
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

describe('device pairing link routes', () => {
  let db: Database
  let remoteAccessHeaders: RemoteAccessHeadersService
  let mintPairingCode: ReturnType<typeof createMintPairingCode>
  let allowPrivateNetwork: boolean
  let development: boolean
  let app: Hono

  beforeEach(() => {
    allowPrivateNetwork = false
    development = false
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

  it('rejects a request without an origin', async () => {
    const res = await postLinks()

    expect(res.status).toBe(400)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    await expect(res.json()).resolves.toEqual({ error: MISSING_ORIGIN_ERROR })
    expect(mintPairingCode).not.toHaveBeenCalled()
  })

  it('rejects an untrusted origin', async () => {
    const res = await postLinks('https://evil.example')

    expect(res.status).toBe(400)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json() as { error: string }
    expect(body.error).toBe(untrustedOriginError('https://evil.example'))
    expect(body.error).toContain('AUTH_TRUSTED_ORIGINS')
    expect(mintPairingCode).not.toHaveBeenCalled()
  })

  it('rejects the null origin', async () => {
    const res = await postLinks('null')

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: untrustedOriginError('null') })
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

    expect(res.status).toBe(200)
    const body = await readLinksBody(res)

    expect(body.appLink).toBeNull()
    expect(body.appLinkBlockedReason).toBe('insecure-origin')
  })

  it('blocks a loopback origin outside development', async () => {
    allowPrivateNetwork = true
    development = false

    const res = await postLinks('http://localhost:5173')

    expect(res.status).toBe(200)
    const body = await readLinksBody(res)

    expect(body.appLink).toBeNull()
    expect(body.appLinkBlockedReason).toBe('loopback')
    expect(body.warnings).toEqual(['plain-http', 'loopback'])
  })

  it('allows a loopback origin in development', async () => {
    allowPrivateNetwork = true
    development = true

    const res = await postLinks('http://localhost:5173')

    expect(res.status).toBe(200)
    const body = await readLinksBody(res)

    expect(parseManagerAppLink(body.appLink ?? '')?.baseUrl).toBe('http://localhost:5173')
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
})
