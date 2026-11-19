import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import { ENV } from '@opencode-manager/shared/config/env'
import { RemoteAccessHeaderListSchema, RemoteAccessHeadersResponseSchema } from '@opencode-manager/shared/schemas'
import { z } from 'zod'
import { createTestDb } from '../helpers/assistant-workspace'
import { expectNoSecretsLogged } from '../helpers/log-assertions'
import { readJson } from '../helpers/read-json'
import {
  CLOUDFLARE_CLIENT_ID,
  CLOUDFLARE_CLIENT_SECRET,
  CLOUDFLARE_HEADERS,
  CLOUDFLARE_SECRET_VALUES,
} from '../helpers/remote-access-headers'
import { decryptSecret } from '../../src/utils/crypto'
import { selectRow } from '../../src/db/rows'
import { RemoteAccessHeadersService, REMOTE_ACCESS_HEADERS_SECRET_KEY } from '../../src/services/remote-access-headers'
import { createRemoteAccessHeaderRoutes } from '../../src/routes/remote-access-headers'

const REPLACEMENT_SECRET_VALUE = 'replacement-secret-77aa13c5'

const SECRET_VALUES = [...CLOUDFLARE_SECRET_VALUES, REPLACEMENT_SECRET_VALUE]

const ErrorResponseSchema = z.object({ error: z.string() })
const SecretValueSchema = z.object({ value: z.string() })

const authEnv: { SECRET: string } = ENV.AUTH
const originalSecret = ENV.AUTH.SECRET

function buildHeaders(count: number) {
  return Array.from({ length: count }, (_, index) => ({ name: `X-Remote-Header-${index}`, value: `value-${index}` }))
}

