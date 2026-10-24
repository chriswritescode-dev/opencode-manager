import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import {
  DEVICE_PAIRING_CODE_TTL_SECONDS,
  DEVICE_PAIRING_ERROR_CODES,
  PAIRING_CODE_INVALID_MESSAGE,
  PairedDeviceSchema,
} from '@opencode-manager/shared/schemas'
import { createAuth, type AuthInstance } from '../../src/auth'
import { devicePairing } from '../../src/auth/device-pairing'
import { AUTH_SOCKET_IP_HEADER } from '../../src/auth/client-ip'
import { createAuthDatabase } from '../helpers/auth-database'

const { ENV } = vi.hoisted(() => ({
  ENV: {
    SERVER: { PORT: 5003, HOST: '0.0.0.0', NODE_ENV: 'test' },
    AUTH: {
      SECRET: 'test-secret-for-encryption-key-32c',
      TRUSTED_ORIGINS: 'http://localhost:5173,http://localhost:5003',
      SECURE_COOKIES: false,
      ADMIN_EMAIL: undefined as string | undefined,
      ADMIN_PASSWORD: undefined as string | undefined,
      ADMIN_PASSWORD_RESET: false,
      GITHUB_CLIENT_ID: undefined as string | undefined,
      GITHUB_CLIENT_SECRET: undefined as string | undefined,
      GOOGLE_CLIENT_ID: undefined as string | undefined,
      GOOGLE_CLIENT_SECRET: undefined as string | undefined,
      DISCORD_CLIENT_ID: undefined as string | undefined,
      DISCORD_CLIENT_SECRET: undefined as string | undefined,
      PASSKEY_RP_ID: 'localhost',
      PASSKEY_RP_NAME: 'OpenCode Manager',
      PASSKEY_ORIGIN: 'http://localhost:5003',
    },
    LOGGING: { DEBUG: false, LOG_LEVEL: 'info' },
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV,
  getTrustedOrigins: () => ENV.AUTH.TRUSTED_ORIGINS
    .split(',')
    .map((origin: string) => origin.trim())
    .filter((origin: string) => origin.length > 0),
}))

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const ORIGIN = 'http://localhost:5173'
const SIGN_UP_URL = `${ORIGIN}/api/auth/sign-up/email`
const REDEEM_URL = `${ORIGIN}/api/auth/device-pairing/redeem`
const UNROUTABLE_CREATE_URL = `${ORIGIN}/api/auth/device-pairing/create`
const DEVICES_URL = `${ORIGIN}/api/auth/device-pairing/devices`
const REVOKE_URL = `${ORIGIN}/api/auth/device-pairing/devices/revoke`
const PAIRED_DEVICE_KEYS = Object.keys(PairedDeviceSchema.shape).sort()

type PairedDeviceBody = {
  id: string
  deviceName: string | null
  userAgent: string | null
  ipAddress: string | null
  createdAt: string
  updatedAt: string
  isCurrent: boolean
}

function cookieHeaders(response: Response): Headers {
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0])
  return new Headers({ cookie: cookies.join('; ') })
}

function redeemRequest(code: string, deviceName?: string, ipAddress = '198.51.100.7'): Request {
  return new Request(REDEEM_URL, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      'user-agent': 'TestPhone/1.0',
      [AUTH_SOCKET_IP_HEADER]: ipAddress,
    },
    body: JSON.stringify(deviceName === undefined ? { code } : { code, deviceName }),
  })
}

