import { describe, it, expect, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { createInternalRoutes } from '../../src/routes/internal'
import { ScheduleService } from '../../src/services/schedules'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import type { UserPreferences } from '@opencode-manager/shared/types'

describe('internal/settings routes', () => {
  let db: Database
  let scheduleService: ScheduleService
  let notificationService: NotificationService
  let settingsService: SettingsService
  let app: Hono
  let token: string

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    const openCodeClient = createOpenCodeClient()
    scheduleService = new ScheduleService(db, openCodeClient)
    notificationService = new NotificationService(db)
    settingsService = new SettingsService(db)
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService, openCodeClient))
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
    expect(body.preferences.tts.apiKey).toBe('sk-secret-123')
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
