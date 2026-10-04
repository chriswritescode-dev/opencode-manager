import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { z, type ZodType } from 'zod'
import { ClientError } from '@opencode-manager/shared/opencode'
import { handleOpenCodeError, parseJsonBody } from '../../src/utils/route-helpers'

function createParseApp(schema: ZodType, options?: { allowEmpty?: boolean }) {
  const app = new Hono()
  app.post('/', async (c) => {
    const result = await parseJsonBody(c, schema, options)
    if (!result.ok) {
      return result.response
    }
    return c.json({ data: result.data })
  })
  return app
}

function createErrorApp(error: unknown, fallback: string, options?: { unknownStatus?: 500 | 502 }) {
  const app = new Hono()
  app.get('/', (c) => handleOpenCodeError(c, error, fallback, options))
  return app
}

describe('parseJsonBody', () => {
  const NameSchema = z.object({ name: z.string() })

  it('parses a valid JSON body', async () => {
    const response = await createParseApp(NameSchema).request('/', {
      method: 'POST',
      body: JSON.stringify({ name: 'ada' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: { name: 'ada' } })
  })

  it('rejects malformed JSON with an Invalid JSON body', async () => {
    const response = await createParseApp(NameSchema).request('/', {
      method: 'POST',
      body: '{not json',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON' })
  })

  it('treats an empty body as invalid JSON by default', async () => {
    const response = await createParseApp(NameSchema).request('/', { method: 'POST', body: '   ' })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON' })
  })

  it('parses an empty body as {} when allowEmpty is set', async () => {
    const OptionalSchema = z.object({ name: z.string().optional() })
    const response = await createParseApp(OptionalSchema, { allowEmpty: true }).request('/', {
      method: 'POST',
      body: '',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: {} })
  })

  it('returns schema issues when the body fails validation', async () => {
    const response = await createParseApp(NameSchema).request('/', {
      method: 'POST',
      body: JSON.stringify({ name: 42 }),
    })

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string; details: unknown[] }
    expect(body.error).toBe('Invalid request body')
    expect(Array.isArray(body.details)).toBe(true)
    expect(body.details.length).toBeGreaterThan(0)
  })
})

describe('handleOpenCodeError', () => {
  it('falls back to a 500 with the fallback message for unknown errors', async () => {
    const response = await createErrorApp(new Error('kaboom'), 'Request failed').request('/')

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Request failed' })
  })

  it('uses unknownStatus 502 and surfaces the error message', async () => {
    const response = await createErrorApp(new Error('kaboom'), 'Request failed', { unknownStatus: 502 }).request('/')

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'kaboom' })
  })

  it('falls back to the fallback message when a 502 error has no message', async () => {
    const response = await createErrorApp(new Error(''), 'Request failed', { unknownStatus: 502 }).request('/')

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Request failed' })
  })

  it('maps a tagged OpenCode not-found error to 404', async () => {
    const error = Object.assign(new Error('session gone'), { _tag: 'SessionNotFoundError' })
    const response = await createErrorApp(error, 'Request failed').request('/')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'session gone' })
  })

  it('maps a ClientError to a 502 with the ClientError code', async () => {
    const response = await createErrorApp(new ClientError('Transport'), 'Request failed').request('/')

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Request failed', code: 'ClientError' })
  })
})