describe('remote access header routes', () => {
  let db: Database
  let service: RemoteAccessHeadersService
  let app: Hono

  beforeEach(() => {
    db = createTestDb()
    service = new RemoteAccessHeadersService(db)
    app = new Hono()
    app.route('/remote-access-headers', createRemoteAccessHeaderRoutes(service))
  })

  afterEach(() => {
    authEnv.SECRET = originalSecret
  })

  const readSummary = () => app.request('/remote-access-headers')

  const putHeaders = (headers: Array<{ name: string; value?: string }>) =>
    app.request('/remote-access-headers', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ headers }),
    })

  it('reads an empty configuration', async () => {
    const res = await readSummary()

    expect(res.status).toBe(200)
    await expect(readJson(res, RemoteAccessHeadersResponseSchema)).resolves.toEqual({ headers: [], unreadable: false })
  })

  it('stores headers without exposing their values', async () => {
    const res = await putHeaders(CLOUDFLARE_HEADERS)

    expect(res.status).toBe(200)
    const body = await res.text()
    expect(RemoteAccessHeadersResponseSchema.parse(JSON.parse(body))).toEqual({
      headers: [
        { name: 'CF-Access-Client-Id', hasValue: true },
        { name: 'CF-Access-Client-Secret', hasValue: true },
      ],
      unreadable: false,
    })
    expect(body).not.toContain(CLOUDFLARE_CLIENT_ID)
    expect(body).not.toContain(CLOUDFLARE_CLIENT_SECRET)

    const readBody = await (await readSummary()).text()
    expect(readBody).not.toContain(CLOUDFLARE_CLIENT_ID)
    expect(readBody).not.toContain(CLOUDFLARE_CLIENT_SECRET)
  })

  it('stores header values encrypted at rest', async () => {
    await putHeaders(CLOUDFLARE_HEADERS)

    const row = selectRow(db, SecretValueSchema, 'SELECT value FROM app_secrets WHERE key = ?', REMOTE_ACCESS_HEADERS_SECRET_KEY)

    expect(row).not.toBeNull()
    const encrypted = row?.value ?? ''
    expect(encrypted).not.toContain(CLOUDFLARE_CLIENT_ID)
    expect(encrypted).not.toContain(CLOUDFLARE_CLIENT_SECRET)
    expect(RemoteAccessHeaderListSchema.parse(JSON.parse(decryptSecret(encrypted)))).toEqual(CLOUDFLARE_HEADERS)
  })

  it('keeps a stored value when the replacement value is blank', async () => {
    await putHeaders(CLOUDFLARE_HEADERS)

    const res = await putHeaders([{ name: 'CF-Access-Client-Secret', value: '' }])

    expect(res.status).toBe(200)
    expect(service.read()).toEqual({
      headers: [{ name: 'CF-Access-Client-Secret', value: CLOUDFLARE_CLIENT_SECRET }],
      unreadable: false,
    })
  })

  it('uses a supplied value over the stored one', async () => {
    await putHeaders(CLOUDFLARE_HEADERS)

    const res = await putHeaders([{ name: 'CF-Access-Client-Secret', value: REPLACEMENT_SECRET_VALUE }])

    expect(res.status).toBe(200)
    expect(service.read().headers).toEqual([
      { name: 'CF-Access-Client-Secret', value: REPLACEMENT_SECRET_VALUE },
    ])
  })

  it('rejects a blank value for a header that has no stored value', async () => {
    const res = await putHeaders([{ name: 'CF-Access-Client-Id', value: '' }])

    expect(res.status).toBe(400)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({
      error: 'A value is required for CF-Access-Client-Id',
    })
  })

  it.each([
    ['a reserved header name', [{ name: 'Cookie', value: 'session=1' }]],
    ['more than eight headers', buildHeaders(9)],
    [
      'duplicate header names after merging',
      [
        { name: 'CF-Access-Client-Id', value: 'first' },
        { name: 'cf-access-client-id', value: 'second' },
      ],
    ],
    ['a value with a line break after merging', [{ name: 'X-Remote-Header', value: 'line\r\nbreak' }]],
  ])('rejects %s', async (_label, headers) => {
    const res = await putHeaders(headers)

    expect(res.status).toBe(400)
    expect(service.read().headers).toEqual([])
  })

  it('clears stored headers with an empty replacement', async () => {
    await putHeaders(CLOUDFLARE_HEADERS)

    const res = await putHeaders([])

    expect(res.status).toBe(200)
    await expect(readJson(res, RemoteAccessHeadersResponseSchema)).resolves.toEqual({ headers: [], unreadable: false })
    await expect(readJson(await readSummary(), RemoteAccessHeadersResponseSchema)).resolves.toEqual({
      headers: [],
      unreadable: false,
    })
  })

  it('clears stored headers on delete', async () => {
    await putHeaders(CLOUDFLARE_HEADERS)

    const res = await app.request('/remote-access-headers', { method: 'DELETE' })

    expect(res.status).toBe(200)
    await expect(readJson(res, RemoteAccessHeadersResponseSchema)).resolves.toEqual({ headers: [], unreadable: false })
    await expect(readJson(await readSummary(), RemoteAccessHeadersResponseSchema)).resolves.toEqual({
      headers: [],
      unreadable: false,
    })
  })

  it('reports headers that cannot be decrypted as unreadable and unset', async () => {
    await putHeaders(CLOUDFLARE_HEADERS)
    authEnv.SECRET = 'a-different-auth-secret'

    await expect(readJson(await readSummary(), RemoteAccessHeadersResponseSchema)).resolves.toEqual({
      headers: [],
      unreadable: true,
    })
    expect(service.read()).toEqual({ headers: [], unreadable: true })
  })

  it('recovers the stored headers when the original secret returns', async () => {
    await putHeaders(CLOUDFLARE_HEADERS)
    authEnv.SECRET = 'a-different-auth-secret'
    await readSummary()
    authEnv.SECRET = originalSecret

    expect(service.read().headers).toEqual(CLOUDFLARE_HEADERS)
  })

  describe('logging', () => {
    afterEach(() => {
      expectNoSecretsLogged(SECRET_VALUES)
    })

    it('logs a write without values', async () => {
      await putHeaders(CLOUDFLARE_HEADERS)
      await putHeaders([{ name: 'CF-Access-Client-Secret', value: REPLACEMENT_SECRET_VALUE }])
      await app.request('/remote-access-headers', { method: 'DELETE' })
    })

    it('logs an unreadable store without values', async () => {
      await putHeaders(CLOUDFLARE_HEADERS)
      authEnv.SECRET = 'a-different-auth-secret'
      await readSummary()
    })
  })
})
