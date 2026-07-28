import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createOAuthRoutes, classifyOAuthError } from './oauth'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'

function createTestApp(clientOverrides: Parameters<typeof createStubOpenCodeClient>[0] = {}): Hono {
  const app = new Hono()
  app.route('/oauth', createOAuthRoutes(createStubOpenCodeClient(clientOverrides)))
  return app
}

describe('classifyOAuthError', () => {
  it('returns the matched category for each known substring', () => {
    expect(classifyOAuthError('invalid code provided', 'callback')).toBe('invalid code')
    expect(classifyOAuthError('session has expired', 'authorize')).toBe('expired')
    expect(classifyOAuthError('User access denied', 'authorize')).toBe('access denied')
    expect(classifyOAuthError('upstream server error', 'callback')).toBe('server error')
    expect(classifyOAuthError('provider not found in registry', 'authorize')).toBe('provider not found')
    expect(classifyOAuthError('invalid method selected', 'authorize')).toBe('invalid method')
  })

  it('falls back to the phase-specific generic for unrecognized text', () => {
    expect(classifyOAuthError('something unexpected', 'authorize')).toBe('OAuth authorization failed')
    expect(classifyOAuthError('something unexpected', 'callback')).toBe('OAuth callback failed')
  })
})

describe('oauth routes /auth-methods', () => {
  it('wraps the upstream catalogue as { providers }', async () => {
    const upstream = { anthropic: [{ type: 'oauth', label: 'Anthropic OAuth' }] }
    const app = createTestApp({
      forward: vi.fn(async () => new Response(JSON.stringify(upstream), { status: 200 })),
    })
    const res = await app.request('/oauth/auth-methods')
    expect(res.status).toBe(200)
    const data = (await res.json()) as { providers: typeof upstream }
    expect(data.providers).toEqual(upstream)
  })

  it('returns 500 when upstream fails', async () => {
    const app = createTestApp({
      forward: vi.fn(async () => new Response('internal failure', { status: 500 })),
    })
    const res = await app.request('/oauth/auth-methods')
    expect(res.status).toBe(500)
  })
})

describe('oauth routes /:id/oauth/authorize', () => {
  const validBody = { method: 0 }

  it('forwards the validated body and returns the parsed response', async () => {
    const upstream = {
      url: 'https://auth.example.com',
      method: 'auto' as const,
      instructions: 'Open this page',
    }
    const forward = vi.fn(async () => new Response(JSON.stringify(upstream), { status: 200 }))
    const app = createTestApp({ forward })
    const res = await app.request('/oauth/openai/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(upstream)
    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/provider/openai/oauth/authorize',
      }),
    )
  })

  it('returns 400 on invalid body', async () => {
    const app = createTestApp()
    const res = await app.request('/oauth/openai/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('classifies known upstream error categories', async () => {
    const cases: Array<[string, string]> = [
      ['invalid code provided', 'invalid code'],
      ['session expired', 'expired'],
      ['access denied by user', 'access denied'],
      ['server error', 'server error'],
      ['provider not found', 'provider not found'],
      ['invalid method index', 'invalid method'],
    ]
    for (const [upstreamText, expected] of cases) {
      const app = createTestApp({
        forward: vi.fn(async () => new Response(upstreamText, { status: 500 })),
      })
      const res = await app.request('/oauth/openai/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      })
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe(expected)
    }
  })

  it('falls back to the generic authorize message for unknown upstream errors', async () => {
    const app = createTestApp({
      forward: vi.fn(async () => new Response('totally unexpected', { status: 500 })),
    })
    const res = await app.request('/oauth/openai/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('OAuth authorization failed')
  })
})

describe('oauth routes /:id/oauth/callback', () => {
  const validBody = { method: 0 }

  it('forwards the validated body and returns upstream data', async () => {
    const forward = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const app = createTestApp({ forward })
    const res = await app.request('/oauth/openai/oauth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/provider/openai/oauth/callback',
      }),
    )
  })

  it('returns 400 on invalid callback body', async () => {
    const app = createTestApp()
    const res = await app.request('/oauth/openai/oauth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    })
    expect(res.status).toBe(400)
  })

  it('classifies known upstream error categories on callback failures', async () => {
    const cases: Array<[string, string]> = [
      ['invalid code provided', 'invalid code'],
      ['token expired', 'expired'],
      ['access denied', 'access denied'],
      ['server error during exchange', 'server error'],
      ['provider not found', 'provider not found'],
      ['invalid method', 'invalid method'],
    ]
    for (const [upstreamText, expected] of cases) {
      const app = createTestApp({
        forward: vi.fn(async () => new Response(upstreamText, { status: 500 })),
      })
      const res = await app.request('/oauth/openai/oauth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      })
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe(expected)
    }
  })

  it('falls back to the generic callback message for unknown upstream errors', async () => {
    const app = createTestApp({
      forward: vi.fn(async () => new Response('unknown boom', { status: 500 })),
    })
    const res = await app.request('/oauth/openai/oauth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('OAuth callback failed')
  })
})