function deviceRequest(url: string, method: 'GET' | 'POST', headers?: Headers, body?: unknown): Request {
  const requestHeaders: Record<string, string> = {
    origin: ORIGIN,
    'content-type': 'application/json',
    [AUTH_SOCKET_IP_HEADER]: '198.51.100.31',
  }
  const cookie = headers?.get('cookie')
  if (cookie) requestHeaders.cookie = cookie

  return new Request(url, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('devicePairing', () => {
  let db: Database
  let auth: AuthInstance

  beforeEach(() => {
    db = createAuthDatabase()
    auth = createAuth(db)
  })

  afterEach(() => {
    db.close()
  })

  async function signUp(email = 'creator@example.com', name = 'Creator'): Promise<Headers> {
    const response = await auth.handler(new Request(SIGN_UP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password: 'test-password', name }),
    }))
    expect(response.status).toBe(200)
    return cookieHeaders(response)
  }

  async function listDevices(headers: Headers): Promise<{ status: number; devices: PairedDeviceBody[] }> {
    const response = await auth.handler(deviceRequest(DEVICES_URL, 'GET', headers))
    const body = await response.json() as { devices?: PairedDeviceBody[] }
    return { status: response.status, devices: body.devices ?? [] }
  }

  async function pairPhone(creatorHeaders: Headers, deviceName: string): Promise<Headers> {
    const { code } = await auth.api.createDevicePairingCode({ headers: creatorHeaders })
    const response = await auth.handler(redeemRequest(code, deviceName, '198.51.100.55'))
    expect(response.status).toBe(200)
    return cookieHeaders(response)
  }

  it('mints a code stored only as a hash with the three-minute lifetime', async () => {
    const headers = await signUp()
    const mintedAt = Date.now()

    const { code, expiresAt } = await auth.api.createDevicePairingCode({ headers })

    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const lifetimeMs = new Date(expiresAt).getTime() - mintedAt
    expect(lifetimeMs).toBeGreaterThan((DEVICE_PAIRING_CODE_TTL_SECONDS - 5) * 1000)
    expect(lifetimeMs).toBeLessThanOrEqual((DEVICE_PAIRING_CODE_TTL_SECONDS + 5) * 1000)

    const rows = db.prepare('SELECT identifier, value, expiresAt FROM verification').all() as Array<{
      identifier: string
      value: string
      expiresAt: number
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.identifier).toBe(`device-pairing:${createHash('sha256').update(code).digest('base64url')}`)
    expect(JSON.stringify(rows)).not.toContain(code)
  })

  it('does not expose code minting over HTTP', async () => {
    const headers = await signUp()

    const response = await auth.handler(new Request(UNROUTABLE_CREATE_URL, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: headers.get('cookie') ?? '' },
      body: '{}',
    }))

    expect(response.status).toBe(404)
  })

  it('redeems a code into a new session for the same user', async () => {
    const creatorHeaders = await signUp()
    const creatorSession = await auth.api.getSession({ headers: creatorHeaders })
    expect(creatorSession).not.toBeNull()

    const { code } = await auth.api.createDevicePairingCode({ headers: creatorHeaders })
    const response = await auth.handler(redeemRequest(code, 'Chris iPhone'))

    expect(response.status).toBe(200)
    const body = await response.json() as { user: { id: string; name: string; email: string } }
    expect(body.user.id).toBe(creatorSession!.user.id)
    expect(body.user.email).toBe('creator@example.com')
    expect(body.user).not.toHaveProperty('token')

    const cookies = response.headers.getSetCookie()
    expect(cookies.length).toBeGreaterThan(0)
    const phoneSession = await auth.api.getSession({ headers: cookieHeaders(response) })
    expect(phoneSession).not.toBeNull()
    expect(phoneSession!.user.id).toBe(creatorSession!.user.id)
    expect(phoneSession!.session.id).not.toBe(creatorSession!.session.id)
    expect(phoneSession!.session.deviceName).toBe('Chris iPhone')
    expect(phoneSession!.session.userAgent).toBe('TestPhone/1.0')

    const creatorAfter = await auth.api.getSession({ headers: creatorHeaders })
    expect(creatorAfter?.session.id).toBe(creatorSession!.session.id)
    expect(db.prepare('SELECT COUNT(*) AS count FROM "session"').get()).toEqual({ count: 2 })
  })

  it('consumes a code once', async () => {
    const headers = await signUp()
    const { code } = await auth.api.createDevicePairingCode({ headers })

    const first = await auth.handler(redeemRequest(code, 'First Phone'))
    expect(first.status).toBe(200)

    const second = await auth.handler(redeemRequest(code, 'Second Phone'))
    expect(second.status).toBe(400)
    const body = await second.json() as { code?: string; message?: string }
    expect(body.code).toBe(DEVICE_PAIRING_ERROR_CODES.PAIRING_CODE_INVALID)
    expect(body.message).toBe(PAIRING_CODE_INVALID_MESSAGE)
  })

  it('rejects an expired code', async () => {
    const headers = await signUp()
    const { code } = await auth.api.createDevicePairingCode({ headers })
    db.prepare('UPDATE verification SET expiresAt = ?').run(Date.now() - 1000)

    const response = await auth.handler(redeemRequest(code, 'Late Phone'))

    expect(response.status).toBe(400)
    const body = await response.json() as { code?: string }
    expect(body.code).toBe(DEVICE_PAIRING_ERROR_CODES.PAIRING_CODE_INVALID)
  })

  it('allows exactly one of two concurrent redeems', async () => {
    const headers = await signUp()
    const { code } = await auth.api.createDevicePairingCode({ headers })

    const responses = await Promise.all([
      auth.handler(redeemRequest(code, 'Phone A', '198.51.100.20')),
      auth.handler(redeemRequest(code, 'Phone B', '198.51.100.20')),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 400])
    expect(db.prepare('SELECT COUNT(*) AS count FROM "session"').get()).toEqual({ count: 2 })
  })

  it('creates a session without a device name when none is given', async () => {
    const headers = await signUp()
    const { code } = await auth.api.createDevicePairingCode({ headers })

    const response = await auth.handler(redeemRequest(code))
    expect(response.status).toBe(200)

    const session = await auth.api.getSession({ headers: cookieHeaders(response) })
    expect(session).not.toBeNull()
    expect(session!.session.deviceName ?? null).toBeNull()
  })

  it('lists active sessions as paired devices without session tokens', async () => {
    const creatorHeaders = await signUp()
    await pairPhone(creatorHeaders, 'Chris iPhone')

    const { status, devices } = await listDevices(creatorHeaders)

    expect(status).toBe(200)
    expect(devices).toHaveLength(2)
    for (const device of devices) {
      expect(Object.keys(device).sort()).toEqual(PAIRED_DEVICE_KEYS)
    }

    const updatedAt = devices.map((device) => device.updatedAt)
    expect(updatedAt).toEqual([...updatedAt].sort().reverse())

    const creatorSession = await auth.api.getSession({ headers: creatorHeaders })
    const current = devices.find((device) => device.id === creatorSession!.session.id)
    expect(current?.isCurrent).toBe(true)

    const phone = devices.find((device) => device.id !== creatorSession!.session.id)
    expect(phone).toMatchObject({
      deviceName: 'Chris iPhone',
      userAgent: 'TestPhone/1.0',
      ipAddress: '198.51.100.55',
      isCurrent: false,
    })

    const tokens = db.prepare('SELECT token FROM "session"').all() as Array<{ token: string }>
    expect(tokens).toHaveLength(2)
    const serialized = JSON.stringify(devices)
    for (const { token } of tokens) expect(serialized).not.toContain(token)
  })

  it('revokes one paired device without signing out the current one', async () => {
    const creatorHeaders = await signUp()
    const phoneHeaders = await pairPhone(creatorHeaders, 'Chris iPhone')
    const creatorSession = await auth.api.getSession({ headers: creatorHeaders })

    const { devices } = await listDevices(creatorHeaders)
    const phone = devices.find((device) => device.id !== creatorSession!.session.id)
    expect(phone).toBeDefined()

    const response = await auth.handler(deviceRequest(REVOKE_URL, 'POST', creatorHeaders, { id: phone!.id }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: true })
    expect(await auth.api.getSession({ headers: phoneHeaders })).toBeNull()
    const creatorAfter = await auth.api.getSession({ headers: creatorHeaders })
    expect(creatorAfter?.session.id).toBe(creatorSession!.session.id)
  })

  it('removes only the revoked device push subscriptions', async () => {
    const creatorHeaders = await signUp()
    const phoneHeaders = await pairPhone(creatorHeaders, 'Chris iPhone')
    const creatorSession = await auth.api.getSession({ headers: creatorHeaders })
    const phoneSession = await auth.api.getSession({ headers: phoneHeaders })
    expect(phoneSession).not.toBeNull()

    const insertSubscription = db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_name, session_id, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insertSubscription.run('default', 'https://push.example.com/phone', 'p', 'a', 'Chris iPhone', phoneSession!.session.id, 1, 1)
    insertSubscription.run('default', 'https://push.example.com/desktop', 'p', 'a', 'Desktop', creatorSession!.session.id, 1, 1)
    insertSubscription.run('default', 'https://push.example.com/legacy', 'p', 'a', 'Legacy', null, 1, 1)

    const response = await auth.handler(
      deviceRequest(REVOKE_URL, 'POST', creatorHeaders, { id: phoneSession!.session.id }),
    )

    expect(response.status).toBe(200)
    const endpoints = (db.prepare('SELECT endpoint FROM push_subscriptions ORDER BY endpoint').all() as Array<{ endpoint: string }>)
      .map((row) => row.endpoint)
    expect(endpoints).toEqual([
      'https://push.example.com/desktop',
      'https://push.example.com/legacy',
    ])
  })

  it('refuses to revoke the current session', async () => {
    const creatorHeaders = await signUp()
    const creatorSession = await auth.api.getSession({ headers: creatorHeaders })

    const response = await auth.handler(
      deviceRequest(REVOKE_URL, 'POST', creatorHeaders, { id: creatorSession!.session.id }),
    )

    expect(response.status).toBe(400)
    const body = await response.json() as { code?: string }
    expect(body.code).toBe(DEVICE_PAIRING_ERROR_CODES.CANNOT_REVOKE_CURRENT_SESSION)
    expect(await auth.api.getSession({ headers: creatorHeaders })).not.toBeNull()
  })

  it('reports unknown and foreign session ids as missing', async () => {
    const creatorHeaders = await signUp()
    const otherHeaders = await signUp('other@example.com', 'Other')
    const otherSession = await auth.api.getSession({ headers: otherHeaders })

    const unknown = await auth.handler(
      deviceRequest(REVOKE_URL, 'POST', creatorHeaders, { id: 'unknown-session' }),
    )
    expect(unknown.status).toBe(404)
    expect((await unknown.json() as { code?: string }).code).toBe(DEVICE_PAIRING_ERROR_CODES.DEVICE_NOT_FOUND)

    const foreign = await auth.handler(
      deviceRequest(REVOKE_URL, 'POST', creatorHeaders, { id: otherSession!.session.id }),
    )
    expect(foreign.status).toBe(404)
    expect((await foreign.json() as { code?: string }).code).toBe(DEVICE_PAIRING_ERROR_CODES.DEVICE_NOT_FOUND)

    expect(await auth.api.getSession({ headers: otherHeaders })).not.toBeNull()
  })

  it('requires a session for the device endpoints', async () => {
    const list = await auth.handler(deviceRequest(DEVICES_URL, 'GET'))
    expect(list.status).toBe(401)

    const revoke = await auth.handler(deviceRequest(REVOKE_URL, 'POST', undefined, { id: 'anything' }))
    expect(revoke.status).toBe(401)
  })

  it('lists only unexpired sessions as paired devices', async () => {
    const creatorHeaders = await signUp()
    const phoneHeaders = await pairPhone(creatorHeaders, 'Chris iPhone')
    const phoneSession = await auth.api.getSession({ headers: phoneHeaders })
    expect(phoneSession).not.toBeNull()

    db.prepare('UPDATE "session" SET expiresAt = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), phoneSession!.session.id)

    const { devices } = await listDevices(creatorHeaders)
    expect(devices.map((device) => device.id)).not.toContain(phoneSession!.session.id)

    const revoke = await auth.handler(
      deviceRequest(REVOKE_URL, 'POST', creatorHeaders, { id: phoneSession!.session.id }),
    )
    expect(revoke.status).toBe(404)
    expect((await revoke.json() as { code?: string }).code).toBe(DEVICE_PAIRING_ERROR_CODES.DEVICE_NOT_FOUND)
  })

  it('deletes only expired device pairing codes when minting', async () => {
    const headers = await signUp()
    const now = Date.now()
    const insertVerification = db.prepare(
      'INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    )
    const expiredAt = new Date(now - 1000).toISOString()
    insertVerification.run('expired-pairing', 'device-pairing:expired', 'user-1', expiredAt, expiredAt, expiredAt)
    insertVerification.run(
      'active-pairing',
      'device-pairing:active',
      'user-1',
      new Date(now + 60_000).toISOString(),
      expiredAt,
      expiredAt,
    )
    insertVerification.run('expired-other', 'email-verification:expired', 'user-1', expiredAt, expiredAt, expiredAt)

    const { code } = await auth.api.createDevicePairingCode({ headers })

    const identifiers = (db.prepare('SELECT identifier FROM verification').all() as Array<{ identifier: string }>)
      .map((row) => row.identifier)
      .sort()
    expect(identifiers).toEqual([
      'device-pairing:active',
      `device-pairing:${createHash('sha256').update(code).digest('base64url')}`,
      'email-verification:expired',
    ].sort())
  })

  it('does not override rate limiting for the redeem endpoint', () => {
    expect(devicePairing()).not.toHaveProperty('rateLimit')
  })
})
