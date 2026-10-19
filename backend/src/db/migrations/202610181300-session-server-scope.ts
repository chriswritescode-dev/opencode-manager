import type { Database } from 'bun:sqlite'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Migration } from '../migration-runner'

const SERVER_ID_COLUMN = 'server_id'
const PERMISSION_MODES_TABLE = 'session_permission_modes'
const PERMISSION_MODES_REBUILD_TABLE = 'session_permission_modes_rebuild'

interface ColumnInfo {
  name: string
  pk: number
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  )
}

function tableColumns(db: Database, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[]
}

function hasColumn(db: Database, table: string, column: string): boolean {
  return tableColumns(db, table).some((entry) => entry.name === column)
}

function primaryKeyColumns(db: Database, table: string): string[] {
  return tableColumns(db, table)
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name)
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

function deleteRemoteRows(db: Database, table: string): void {
  if (!tableExists(db, table) || !hasColumn(db, table, SERVER_ID_COLUMN)) {
    return
  }
  db.run(`DELETE FROM ${table} WHERE ${SERVER_ID_COLUMN} <> '${LOCAL_OPENCODE_SERVER_ID}'`)
}

function rebuildPermissionModesForServers(db: Database): void {
  if (!tableExists(db, PERMISSION_MODES_TABLE) || !hasColumn(db, PERMISSION_MODES_TABLE, SERVER_ID_COLUMN)) {
    return
  }
  const primaryKey = primaryKeyColumns(db, PERMISSION_MODES_TABLE)
  if (primaryKey.length === 2 && primaryKey[0] === SERVER_ID_COLUMN && primaryKey[1] === 'session_id') {
    return
  }

  db.run(`DROP TABLE IF EXISTS ${PERMISSION_MODES_REBUILD_TABLE}`)
  db.run(`
    CREATE TABLE ${PERMISSION_MODES_REBUILD_TABLE} (
      session_id TEXT NOT NULL,
      server_id TEXT NOT NULL DEFAULT '${LOCAL_OPENCODE_SERVER_ID}',
      mode TEXT NOT NULL CHECK(mode IN ('ask','auto')),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, session_id)
    )
  `)
  db.run(`
    INSERT INTO ${PERMISSION_MODES_REBUILD_TABLE}(session_id, server_id, mode, updated_at)
    SELECT session_id, ${SERVER_ID_COLUMN}, mode, updated_at FROM ${PERMISSION_MODES_TABLE}
  `)
  db.run(`DROP TABLE ${PERMISSION_MODES_TABLE}`)
  db.run(`ALTER TABLE ${PERMISSION_MODES_REBUILD_TABLE} RENAME TO ${PERMISSION_MODES_TABLE}`)
}

function rebuildPermissionModesForLocalSessions(db: Database): void {
  if (!tableExists(db, PERMISSION_MODES_TABLE) || !hasColumn(db, PERMISSION_MODES_TABLE, SERVER_ID_COLUMN)) {
    return
  }
  const primaryKey = primaryKeyColumns(db, PERMISSION_MODES_TABLE)
  if (primaryKey.length === 1 && primaryKey[0] === 'session_id') {
    return
  }

  db.run(`DROP TABLE IF EXISTS ${PERMISSION_MODES_REBUILD_TABLE}`)
  db.run(`
    CREATE TABLE ${PERMISSION_MODES_REBUILD_TABLE} (
      session_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK(mode IN ('ask','auto')),
      updated_at INTEGER NOT NULL
    )
  `)
  db.run(`
    INSERT INTO ${PERMISSION_MODES_REBUILD_TABLE}(session_id, mode, updated_at)
    SELECT session_id, mode, updated_at FROM ${PERMISSION_MODES_TABLE}
    WHERE ${SERVER_ID_COLUMN} = '${LOCAL_OPENCODE_SERVER_ID}'
  `)
  db.run(`DROP TABLE ${PERMISSION_MODES_TABLE}`)
  db.run(`ALTER TABLE ${PERMISSION_MODES_REBUILD_TABLE} RENAME TO ${PERMISSION_MODES_TABLE}`)
}

const migration: Migration = {
  id: '202610181300-session-server-scope',

  up(db) {
    addServerIdColumn(db, PERMISSION_MODES_TABLE)
    addServerIdColumn(db, 'session_goals')
    rebuildPermissionModesForServers(db)

    db.run('DROP INDEX IF EXISTS idx_session_goals_open')
    if (tableExists(db, 'session_goals')) {
      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_goals_open
        ON session_goals(server_id, session_id)
        WHERE status IN ('active','paused')
      `)
    }
  },

  down(db) {
    deleteRemoteRows(db, 'session_goals')
    deleteRemoteRows(db, PERMISSION_MODES_TABLE)

    db.run('DROP INDEX IF EXISTS idx_session_goals_open')
    if (tableExists(db, 'session_goals')) {
      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_goals_open
        ON session_goals(session_id)
        WHERE status IN ('active','paused')
      `)
    }
    rebuildPermissionModesForLocalSessions(db)
    dropServerIdColumn(db, 'session_goals')
  },
}

export default migration
