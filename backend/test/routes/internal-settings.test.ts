import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import { SettingsResponseSchema } from '@opencode-manager/shared/schemas'
import type { UserPreferences } from '@opencode-manager/shared/types'
import type { JsonObject } from '@opencode-manager/shared/utils'
import { SettingsService } from '../../src/services/settings'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createTestDatabase } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'

const ErrorResponseSchema = z.object({ error: z.string() })

const persistenceCases: Array<Partial<UserPreferences>> = [
  { theme: 'dark' },
  { colorTheme: 'dracula' },
  { activityWindowMinutes: 60 },
  { walkthroughModel: 'openai/gpt-5-mini' },
  { theme: 'light', mode: 'plan' },
]

const rejectedPatches: JsonObject[] = [
  { gitCredentials: [{ name: 'test', token: 'secret' }] },
  { tts: { apiKey: 'secret' } },
  { tts: { apiKey: 'leak' } },
  { tts: { endpoint: 'http://x' } },
  { sessionDefaults: { permissionMode: 'auto' } },
  { theme: 'rainbow' },
  { colorTheme: 'not-a-theme' },
  { activityWindowMinutes: 45 },
]

describe('internal/settings routes', () => {
  let db: Database
  let settingsService: SettingsService
  let app: Hono
  let token: string

  async function authorizedRequest(init: { method?: string; body?: string } = {}): Promise<Response> {
    return app.request('/api/internal/settings', {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
  }

  beforeEach(() => {
    db = createTestDatabase()
    settingsService = new SettingsService(db)
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { settingsService }))
    token = getOrCreateInternalToken(db)
  })

  it('GET /api/internal/settings returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/settings')

    expect(res.status).toBe(401)
  })

  it('GET /api/internal/settings returns merged defaults', async () => {
    const res = await authorizedRequest()

    expect(res.status).toBe(200)
    const body = await readJson(res, SettingsResponseSchema)
    expect(body.preferences.theme).toBe('dark')
    expect(body.preferences.mode).toBe('build')
    expect(body.preferences.colorTheme).toBe('manager')
  })

  it('GET /api/internal/settings recovers from a stored colorTheme removed from the catalog without losing other preferences', async () => {
    db.prepare(
      `INSERT INTO user_preferences (user_id, preferences, updated_at)
       VALUES (?, ?, ?)`,
    ).run('default', JSON.stringify({ colorTheme: 'removed-theme', autoScroll: false }), Date.now())

    const res = await authorizedRequest()

    expect(res.status).toBe(200)
    const body = await readJson(res, SettingsResponseSchema)
    expect(body.preferences.colorTheme).toBe('manager')
    expect(body.preferences.autoScroll).toBe(false)
  })

  it('PATCH /api/internal/settings returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'dark' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(res.status).toBe(401)
  })

  it.each(persistenceCases)('PATCH /api/internal/settings persists %o', async (patch) => {
    const patchRes = await authorizedRequest({ method: 'PATCH', body: JSON.stringify(patch) })

    expect(patchRes.status).toBe(200)
    expect((await readJson(patchRes, SettingsResponseSchema)).preferences).toMatchObject(patch)

    const getRes = await authorizedRequest()

    expect(getRes.status).toBe(200)
    expect((await readJson(getRes, SettingsResponseSchema)).preferences).toMatchObject(patch)
    expect(settingsService.getSettings().preferences).toMatchObject(patch)
  })

  it.each(rejectedPatches)('PATCH /api/internal/settings rejects %o with 400', async (patch) => {
    const res = await authorizedRequest({ method: 'PATCH', body: JSON.stringify(patch) })

    expect(res.status).toBe(400)
    expect(await readJson(res, ErrorResponseSchema)).toEqual({ error: 'Invalid request body' })
  })

  it('PATCH /api/internal/settings merges TTS changes and keeps the stored credentials', async () => {
    settingsService.updateSettings({
      tts: {
        enabled: true,
        provider: 'external',
        autoPlay: true,
        endpoint: 'https://custom.endpoint',
        apiKey: 'sk-secret-123',
        voice: 'alloy',
        model: 'tts-1',
        speed: 1.0,
      },
    })

    const res = await authorizedRequest({ method: 'PATCH', body: JSON.stringify({ tts: { voice: 'nova', speed: 1.5 } }) })

    expect(res.status).toBe(200)
    const tts = (await readJson(res, SettingsResponseSchema)).preferences.tts
    expect(tts?.voice).toBe('nova')
    expect(tts?.speed).toBe(1.5)
    expect(tts?.autoPlay).toBe(true)
    expect(tts?.model).toBe('tts-1')
    expect(tts?.endpoint).toBe('https://custom.endpoint')
    expect(tts?.apiKey).toBe('<redacted>')
    expect(settingsService.getSettings().preferences.tts?.apiKey).toBe('sk-secret-123')
  })

  it('PATCH /api/internal/settings preserves non-default STT language and omitted fields', async () => {
    settingsService.updateSettings({
      stt: {
        enabled: true,
        provider: 'builtin',
        endpoint: 'https://api.openai.com',
        apiKey: 'sk-secret-456',
        model: 'whisper-1',
        language: 'fr-FR',
      },
    })

    const res = await authorizedRequest({ method: 'PATCH', body: JSON.stringify({ stt: { model: 'whisper-2' } }) })

    expect(res.status).toBe(200)
    const stt = (await readJson(res, SettingsResponseSchema)).preferences.stt
    expect(stt?.model).toBe('whisper-2')
    expect(stt?.language).toBe('fr-FR')
    expect(stt?.provider).toBe('builtin')
    expect(stt?.enabled).toBe(true)
  })

  it('PATCH /api/internal/settings rejects an STT patch when no STT config exists', async () => {
    const res = await authorizedRequest({ method: 'PATCH', body: JSON.stringify({ stt: { enabled: true, language: 'fr-FR' } }) })

    expect(res.status).toBe(400)
    expect((await readJson(res, ErrorResponseSchema)).error).toContain('STT is not configured')
  })

  it('GET /api/internal/settings redacts stored credentials and keeps empty ones empty', async () => {
    settingsService.updateSettings({
      gitCredentials: [
        { name: 'GitHub', host: 'github.com', type: 'pat', token: 'ghp_secret', username: 'octo' },
        { name: 'Empty', host: 'example.com', type: 'pat', token: '' },
      ],
      stt: {
        enabled: true,
        provider: 'external',
        endpoint: 'https://stt',
        apiKey: 'sk-stt',
        model: 'whisper-1',
        language: 'en-US',
      },
      serverEnvVars: [{ key: 'API_TOKEN', value: 'shh' }],
      lastKnownGoodConfig: '{"provider":{"x":{"apiKey":"sk"}}}',
    })

    const res = await authorizedRequest()

    expect(res.status).toBe(200)
    const body = await readJson(res, SettingsResponseSchema)
    expect(body.preferences.gitCredentials?.[0]).toMatchObject({
      token: '<redacted>',
      username: 'octo',
      host: 'github.com',
    })
    expect(body.preferences.gitCredentials?.[1]?.token).toBe('')
    expect(body.preferences.stt?.apiKey).toBe('<redacted>')
    expect(body.preferences.stt?.endpoint).toBe('https://stt')
    expect(body.preferences.serverEnvVars).toEqual([{ key: 'API_TOKEN', value: '<redacted>' }])
    expect(body.preferences.lastKnownGoodConfig).toBe('<redacted>')
    expect(JSON.stringify(body)).not.toMatch(/ghp_secret|sk-stt|shh/)
  })
})
