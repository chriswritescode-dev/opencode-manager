import { Database } from 'bun:sqlite'
import { unlinkSync, existsSync } from 'fs'
import { getOpenCodeConfigFilePath } from '@opencode-manager/shared/config/env'
import { logger } from '../utils/logger'
import stripJsonComments from 'strip-json-comments'
import type { 
  UserPreferences, 
  SettingsResponse, 
  OpenCodeConfig,
  CreateOpenCodeConfigRequest,
  UpdateOpenCodeConfigRequest
} from '../types/settings'
import {
  UserPreferencesSchema,
  OpenCodeConfigSchema,
  DEFAULT_USER_PREFERENCES,
} from '../types/settings'

interface OpenCodeConfigWithRaw extends OpenCodeConfig {
  rawContent: string
}

interface OpenCodeConfigResponseWithRaw {
  configs: OpenCodeConfigWithRaw[]
  defaultConfig: OpenCodeConfigWithRaw | null
}

function parseJsonc(content: string): unknown {
  return JSON.parse(stripJsonComments(content))
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

  getOpenCodeConfigs(userId: string = 'default'): OpenCodeConfigResponseWithRaw {
    const rows = this.db
      .query('SELECT * FROM opencode_configs WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as Array<{
        id: number
        user_id: string
        config_name: string
        config_content: string
        is_default: boolean
        created_at: number
        updated_at: number
      }>

    const configs: OpenCodeConfigWithRaw[] = []
    let defaultConfig: OpenCodeConfigWithRaw | null = null

    for (const row of rows) {
      try {
        const rawContent = row.config_content
        const content = parseJsonc(rawContent)
        const validated = OpenCodeConfigSchema.parse(content)
        
        const config: OpenCodeConfigWithRaw = {
          id: row.id,
          name: row.config_name,
          content: validated,
          rawContent: rawContent,
          isDefault: Boolean(row.is_default),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }

        configs.push(config)
        
        if (config.isDefault) {
          defaultConfig = config
        }
      } catch (error) {
        logger.error(`Failed to parse config ${row.config_name}:`, error)
      }
    }

    return {
      configs,
      defaultConfig,
    }
  }

  createOpenCodeConfig(
    request: CreateOpenCodeConfigRequest,
    userId: string = 'default'
  ): OpenCodeConfigWithRaw {
    // Check for existing config with the same name
    const existing = this.getOpenCodeConfigByName(request.name, userId)
    if (existing) {
      throw new Error(`Config with name '${request.name}' already exists`)
    }

    const rawContent = typeof request.content === 'string' 
      ? request.content 
      : JSON.stringify(request.content, null, 2)
    
    const parsedContent = typeof request.content === 'string'
      ? parseJsonc(request.content)
      : request.content
    
    const contentValidated = OpenCodeConfigSchema.parse(parsedContent)
    const now = Date.now()

    const existingCount = this.db
      .query('SELECT COUNT(*) as count FROM opencode_configs WHERE user_id = ?')
      .get(userId) as { count: number }
    
    const shouldBeDefault = request.isDefault || existingCount.count === 0

    if (shouldBeDefault) {
      this.db
        .query('UPDATE opencode_configs SET is_default = FALSE WHERE user_id = ?')
        .run(userId)
    }

    const result = this.db
      .query(
        `INSERT INTO opencode_configs (user_id, config_name, config_content, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        request.name,
        rawContent,
        shouldBeDefault,
        now,
        now
      )

    const config: OpenCodeConfigWithRaw = {
      id: result.lastInsertRowid as number,
      name: request.name,
      content: contentValidated,
      rawContent: rawContent,
      isDefault: shouldBeDefault,
      createdAt: now,
      updatedAt: now,
    }

    logger.info(`Created OpenCode config '${config.name}' for user: ${userId}`)
    return config
  }

  updateOpenCodeConfig(
    configName: string,
    request: UpdateOpenCodeConfigRequest,
    userId: string = 'default'
  ): OpenCodeConfigWithRaw | null {
    const existing = this.db
      .query('SELECT * FROM opencode_configs WHERE user_id = ? AND config_name = ?')
      .get(userId, configName) as {
        id: number
        config_content: string
        is_default: boolean
        created_at: number
      } | undefined

    if (!existing) {
      return null
    }

    const rawContent = typeof request.content === 'string' 
      ? request.content 
      : JSON.stringify(request.content, null, 2)
    
    const parsedContent = typeof request.content === 'string'
      ? parseJsonc(request.content)
      : request.content

    const contentValidated = OpenCodeConfigSchema.parse(parsedContent)
    const now = Date.now()

    if (request.isDefault) {
      this.db
        .query('UPDATE opencode_configs SET is_default = FALSE WHERE user_id = ?')
        .run(userId)
    }

    this.db
      .query(
        `UPDATE opencode_configs 
         SET config_content = ?, is_default = ?, updated_at = ?
         WHERE user_id = ? AND config_name = ?`
      )
      .run(
        rawContent,
        request.isDefault !== undefined ? request.isDefault : existing.is_default,
        now,
        userId,
        configName
      )

    const config: OpenCodeConfigWithRaw = {
      id: existing.id,
      name: configName,
      content: contentValidated,
      rawContent: rawContent,
      isDefault: request.isDefault !== undefined ? request.isDefault : existing.is_default,
      createdAt: existing.created_at,
      updatedAt: now,
    }

    logger.info(`Updated OpenCode config '${configName}' for user: ${userId}`)
    return config
  }

  deleteOpenCodeConfig(configName: string, userId: string = 'default'): boolean {
    const result = this.db
      .query('DELETE FROM opencode_configs WHERE user_id = ? AND config_name = ?')
      .run(userId, configName)

    const deleted = result.changes > 0
    if (deleted) {
      logger.info(`Deleted OpenCode config '${configName}' for user: ${userId}`)
      this.ensureSingleConfigIsDefault(userId)
    }

    return deleted
  }

  setDefaultOpenCodeConfig(configName: string, userId: string = 'default'): OpenCodeConfigWithRaw | null {
    const existing = this.db
      .query('SELECT * FROM opencode_configs WHERE user_id = ? AND config_name = ?')
      .get(userId, configName) as {
        id: number
        config_content: string
        created_at: number
      } | undefined

    if (!existing) {
      return null
    }

    this.db
      .query('UPDATE opencode_configs SET is_default = FALSE WHERE user_id = ?')
      .run(userId)

    const now = Date.now()
    this.db
      .query(
        `UPDATE opencode_configs 
         SET is_default = TRUE, updated_at = ?
         WHERE user_id = ? AND config_name = ?`
      )
      .run(now, userId, configName)

    try {
      const rawContent = existing.config_content
      const content = parseJsonc(rawContent)
      const validated = OpenCodeConfigSchema.parse(content)

      const config: OpenCodeConfigWithRaw = {
        id: existing.id,
        name: configName,
        content: validated,
        rawContent: rawContent,
        isDefault: true,
        createdAt: existing.created_at,
        updatedAt: now,
      }

      logger.info(`Set '${configName}' as default OpenCode config for user: ${userId}`)
      return config
    } catch (error) {
      logger.error(`Failed to parse config ${configName}:`, error)
      return null
    }
  }

  getDefaultOpenCodeConfig(userId: string = 'default'): OpenCodeConfigWithRaw | null {
    const row = this.db
      .query('SELECT * FROM opencode_configs WHERE user_id = ? AND is_default = TRUE')
      .get(userId) as {
        id: number
        config_name: string
        config_content: string
        created_at: number
        updated_at: number
      } | undefined

    if (!row) {
      return null
    }

    try {
      const rawContent = row.config_content
      const content = parseJsonc(rawContent)
      const validated = OpenCodeConfigSchema.parse(content)

      return {
        id: row.id,
        name: row.config_name,
        content: validated,
        rawContent: rawContent,
        isDefault: true,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    } catch (error) {
      logger.error(`Failed to parse default config:`, error)
      return null
    }
  }

  getOpenCodeConfigByName(configName: string, userId: string = 'default'): OpenCodeConfigWithRaw | null {
    const row = this.db
      .query('SELECT * FROM opencode_configs WHERE user_id = ? AND config_name = ?')
      .get(userId, configName) as {
        id: number
        config_name: string
        config_content: string
        is_default: boolean
        created_at: number
        updated_at: number
      } | undefined

    if (!row) {
      return null
    }

    try {
      const rawContent = row.config_content
      const content = parseJsonc(rawContent)
      const validated = OpenCodeConfigSchema.parse(content)

      return {
        id: row.id,
        name: row.config_name,
        content: validated,
        rawContent: rawContent,
        isDefault: Boolean(row.is_default),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    } catch (error) {
      logger.error(`Failed to parse config ${configName}:`, error)
      return null
    }
  }

  getOpenCodeConfigContent(configName: string, userId: string = 'default'): string | null {
    const row = this.db
      .query('SELECT config_content FROM opencode_configs WHERE user_id = ? AND config_name = ?')
      .get(userId, configName) as { config_content: string } | undefined
    
    if (!row) {
      logger.error(`Config '${configName}' not found for user ${userId}`)
      return null
    }

    return row.config_content
  }

  ensureSingleConfigIsDefault(userId: string = 'default'): void {
    const hasDefault = this.db
      .query('SELECT COUNT(*) as count FROM opencode_configs WHERE user_id = ? AND is_default = TRUE')
      .get(userId) as { count: number }

    if (hasDefault.count === 0) {
      const firstConfig = this.db
        .query('SELECT config_name FROM opencode_configs WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
        .get(userId) as { config_name: string } | undefined

      if (firstConfig) {
        this.db
          .query('UPDATE opencode_configs SET is_default = TRUE WHERE user_id = ? AND config_name = ?')
          .run(userId, firstConfig.config_name)
        logger.info(`Auto-set '${firstConfig.config_name}' as default (only config)`)
      }
    }
  }

  saveLastKnownGoodConfig(userId: string = 'default'): void {
    const config = this.getDefaultOpenCodeConfig(userId)
    if (config) {
      SettingsService.lastKnownGoodConfigContent = config.rawContent
      this.persistLastKnownGoodConfig(userId)
      logger.info(`Saved last known good config: ${config.name}`)
    }
  }

  restoreToLastKnownGoodConfig(userId: string = 'default'): { configName: string; content: string } | null {
    if (!SettingsService.lastKnownGoodConfigContent) {
      logger.warn('No last known good config available for rollback')
      return null
    }

    const configs = this.getOpenCodeConfigs(userId)
    const defaultConfig = configs.defaultConfig

    if (!defaultConfig) {
      logger.error('Cannot rollback: no default config found')
      return null
    }

    logger.info(`Restoring to last known good config for: ${defaultConfig.name}`)
    return {
      configName: defaultConfig.name,
      content: SettingsService.lastKnownGoodConfigContent
    }
  }

  rollbackToLastKnownGoodHealth(userId: string = 'default'): string | null {
    const lastGood = this.restoreToLastKnownGoodConfig(userId)
    if (!lastGood) {
      return null
    }

    this.updateOpenCodeConfig(lastGood.configName, { content: lastGood.content }, userId)
    return lastGood.configName
  }

  deleteFilesystemConfig(): boolean {
    const configPath = getOpenCodeConfigFilePath()

    if (!existsSync(configPath)) {
      logger.warn('Config file does not exist:', configPath)
      return false
    }

    try {
      unlinkSync(configPath)
      logger.info('Deleted filesystem config to allow server startup:', configPath)
      return true
    } catch (error) {
      logger.error('Failed to delete config file:', error)
      return false
    }
  }
}
