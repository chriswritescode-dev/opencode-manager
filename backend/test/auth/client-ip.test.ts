import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { createAuth } from '../../src/auth'
import { AUTH_SOCKET_IP_HEADER, applyClientIpHeaders } from '../../src/auth/client-ip'
import { createAuthRoutes, type AuthRouteHandler } from '../../src/routes/auth'
import { selectRow } from '../../src/db/rows'
import { createTestDatabase } from '../helpers/test-database'

const SessionIpRowSchema = z.object({ ipAddress: z.string() })

function socketEnv(address: string | undefined) {
  return {
    incoming: {
      socket: {
        remoteAddress: address,
        remotePort: 54321,
        remoteFamily: address?.includes(':') ? 'IPv6' : 'IPv4',
      },
    },
  }
}

function signUpRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost:5003/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5003', ...headers },
    body: JSON.stringify({ email: 'spoof@example.com', password: 'test-password', name: 'Spoof' }),
  })
}

function createCapturingHandler() {
  const received: Request[] = []
  const handler = vi.fn<AuthRouteHandler['handler']>(async (request) => {
    received.push(request)
    return new Response('ok')
  })
  return { handler, received }
}

describe('auth client ip headers', () => {
  it('overrides a client-supplied socket header with the socket address', () => {
    const headers = new Headers({ [AUTH_SOCKET_IP_HEADER]: '6.6.6.6' })

    const result = applyClientIpHeaders(headers, '203.0.113.7')

    expect(result.get(AUTH_SOCKET_IP_HEADER)).toBe('203.0.113.7')
  })

  it('clears the socket header when the address cannot be resolved', () => {
    const headers = new Headers({ [AUTH_SOCKET_IP_HEADER]: '6.6.6.6' })

    const result = applyClientIpHeaders(headers, undefined)

    expect(result.get(AUTH_SOCKET_IP_HEADER)).toBeNull()
  })
})

describe('createAuthRoutes client ip forwarding', () => {
  it('sets the socket address on the auth request and ignores a spoofed socket header', async () => {
    const { received, handler } = createCapturingHandler()
    const app: Hono = createAuthRoutes({ handler })

    await app.fetch(
      new Request('http://localhost:5003/api/auth/get-session', {
        headers: { [AUTH_SOCKET_IP_HEADER]: '6.6.6.6', 'x-forwarded-for': '198.51.100.9' },
      }),
      socketEnv('203.0.113.7')
    )

    expect(received[0]?.headers.get(AUTH_SOCKET_IP_HEADER)).toBe('203.0.113.7')
  })

  it('omits the socket header when the connection info is unavailable', async () => {
    const { received, handler } = createCapturingHandler()
    const app: Hono = createAuthRoutes({ handler })

    await app.fetch(new Request('http://localhost:5003/api/auth/get-session', {
      headers: { [AUTH_SOCKET_IP_HEADER]: '6.6.6.6' },
    }))

    expect(received[0]?.headers.get(AUTH_SOCKET_IP_HEADER)).toBeNull()
  })
})

describe('createAuth client ip resolution', () => {
  it('records the socket address on a new session and ignores a spoofed forwarded header', async () => {
    const db = createTestDatabase()
    const app: Hono = createAuthRoutes(createAuth(db))

    try {
      const response = await app.fetch(
        signUpRequest({ 'x-forwarded-for': '198.51.100.9', [AUTH_SOCKET_IP_HEADER]: '6.6.6.6' }),
        socketEnv('203.0.113.7')
      )

      expect(response.status).toBe(200)
      const session = selectRow(db, SessionIpRowSchema, 'SELECT ipAddress FROM "session" LIMIT 1')
      expect(session?.ipAddress).toBe('203.0.113.7')
    } finally {
      db.close()
    }
  }, 30000)
})
