import type { Database } from 'bun:sqlite'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Migration } from '../migration-runner'

const SERVER_ID_COLUMN = 'server_id'

function tableExists(db: Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  )
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some((entry) => entry.name === column)
}

function addServerIdColumn(db: Database, table: string): void {
  if (!tableExists(db, table) || hasColumn(db, table, SERVER_ID_COLUMN)) {
    return
  }
  db.run(`ALTER TABLE ${table} ADD COLUMN server_id TEXT NOT NULL DEFAULT '${LOCAL_OPENCODE_SERVER_ID}'`)
}

function dropServerIdColumn(db: Database, table: string): void {
  if (!tableExists(db, table) || !hasColumn(db, table, SERVER_ID_COLUMN)) {
    return
  }
  db.run(`ALTER TABLE ${table} DROP COLUMN ${SERVER_ID_COLUMN}`)
}

const migration: Migration = {
  id: '202610181300-session-server-scope',

  up(db) {
    addServerIdColumn(db, 'session_permission_modes')
    addServerIdColumn(db, 'session_goals')

    db.run('DROP INDEX IF EXISTS idx_session_goals_open')
    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_session_goals_open
      ON session_goals(server_id, session_id)
      WHERE status IN ('active','paused')
    `)
  },

  down(db) {
    db.run('DROP INDEX IF EXISTS idx_session_goals_open')
    if (tableExists(db, 'session_goals')) {
      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_goals_open
        ON session_goals(session_id)
        WHERE status IN ('active','paused')
      `)
    }
    dropServerIdColumn(db, 'session_goals')
    dropServerIdColumn(db, 'session_permission_modes')
  },
}

export default migration
