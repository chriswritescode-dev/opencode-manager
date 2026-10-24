import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import { ENV } from '@opencode-manager/shared/config/env'

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../../src/utils/logger', () => ({ logger: loggerMocks }))

import { createTestDb } from '../helpers/assistant-workspace'
import { expectNoSecretsLogged } from '../helpers/log-assertions'
import {
  CLOUDFLARE_CLIENT_ID,
  CLOUDFLARE_CLIENT_SECRET,
  CLOUDFLARE_HEADERS,
  CLOUDFLARE_SECRET_VALUES,
} from '../helpers/remote-access-headers'
import { decryptSecret } from '../../src/utils/crypto'
import { RemoteAccessHeadersService, REMOTE_ACCESS_HEADERS_SECRET_KEY } from '../../src/services/remote-access-headers'
import { createRemoteAccessHeaderRoutes } from '../../src/routes/remote-access-headers'

const REPLACEMENT_SECRET_VALUE = 'replacement-secret-77aa13c5'

const SECRET_VALUES = [...CLOUDFLARE_SECRET_VALUES, REPLACEMENT_SECRET_VALUE]

const mutableAuth = ENV.AUTH as unknown as { SECRET: string }
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
    mutableAuth.SECRET = originalSecret
    vi.clearAllMocks()
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
    await expect(res.json()).resolves.toEqual({ headers: [], unreadable: false })
  })

  it('stores headers without exposing their values', async () => {
    const res = await putHeaders(CLOUDFLARE_HEADERS)

    expect(res.status).toBe(200)
    const body = await res.text()
    expect(JSON.parse(body)).toEqual({
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

    const row = db
      .prepare('SELECT value FROM app_secrets WHERE key = ?')
      .get(REMOTE_ACCESS_HEADERS_SECRET_KEY) as { value: string } | undefined

    expect(row).toBeDefined()
    const encrypted = row?.value ?? ''
    expect(encrypted).not.toContain(CLOUDFLARE_CLIENT_ID)
    expect(encrypted).not.toContain(CLOUDFLARE_CLIENT_SECRET)
    expect(JSON.parse(decryptSecret(encrypted))).toEqual(CLOUDFLARE_HEADERS)
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
    await expect(res.json()).resolves.toMatchObject({ error: 'A value is required for CF-Access-Client-Id' })
  })

  it('rejects a reserved header name', async () => {
    const res = await putHeaders([{ name: 'Cookie', value: 'session=1' }])

    expect(res.status).toBe(400)
    expect(service.read().headers).toEqual([])
  })

  it('rejects more than eight headers', async () => {
    const res = await putHeaders(buildHeaders(9))

    expect(res.status).toBe(400)
    expect(service.read().headers).toEqual([])
  })

  it('rejects duplicate header names after merging', async () => {
    const res = await putHeaders([
      { name: 'CF-Access-Client-Id', value: 'first' },
      { name: 'cf-access-client-id', value: 'second' },
    ])

    expect(res.status).toBe(400)
    expect(service.read().headers).toEqual([])
  })

  it('rejects a value with a line break after merging', async () => {
    const res = await putHeaders([{ name: 'X-Remote-Header', value: 'line\r\nbreak' }])

    expect(res.status).toBe(400)
    expect(service.read().headers).toEqual([])
  })

  it('clears stored headers with an empty replacement', async () => {
    await putHeaders(CLOUDFLARE_HEADERS)

    const res = await putHeaders([])

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ headers: [], unreadable: false })
    await expect((await readSummary()).json()).resolves.toEqual({ headers: [], unreadable: false })
  })

  it('clears stored headers on delete', async () => {
    await putHeaders(CLOUDFLARE_HEADERS)

    const res = await app.request('/remote-access-headers', { method: 'DELETE' })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ headers: [], unreadable: false })
    await expect((await readSummary()).json()).resolves.toEqual({ headers: [], unreadable: false })
  })

  it('reports headers that cannot be decrypted as unreadable and unset', async () => {
    await putHeaders(CLOUDFLARE_HEADERS)
    mutableAuth.SECRET = 'a-different-auth-secret'

    await expect((await readSummary()).json()).resolves.toEqual({ headers: [], unreadable: true })
    expect(service.read()).toEqual({ headers: [], unreadable: true })
  })

  it('recovers the stored headers when the original secret returns', async () => {
    await putHeaders(CLOUDFLARE_HEADERS)
    mutableAuth.SECRET = 'a-different-auth-secret'
    await readSummary()
    mutableAuth.SECRET = originalSecret

    expect(service.read().headers).toEqual(CLOUDFLARE_HEADERS)
  })

  describe('logging', () => {
    afterEach(() => {
      expectNoSecretsLogged(loggerMocks, SECRET_VALUES)
    })

    it('logs a write without values', async () => {
      await putHeaders(CLOUDFLARE_HEADERS)
      await putHeaders([{ name: 'CF-Access-Client-Secret', value: REPLACEMENT_SECRET_VALUE }])
      await app.request('/remote-access-headers', { method: 'DELETE' })
    })

    it('logs an unreadable store without values', async () => {
      await putHeaders(CLOUDFLARE_HEADERS)
      mutableAuth.SECRET = 'a-different-auth-secret'
      await readSummary()
    })
  })
})
