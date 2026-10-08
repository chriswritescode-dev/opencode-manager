import { describe, it, expect, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { SettingsService } from '../../src/services/settings'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import type { UserPreferences } from '@opencode-manager/shared/types'
import { createInternalTestApp } from '../helpers/internal-test-app'

describe('internal/settings routes', () => {
  let db: Database
  let settingsService: SettingsService
  let app: Hono
  let token: string

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { settingsService }))
    token = getOrCreateInternalToken(db)
  })

  it('GET /api/internal/settings returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/settings')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/settings returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: unknown; updatedAt: number }
    expect(body).toHaveProperty('preferences')
    expect(body).toHaveProperty('updatedAt')
  })

  it('GET /api/internal/settings returns merged defaults', async () => {
    const res = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: { theme: string; mode: string } }
    expect(body.preferences.theme).toBe('dark')
    expect(body.preferences.mode).toBe('build')
  })

  it('GET /api/internal/settings returns manager colorTheme by default', async () => {
    const res = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: { colorTheme: string } }
    expect(body.preferences.colorTheme).toBe('manager')
  })

  it('GET /api/internal/settings recovers from a stored colorTheme removed from the catalog without losing other preferences', async () => {
    db.prepare(
      `INSERT INTO user_preferences (user_id, preferences, updated_at)
       VALUES (?, ?, ?)`
    ).run('default', JSON.stringify({ colorTheme: 'removed-theme', autoScroll: false }), Date.now())

    const res = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: { colorTheme: string; autoScroll: boolean } }
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

  it('PATCH /api/internal/settings with { theme: "dark" } persists and returns new settings', async () => {
    const patchRes = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'dark' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(patchRes.status).toBe(200)

    const getRes = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(getRes.status).toBe(200)
    const body = await getRes.json() as { preferences: { theme: string } }
    expect(body.preferences.theme).toBe('dark')
  })

  it('PATCH /api/internal/settings with { colorTheme: "dracula" } persists and returns new settings', async () => {
    const patchRes = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ colorTheme: 'dracula' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(patchRes.status).toBe(200)

    const getRes = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(getRes.status).toBe(200)
    const body = await getRes.json() as { preferences: { colorTheme: string } }
    expect(body.preferences.colorTheme).toBe('dracula')
  })

  it('PATCH /api/internal/settings with { gitCredentials: [...] } returns 400 (strict reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ gitCredentials: [{ name: 'test', token: 'secret' }] }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/internal/settings with { tts: { apiKey: "secret" } } returns 400 (strict reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ tts: { apiKey: 'secret' } }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/internal/settings with { sessionDefaults: { permissionMode: "auto" } } returns 400 (strict reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ sessionDefaults: { permissionMode: 'auto' } }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/internal/settings with { theme: "rainbow" } returns 400 (enum reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'rainbow' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/internal/settings with { colorTheme: "not-a-theme" } returns 400 (unknown theme reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ colorTheme: 'not-a-theme' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Invalid request body')
  })

  it('PATCH /api/internal/settings with { tts: { voice: "x", speed: 1.5 } } merges and preserves apiKey/endpoint', async () => {
    // Seed a full TTS config (including secrets) directly via settingsService
    settingsService.updateSettings({
      tts: {
        enabled: true,
        provider: 'external',
        autoPlay: false,
        endpoint: 'https://custom.endpoint',
        apiKey: 'sk-secret-123',
        voice: 'alloy',
        model: 'tts-1',
        speed: 1.0,
      },
    } as Partial<UserPreferences>)

    // Now patch only non-secret fields via the API
    const patchRes = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ tts: { voice: 'nova', speed: 1.5 } }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(patchRes.status).toBe(200)
    const body = await patchRes.json() as { preferences: { tts: { voice: string; speed: number; apiKey: string; endpoint: string } } }
    expect(body.preferences.tts.voice).toBe('nova')
    expect(body.preferences.tts.speed).toBe(1.5)
    expect(body.preferences.tts.apiKey).toBe('<redacted>')
    expect(settingsService.getSettings().preferences.tts?.apiKey).toBe('sk-secret-123')
    expect(body.preferences.tts.endpoint).toBe('https://custom.endpoint')
  })

  it('PATCH /api/internal/settings with { tts: { voice: "nova" } } preserves autoPlay and other omitted fields', async () => {
    // Seed TTS with autoPlay: true (a non-default value)
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
    } as Partial<UserPreferences>)

    // Patch only voice — autoPlay, provider, model, speed must remain as seeded
    const patchRes = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ tts: { voice: 'nova' } }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(patchRes.status).toBe(200)
    const body = await patchRes.json() as { preferences: { tts: { voice: string; autoPlay: boolean; speed: number; model: string } } }
    expect(body.preferences.tts.voice).toBe('nova')
    expect(body.preferences.tts.autoPlay).toBe(true)  // must NOT reset to default false
    expect(body.preferences.tts.speed).toBe(1.0)       // preserved
    expect(body.preferences.tts.model).toBe('tts-1')   // preserved
  })

  it('PATCH /api/internal/settings with { tts: { apiKey: "leak" } } returns 400 (strict reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ tts: { apiKey: 'leak' } }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/internal/settings with { tts: { endpoint: "http://x" } } returns 400 (strict reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ tts: { endpoint: 'http://x' } }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/internal/settings with { stt: { model: "whisper-1" } } preserves non-default language and omitted fields', async () => {
    // Seed full STT config with a non-default language
    settingsService.updateSettings({
      stt: {
        enabled: true,
        provider: 'builtin',
        endpoint: 'https://api.openai.com',
        apiKey: 'sk-secret-456',
        model: 'whisper-1',
        language: 'fr-FR',
      },
    } as Partial<UserPreferences>)

    // Patch only model — language, provider, enabled must remain as seeded
    const patchRes = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ stt: { model: 'whisper-2' } }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(patchRes.status).toBe(200)
    const body = await patchRes.json() as { preferences: { stt: { model: string; language: string; provider: string; enabled: boolean } } }
    expect(body.preferences.stt.model).toBe('whisper-2')
    expect(body.preferences.stt.language).toBe('fr-FR')  // must NOT reset to default 'en-US'
    expect(body.preferences.stt.provider).toBe('builtin') // preserved
    expect(body.preferences.stt.enabled).toBe(true)        // preserved
  })

  it('PATCH /api/internal/settings with { stt: { ... } } when no stt config exists returns 400', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ stt: { enabled: true, language: 'fr-FR' } }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('STT is not configured')
  })

  it('GET /api/internal/settings redacts stored credentials and keeps empty ones empty', async () => {
    settingsService.updateSettings({
      gitCredentials: [
        { name: 'GitHub', host: 'github.com', type: 'pat', token: 'ghp_secret', username: 'octo' },
        { name: 'Empty', host: 'example.com', type: 'pat', token: '' },
      ],
      stt: { enabled: true, provider: 'external', endpoint: 'https://stt', apiKey: 'sk-stt', model: 'whisper-1', language: 'en-US' },
      serverEnvVars: [{ key: 'API_TOKEN', value: 'shh' }],
      lastKnownGoodConfig: '{"provider":{"x":{"apiKey":"sk"}}}',
    } as Partial<UserPreferences>)

    const res = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: UserPreferences }
    expect(body.preferences.gitCredentials?.[0]).toMatchObject({ token: '<redacted>', username: 'octo', host: 'github.com' })
    expect(body.preferences.gitCredentials?.[1]?.token).toBe('')
    expect(body.preferences.stt?.apiKey).toBe('<redacted>')
    expect(body.preferences.stt?.endpoint).toBe('https://stt')
    expect(body.preferences.serverEnvVars).toEqual([{ key: 'API_TOKEN', value: '<redacted>' }])
    expect(body.preferences.lastKnownGoodConfig).toBe('<redacted>')
    expect(JSON.stringify(body)).not.toMatch(/ghp_secret|sk-stt|shh/)
  })

  it('PATCH /api/internal/settings with existing keys (theme) still works after tts/stt additions', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'light', mode: 'plan' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: { theme: string; mode: string } }
    expect(body.preferences.theme).toBe('light')
    expect(body.preferences.mode).toBe('plan')
  })
})
