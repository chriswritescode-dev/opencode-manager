import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { getOpenCodeConfigFilePath, getOpenCodeConfigHome, OPENCODE_CONFIG_FILENAMES } from '@opencode-manager/shared/config/env'
import type { Migration } from '../migration-runner'
import { logger } from '../../utils/logger'

function firstExistingConfigSourcePath(): string | null {
  const candidates = [
    process.env.OPENCODE_IMPORT_CONFIG_PATH,
    ...OPENCODE_CONFIG_FILENAMES.map(name => path.join(os.homedir(), '.config', 'opencode', name)),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => path.resolve(value))

  return Array.from(new Set(candidates)).find((candidate) => existsSync(candidate)) ?? null
}

function writeArchivedConfig(archiveDir: string, configName: string, content: string): void {
  const base = configName.replace(/[^A-Za-z0-9._-]/g, '_')
  try {
    writeFileSync(path.join(archiveDir, `${base}.json`), content, { flag: 'wx' })
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }

  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`
  writeFileSync(path.join(archiveDir, `${base}-${suffix}.json`), content, { flag: 'wx' })
}

function archiveConfigs(rows: Array<{ config_name: string; config_content: string }>): void {
  const archiveDir = path.join(getOpenCodeConfigHome(), 'opencode-configs-archive')
  mkdirSync(archiveDir, { recursive: true })
  for (const row of rows) {
    try {
      writeArchivedConfig(archiveDir, row.config_name, row.config_content)
    } catch (error) {
      logger.warn('Failed to archive an opencode config before dropping the table', error)
    }
  }
}

const migration: Migration = {
  version: 19,
  name: 'drop-opencode-configs',

  up(db) {
    const rows = db.prepare('SELECT config_name, config_content, is_default FROM opencode_configs').all() as Array<{ config_name: string; config_content: string; is_default: number | null }>

    try {
      archiveConfigs(rows)
    } catch (error) {
      logger.warn('Failed to archive opencode configs before dropping the table', error)
    }

    const defaultRow = rows.find(row => row.is_default)
    if (defaultRow) {
      try {
        const configFilePath = getOpenCodeConfigFilePath()
        const hasWorkspaceConfig = OPENCODE_CONFIG_FILENAMES.some(name => existsSync(path.join(path.dirname(configFilePath), name)))
        if (!hasWorkspaceConfig && !firstExistingConfigSourcePath()) {
          mkdirSync(path.dirname(configFilePath), { recursive: true })
          writeFileSync(configFilePath, defaultRow.config_content)
        }
      } catch (error) {
        logger.warn('Failed to restore the default opencode config file', error)
      }
    }

    db.run('DROP INDEX IF EXISTS idx_opencode_default')
    db.run('DROP INDEX IF EXISTS idx_opencode_user_id')
    db.run('DROP TABLE IF EXISTS opencode_configs')
    db.run('ALTER TABLE repos DROP COLUMN opencode_config_name')
  },

  down(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS opencode_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT 'default',
        config_name TEXT NOT NULL,
        config_content TEXT NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, config_name)
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_opencode_user_id ON opencode_configs(user_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_opencode_default ON opencode_configs(user_id, is_default)')
    db.run('ALTER TABLE repos ADD COLUMN opencode_config_name TEXT')
  },
}

export default migration
