import { rmSync } from 'node:fs'
import path from 'node:path'
import type { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'
import { logger } from '../../utils/logger'
import type { Migration } from '../migration-runner'

const LEGACY_WALKTHROUGHS_DIR = 'walkthroughs'

function createChangeWalkthroughsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS change_walkthroughs (
      session_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      diff_hash TEXT NOT NULL,
      generation_id TEXT NOT NULL,
      walkthrough_session_id TEXT,
      status TEXT NOT NULL,
      artifact_path TEXT,
      published_at INTEGER,
      error TEXT,
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      execution_started_at INTEGER,
      PRIMARY KEY (session_id, source_key)
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS change_walkthroughs_walkthrough_session ON change_walkthroughs(walkthrough_session_id)')
}

const migration: Migration = {
  id: '202611070100-drop-change-walkthroughs',

  up(db) {
    db.run('DROP TABLE IF EXISTS change_walkthroughs')
    try {
      rmSync(path.join(ENV.WORKSPACE.BASE_PATH, LEGACY_WALKTHROUGHS_DIR), { recursive: true, force: true })
    } catch (error) {
      logger.warn('Failed to remove the legacy walkthroughs directory', error)
    }
  },

  down(db) {
    createChangeWalkthroughsTable(db)
  },
}

export default migration
