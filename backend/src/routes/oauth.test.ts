import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createOAuthRoutes, buildOAuthFailure } from './oauth'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import { PROVIDER_AUTH_ERROR_NAMES } from '../../../shared/src/schemas/auth'

function createTestApp(clientOverrides: Parameters<typeof createStubOpenCodeClient>[0] = {}): Hono {
  const app = new Hono()
  app.route('/oauth', createOAuthRoutes(createStubOpenCodeClient(clientOverrides)))
  return app
}

function upstreamFailure(body: unknown, status = 400): Parameters<typeof createStubOpenCodeClient>[0] {
  return {
    forward: vi.fn(async () => new Response(JSON.stringify(body), { status })),
  }
}

describe('buildOAuthFailure against captured opencode 1.18.7 responses', () => {
  it('classifies a real ProviderAuthOauthMissing callback response', () => {
    const failure = buildOAuthFailure(
      '{"name":"ProviderAuthOauthMissing","data":{"providerID":"openai"}}',
      400,
      'callback',
    )
    expect(failure.status).toBe(400)
    expect(failure.payload).toEqual({
      error: 'OAuth callback failed',
      code: 'ProviderAuthOauthMissing',
    })
  })

  it('flattens the multiline message a real BadRequest payload carries', () => {
    const failure = buildOAuthFailure(
      '{"name":"BadRequest","data":{"message":"Missing key\\n  at [\\"method\\"]","kind":"Payload"}}',
      400,
      'callback',
    )
    expect(failure.payload.code).toBe('BadRequest')
    expect(failure.payload.detail).toBe('Missing key at ["method"]')
  })

  it('falls back without a code for a real UnknownError defect response', () => {
    const failure = buildOAuthFailure(
      '{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_00568566"}}',
      500,
      'authorize',
    )
    expect(failure.status).toBe(500)
    expect(failure.payload).toEqual({ error: 'OAuth authorization failed' })
  })
})

describe('buildOAuthFailure', () => {
  it('forwards every upstream ProviderAuthError name as the code', () => {
    for (const name of PROVIDER_AUTH_ERROR_NAMES) {
      const failure = buildOAuthFailure(JSON.stringify({ name, data: {} }), 400, 'authorize')
      expect(failure.payload.code).toBe(name)
      expect(failure.status).toBe(400)
    }
  })

  it('forwards the tagged InvalidRequestError shape', () => {
    const failure = buildOAuthFailure(
      JSON.stringify({ _tag: 'InvalidRequestError', message: 'method out of range' }),
      400,
      'authorize',
    )
    expect(failure.payload.code).toBe('InvalidRequestError')
    expect(failure.payload.detail).toBe('method out of range')
  })

  it('surfaces upstream message and field as detail for validation failures', () => {
    const failure = buildOAuthFailure(
      JSON.stringify({
        name: 'ProviderAuthValidationFailed',
        data: { field: 'apiKey', message: 'must start with sk-' },
      }),
      400,
      'authorize',
    )
    expect(failure.payload.code).toBe('ProviderAuthValidationFailed')
    expect(failure.payload.detail).toBe('must start with sk- — field: apiKey')
  })

  it('omits detail when upstream carries no message or field', () => {
    const failure = buildOAuthFailure(
      JSON.stringify({ name: 'ProviderAuthOauthCallbackFailed', data: {} }),
      400,
      'callback',
    )
    expect(failure.payload.detail).toBeUndefined()
    expect(failure.payload.error).toBe('OAuth callback failed')
  })

  it('falls back to the phase generic without a code for non-JSON bodies', () => {
    const failure = buildOAuthFailure('upstream exploded', 500, 'authorize')
    expect(failure.payload).toEqual({ error: 'OAuth authorization failed' })
    expect(failure.status).toBe(500)
  })

  it('falls back to the phase generic for JSON that is not the upstream contract', () => {
    const failure = buildOAuthFailure(JSON.stringify({ name: 'SomethingElse' }), 400, 'callback')
    expect(failure.payload).toEqual({ error: 'OAuth callback failed' })
  })

  it('replaces out-of-range upstream statuses with 502', () => {
    expect(buildOAuthFailure('boom', 200, 'authorize').status).toBe(502)
    expect(buildOAuthFailure('boom', 0, 'authorize').status).toBe(502)
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

  function authorizeRequest(app: Hono, body: unknown = validBody) {
    return app.request('/oauth/openai/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('forwards the validated body and returns the parsed response', async () => {
    const upstream = {
      url: 'https://auth.example.com',
      method: 'auto' as const,
      instructions: 'Open this page',
    }
    const forward = vi.fn(async () => new Response(JSON.stringify(upstream), { status: 200 }))
    const app = createTestApp({ forward })
    const res = await authorizeRequest(app)
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
    const res = await authorizeRequest(createTestApp(), {})
    expect(res.status).toBe(400)
  })

  it('forwards the upstream error code and 400 status', async () => {
    const app = createTestApp(
      upstreamFailure({ name: 'ProviderAuthOauthMissing', data: { providerID: 'openai' } }),
    )
    const res = await authorizeRequest(app)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'OAuth authorization failed',
      code: 'ProviderAuthOauthMissing',
    })
  })

  it('falls back to the generic authorize message for unrecognized upstream errors', async () => {
    const app = createTestApp(upstreamFailure('totally unexpected', 500))
    const res = await authorizeRequest(app)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'OAuth authorization failed' })
  })
})

describe('oauth routes /:id/oauth/callback', () => {
  const validBody = { method: 0 }

  function callbackRequest(app: Hono, body: unknown = validBody) {
    return app.request('/oauth/openai/oauth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('forwards the validated body and returns upstream data', async () => {
    const forward = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const app = createTestApp({ forward })
    const res = await callbackRequest(app)
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
    const res = await callbackRequest(createTestApp(), { foo: 'bar' })
    expect(res.status).toBe(400)
  })

  it('forwards the upstream code and validation detail', async () => {
    const app = createTestApp(
      upstreamFailure({
        name: 'ProviderAuthValidationFailed',
        data: { field: 'code', message: 'code is not valid' },
      }),
    )
    const res = await callbackRequest(app)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'OAuth callback failed',
      code: 'ProviderAuthValidationFailed',
      detail: 'code is not valid — field: code',
    })
  })

  it('falls back to the generic callback message for unrecognized upstream errors', async () => {
    const app = createTestApp(upstreamFailure('unknown boom', 500))
    const res = await callbackRequest(app)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'OAuth callback failed' })
  })
})
