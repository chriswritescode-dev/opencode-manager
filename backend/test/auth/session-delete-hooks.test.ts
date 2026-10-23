import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'bun:sqlite'
import { createAuth, type AuthInstance } from '../../src/auth'
import { closeSessionConnections, registerSessionConnection } from '../../src/services/session-connections'
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
const SIGN_OUT_URL = `${ORIGIN}/api/auth/sign-out`
const REDEEM_URL = `${ORIGIN}/api/auth/device-pairing/redeem`
const DEVICES_URL = `${ORIGIN}/api/auth/device-pairing/devices`
const REVOKE_URL = `${ORIGIN}/api/auth/device-pairing/devices/revoke`

function cookieHeaders(response: Response): Headers {
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0])
  return new Headers({ cookie: cookies.join('; ') })
}

function cookieHeaderFrom(headers: Headers, url: string, method: 'GET' | 'POST', body?: unknown): Request {
  const requestHeaders: Record<string, string> = {
    origin: ORIGIN,
    'content-type': 'application/json',
  }
  const cookie = headers.get('cookie')
  if (cookie) requestHeaders.cookie = cookie

  return new Request(url, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('session delete hooks', () => {
  let db: Database
  let auth: AuthInstance

  beforeEach(() => {
    db = createAuthDatabase()
    auth = createAuth(db)
  })

  afterEach(() => {
    db.close()
  })

  async function signUp(email = 'creator@example.com'): Promise<Headers> {
    const response = await auth.handler(new Request(SIGN_UP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password: 'test-password', name: 'Creator' }),
    }))
    expect(response.status).toBe(200)
    return cookieHeaders(response)
  }

  async function pairPhone(creatorHeaders: Headers, deviceName: string): Promise<Headers> {
    const { code } = await auth.api.createDevicePairingCode({ headers: creatorHeaders })
    const response = await auth.handler(new Request(REDEEM_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'user-agent': 'TestPhone/1.0' },
      body: JSON.stringify({ code, deviceName }),
    }))
    expect(response.status).toBe(200)
    return cookieHeaders(response)
  }

  async function sessionId(headers: Headers): Promise<string> {
    const session = await auth.api.getSession({ headers })
    expect(session).not.toBeNull()
    return session!.session.id
  }

  it('closes the connections of a device revoked through the pairing plugin', async () => {
    const creatorHeaders = await signUp()
    const phoneHeaders = await pairPhone(creatorHeaders, 'Chris iPhone')
    const phoneSessionId = await sessionId(phoneHeaders)
    const creatorSessionId = await sessionId(creatorHeaders)

    const phoneClose = vi.fn()
    const creatorClose = vi.fn()
    registerSessionConnection(phoneSessionId, phoneClose)
    registerSessionConnection(creatorSessionId, creatorClose)

    const devicesResponse = await auth.handler(cookieHeaderFrom(creatorHeaders, DEVICES_URL, 'GET'))
    const { devices } = await devicesResponse.json() as { devices: Array<{ id: string }> }
    expect(devices.map((device) => device.id)).toContain(phoneSessionId)

    const revokeResponse = await auth.handler(
      cookieHeaderFrom(creatorHeaders, REVOKE_URL, 'POST', { id: phoneSessionId }),
    )

    expect(revokeResponse.status).toBe(200)
    await vi.waitFor(() => expect(phoneClose).toHaveBeenCalledTimes(1))
    expect(creatorClose).not.toHaveBeenCalled()
  })

  it('closes the connections of the session that signs out', async () => {
    const headers = await signUp()
    const sessionId_ = await sessionId(headers)
    const close = vi.fn()
    registerSessionConnection(sessionId_, close)

    const response = await auth.handler(cookieHeaderFrom(headers, SIGN_OUT_URL, 'POST'))

    expect(response.status).toBe(200)
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })

  it('closes the connections of a session revoked through the auth api', async () => {
    const headers = await signUp()
    const session = await auth.api.getSession({ headers })
    expect(session).not.toBeNull()
    const close = vi.fn()
    registerSessionConnection(session!.session.id, close)

    const response = await auth.api.revokeSession({
      headers,
      body: { token: session!.session.token },
    })

    expect(response).toEqual({ status: true })
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })

  it('does not leave closed sessions registered', async () => {
    const headers = await signUp()
    const sessionId_ = await sessionId(headers)
    const close = vi.fn()
    registerSessionConnection(sessionId_, close)

    await auth.handler(cookieHeaderFrom(headers, SIGN_OUT_URL, 'POST'))
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))

    closeSessionConnections(sessionId_)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
