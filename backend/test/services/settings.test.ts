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
})
