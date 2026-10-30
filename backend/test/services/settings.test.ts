import { describe, expect, it, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { DEFAULT_ACTIVITY_WINDOW_MINUTES } from '@opencode-manager/shared/schemas'
import { SettingsService } from '../../src/services/settings'
import { allMigrations } from '../../src/db/migrations'
import { migrate } from '../../src/db/migration-runner'

describe('SettingsService', () => {
  let db: Database
  let settingsService: SettingsService

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
  })

  it('recovers from a stored activityWindowMinutes outside the allowed options without losing other preferences', () => {
    db.prepare(
      `INSERT INTO user_preferences (user_id, preferences, updated_at)
       VALUES (?, ?, ?)`
    ).run('default', JSON.stringify({ activityWindowMinutes: 5, autoScroll: false }), Date.now())

    const settings = settingsService.getSettings()

    expect(settings.preferences.activityWindowMinutes).toBe(DEFAULT_ACTIVITY_WINDOW_MINUTES)
    expect(settings.preferences.autoScroll).toBe(false)
  })

  it('reads a stored git identity email that the request pattern rejects', () => {
    db.prepare(
      `INSERT INTO user_preferences (user_id, preferences, updated_at)
       VALUES (?, ?, ?)`
    ).run(
      'default',
      JSON.stringify({ mode: 'plan', gitIdentity: { name: 'Root', email: 'root@box' } }),
      Date.now()
    )

    const settings = settingsService.getSettings()

    expect(settings.preferences.mode).toBe('plan')
    expect(settings.preferences.gitIdentity).toEqual({ name: 'Root', email: 'root@box' })
  })

  it('keeps a stored git identity and other preferences when an unrelated field is updated', () => {
    db.prepare(
      `INSERT INTO user_preferences (user_id, preferences, updated_at)
       VALUES (?, ?, ?)`
    ).run(
      'default',
      JSON.stringify({ mode: 'plan', gitIdentity: { name: 'Root', email: 'root@box' } }),
      Date.now()
    )

    const settings = settingsService.updateSettings({ theme: 'light' })

    expect(settings.preferences.theme).toBe('light')
    expect(settings.preferences.mode).toBe('plan')
    expect(settings.preferences.gitIdentity).toEqual({ name: 'Root', email: 'root@box' })
  })

  it('keeps a stored legacy identity email that no current pattern accepts', () => {
    db.prepare(
      `INSERT INTO user_preferences (user_id, preferences, updated_at)
       VALUES (?, ?, ?)`
    ).run(
      'default',
      JSON.stringify({ mode: 'plan', gitIdentity: { name: 'Root', email: 'not an email' } }),
      Date.now()
    )

    const settings = settingsService.getSettings()
    const updated = settingsService.updateSettings({ autoScroll: false })

    expect(settings.preferences.mode).toBe('plan')
    expect(settings.preferences.gitIdentity).toEqual({ name: 'Root', email: 'not an email' })
    expect(updated.preferences.autoScroll).toBe(false)
    expect(updated.preferences.mode).toBe('plan')
    expect(updated.preferences.gitIdentity).toEqual({ name: 'Root', email: 'not an email' })
  })

  it('drops stored goal settings that are no longer part of the schema', () => {
    db.prepare(
      `INSERT INTO user_preferences (user_id, preferences, updated_at)
       VALUES (?, ?, ?)`
    ).run(
      'default',
      JSON.stringify({
        sessionDefaults: {
          permissionMode: 'ask',
          goalMaxContinuations: 20,
          goalTokenBudget: 1000,
          goalAuditorModel: 'x/y',
        },
      }),
      Date.now()
    )

    const settings = settingsService.getSettings()

    expect(settings.preferences.sessionDefaults).toEqual({ permissionMode: 'ask' })
  })
})
