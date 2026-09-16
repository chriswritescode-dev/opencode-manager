import { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'
import { parseJsonc } from '@opencode-manager/shared/utils'
import { encryptSecret, decryptSecret } from '../utils/crypto'
import { ENV } from '@opencode-manager/shared/config/env'
import type {
  UserPreferences,
  SettingsResponse,
} from '../types/settings'
import {
  UserPreferencesSchema,
  DEFAULT_USER_PREFERENCES,
} from '../types/settings'

interface OpenCodeServerPasswordState {
  value: string
  createdAt: number
  updatedAt: number
}


export class SettingsService {
  private static lastKnownGoodConfigContent: string | null = null

  constructor(private db: Database) {}

  initializeLastKnownGoodConfig(userId: string = 'default'): void {
    const settings = this.getSettings(userId)
    if (settings.preferences.lastKnownGoodConfig) {
      SettingsService.lastKnownGoodConfigContent = settings.preferences.lastKnownGoodConfig
      logger.info('Initialized last known good config from database')
    }
  }

  persistLastKnownGoodConfig(userId: string = 'default'): void {
    if (SettingsService.lastKnownGoodConfigContent) {
      this.updateSettings({ lastKnownGoodConfig: SettingsService.lastKnownGoodConfigContent }, userId)
      logger.info('Persisted last known good config to database')
    }
  }

  getLastKnownGoodConfig(): string | null {
    return SettingsService.lastKnownGoodConfigContent
  }

  getSettings(userId: string = 'default'): SettingsResponse {
    const row = this.db
      .query('SELECT preferences, updated_at FROM user_preferences WHERE user_id = ?')
      .get(userId) as { preferences: string; updated_at: number } | undefined

    if (!row) {
      return {
        preferences: DEFAULT_USER_PREFERENCES,
        updatedAt: Date.now(),
      }
    }

    try {
      const parsed = parseJsonc(row.preferences) as Record<string, unknown>
      
      const validated = UserPreferencesSchema.parse({
        ...DEFAULT_USER_PREFERENCES,
        ...parsed,
      })

      return {
        preferences: validated,
        updatedAt: row.updated_at,
      }
    } catch (error) {
      logger.error('Failed to parse user preferences, returning defaults', error)
      return {
        preferences: DEFAULT_USER_PREFERENCES,
        updatedAt: row.updated_at,
      }
    }
  }

  updateSettings(
    updates: Partial<UserPreferences>,
    userId: string = 'default'
  ): SettingsResponse {
    const current = this.getSettings(userId)
    const merged: UserPreferences = {
      ...current.preferences,
      ...updates,
    }

    const validated = UserPreferencesSchema.parse(merged)
    const updatedAt = Date.now()

    this.db
      .query(
        `INSERT INTO user_preferences (user_id, preferences, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           preferences = excluded.preferences,
           updated_at = excluded.updated_at`
      )
      .run(userId, JSON.stringify(validated), updatedAt)

    logger.info(`Updated preferences for user: ${userId}`)

    return {
      preferences: validated,
      updatedAt,
    }
  }

  resetSettings(userId: string = 'default'): SettingsResponse {
    this.db.query('DELETE FROM user_preferences WHERE user_id = ?').run(userId)

    logger.info(`Reset preferences for user: ${userId}`)

    return {
      preferences: DEFAULT_USER_PREFERENCES,
      updatedAt: Date.now(),
    }
  }

  saveLastKnownGoodConfig(rawContent: string, userId: string = 'default'): void {
    SettingsService.lastKnownGoodConfigContent = rawContent
    this.persistLastKnownGoodConfig(userId)
    logger.info('Saved last known good config')
  }

  getOpenCodeServerPassword(): string {
    const row = this.db.prepare('SELECT value FROM app_secrets WHERE key = ?').get('opencode_server_password') as { value: string } | undefined
    if (!row) {
      return ENV.OPENCODE.SERVER_PASSWORD
    }
    try {
      return decryptSecret(row.value)
    } catch (error) {
      logger.error('Failed to decrypt opencode_server_password, falling back to env', error)
      return ENV.OPENCODE.SERVER_PASSWORD
    }
  }

  hasStoredOpenCodeServerPassword(): boolean {
    const row = this.db.prepare('SELECT 1 FROM app_secrets WHERE key = ?').get('opencode_server_password')
    return Boolean(row)
  }

  getStoredOpenCodeServerPasswordState(): OpenCodeServerPasswordState | null {
    const row = this.db.prepare('SELECT value, created_at, updated_at FROM app_secrets WHERE key = ?').get('opencode_server_password') as { value: string; created_at: number; updated_at: number } | undefined
    if (!row) {
      return null
    }

    return {
      value: row.value,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  restoreOpenCodeServerPasswordState(state: OpenCodeServerPasswordState | null): void {
    if (!state) {
      this.clearOpenCodeServerPassword()
      return
    }

    this.db.prepare(`
      INSERT INTO app_secrets (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at, updated_at = excluded.updated_at
    `).run('opencode_server_password', state.value, state.createdAt, state.updatedAt)
  }

  setOpenCodeServerPassword(password: string): void {
    const now = Date.now()
    const encrypted = encryptSecret(password)
    this.db.prepare(`
      INSERT INTO app_secrets (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run('opencode_server_password', encrypted, now, now)
  }

  clearOpenCodeServerPassword(): void {
    this.db.prepare('DELETE FROM app_secrets WHERE key = ?').run('opencode_server_password')
  }
}
