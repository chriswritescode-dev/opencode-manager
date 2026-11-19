import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import type { JsonValue } from '@opencode-manager/shared/utils'
import { createAuth, type AuthInstance } from '../../src/auth'
import { closeSessionConnections, registerSessionConnection } from '../../src/services/session-connections'
import { createTestDatabase } from '../helpers/test-database'
import { createAuthEnv } from '../helpers/auth-env'
import { readJson } from '../helpers/read-json'

const ORIGIN = 'http://localhost:5173'
const SIGN_UP_URL = `${ORIGIN}/api/auth/sign-up/email`
const SIGN_OUT_URL = `${ORIGIN}/api/auth/sign-out`
const REDEEM_URL = `${ORIGIN}/api/auth/device-pairing/redeem`
const DEVICES_URL = `${ORIGIN}/api/auth/device-pairing/devices`
const REVOKE_URL = `${ORIGIN}/api/auth/device-pairing/devices/revoke`

const DeviceListSchema = z.object({ devices: z.array(z.object({ id: z.string() })) })

function cookieHeaders(response: Response): Headers {
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0])
  return new Headers({ cookie: cookies.join('; ') })
}

function cookieHeaderFrom(headers: Headers, url: string, method: 'GET' | 'POST', body?: JsonValue): Request {
  const requestHeaders = new Headers({ origin: ORIGIN, 'content-type': 'application/json' })
  const cookie = headers.get('cookie')
  if (cookie) requestHeaders.set('cookie', cookie)

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
    db = createTestDatabase()
    auth = createAuth(db, createAuthEnv())
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
    return session?.session.id ?? ''
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
    const { devices } = await readJson(devicesResponse, DeviceListSchema)
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
    const signedInSessionId = await sessionId(headers)
    const close = vi.fn()
    registerSessionConnection(signedInSessionId, close)

    const response = await auth.handler(cookieHeaderFrom(headers, SIGN_OUT_URL, 'POST'))

    expect(response.status).toBe(200)
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })

  it('closes the connections of a session revoked through the auth api', async () => {
    const headers = await signUp()
    const session = await auth.api.getSession({ headers })
    const close = vi.fn()
    registerSessionConnection(session?.session.id ?? '', close)

    const response = await auth.api.revokeSession({
      headers,
      body: { token: session?.session.token ?? '' },
    })

    expect(response).toEqual({ status: true })
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })

  it('does not leave closed sessions registered', async () => {
    const headers = await signUp()
    const signedInSessionId = await sessionId(headers)
    const close = vi.fn()
    registerSessionConnection(signedInSessionId, close)

    await auth.handler(cookieHeaderFrom(headers, SIGN_OUT_URL, 'POST'))
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))

    closeSessionConnections(signedInSessionId)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
