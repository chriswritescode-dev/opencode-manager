import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import migration from '../../src/db/migrations/202610181300-session-server-scope'
import { getSessionPermissionMode, setSessionPermissionMode } from '../../src/db/session-permission-modes'

interface InsertSessionGoalRowInput {
  sessionId: string
  serverId?: string
  directory: string
  objective: string
  maxContinuations: number
  tokenBudget: number | null
  tokensAtStart: number
}

const INSERT_SESSION_GOAL_ROW_SQL = `
  INSERT INTO session_goals(
    session_id, server_id, directory, objective, status, stop_reason, turn_state,
    continuation_count, max_continuations, token_budget, tokens_at_start, tokens_used,
    consecutive_blocked, last_verdict, last_reason, created_at, updated_at, finished_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`

function insertSessionGoalRow(db: Database, input: InsertSessionGoalRowInput): number {
  const now = Date.now()
  const result = db.prepare(INSERT_SESSION_GOAL_ROW_SQL).run(
    input.sessionId,
    input.serverId ?? 'local',
    input.directory,
    input.objective,
    'active',
    null,
    'waiting',
    0,
    input.maxContinuations,
    input.tokenBudget,
    input.tokensAtStart,
    0,
    0,
    null,
    null,
    now,
    now,
    null,
  )
  return Number(result.lastInsertRowid)
}

function tryInsertSessionGoalRow(db: Database, input: InsertSessionGoalRowInput): number | null {
  try {
    return insertSessionGoalRow(db, input)
  } catch (error) {
    if (/UNIQUE constraint failed/i.test((error as Error).message)) {
      return null
    }
    throw error
  }
}

function sessionGoalServerIdRow(db: Database, id: number): { serverId: string } | undefined {
  return db.prepare('SELECT server_id AS serverId FROM session_goals WHERE id = ?').get(id) as
    | { serverId: string }
    | undefined
}

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(
    db,
    allMigrations.filter((entry) => entry.id !== '202610291200-drop-session-goals'),
  )
  return db
}

function createLegacyTables(db: Database): void {
  db.run(`
    CREATE TABLE session_permission_modes (
      session_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK(mode IN ('ask','auto')),
      updated_at INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE session_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','paused','completed','blocked','stopped')),
      stop_reason TEXT,
      turn_state TEXT NOT NULL DEFAULT 'waiting',
      continuation_count INTEGER NOT NULL DEFAULT 0,
      max_continuations INTEGER NOT NULL,
      token_budget INTEGER,
      tokens_at_start INTEGER NOT NULL DEFAULT 0,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      consecutive_blocked INTEGER NOT NULL DEFAULT 0,
      last_verdict TEXT,
      last_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER
    )
  `)
  db.run(`
    CREATE UNIQUE INDEX idx_session_goals_open
    ON session_goals(session_id)
    WHERE status IN ('active','paused')
  `)
}

function tableColumns(db: Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
}

function primaryKeyColumns(db: Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; pk: number }>)
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name)
}

function openGoalIndexColumns(db: Database): string[] {
  return (db.prepare("PRAGMA index_info('idx_session_goals_open')").all() as Array<{ name: string }>).map(
    (column) => column.name,
  )
}

function countRows(db: Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}

const GOAL_INPUT = {
  sessionId: 'ses_shared',
  directory: '/repo',
  objective: 'Ship it',
  maxContinuations: 1,
  tokenBudget: null,
  tokensAtStart: 0,
}

describe('202610181300 session server scope migration', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('adds server_id to both session tables on a fresh database', () => {
    expect(tableColumns(db, 'session_permission_modes')).toContain('server_id')
    expect(tableColumns(db, 'session_goals')).toContain('server_id')
    expect(openGoalIndexColumns(db)).toEqual(['server_id', 'session_id'])
  })

  it('scopes the open goal index by server', () => {
    const local = insertSessionGoalRow(db, GOAL_INPUT)
    const remote = insertSessionGoalRow(db, { ...GOAL_INPUT, serverId: 'srv_remote' })
    const duplicateRemote = tryInsertSessionGoalRow(db, { ...GOAL_INPUT, serverId: 'srv_remote' })

    expect(local).not.toBeNull()
    expect(remote).not.toBeNull()
    expect(duplicateRemote).toBeNull()
  })

  it('keys permission modes by server and session', () => {
    expect(primaryKeyColumns(db, 'session_permission_modes')).toEqual(['server_id', 'session_id'])

    setSessionPermissionMode(db, 'ses_shared', 'auto')
    setSessionPermissionMode(db, 'ses_shared', 'ask', 'srv_x')

    expect(getSessionPermissionMode(db, 'ses_shared')).toBe('auto')
    expect(getSessionPermissionMode(db, 'ses_shared', 'srv_x')).toBe('ask')
    expect(countRows(db, 'session_permission_modes')).toBe(2)
  })

  it('updates only the mode of the matching server and session', () => {
    setSessionPermissionMode(db, 'ses_shared', 'auto')
    setSessionPermissionMode(db, 'ses_shared', 'ask', 'srv_x')
    setSessionPermissionMode(db, 'ses_shared', 'ask')

    expect(getSessionPermissionMode(db, 'ses_shared')).toBe('ask')
    expect(getSessionPermissionMode(db, 'ses_shared', 'srv_x')).toBe('ask')
    expect(countRows(db, 'session_permission_modes')).toBe(2)
  })

  it('applies without the session_goals table', () => {
    const standaloneDb = new Database(':memory:')
    standaloneDb.run(`
      CREATE TABLE session_permission_modes (
        session_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK(mode IN ('ask','auto')),
        updated_at INTEGER NOT NULL
      )
    `)

    expect(() => migration.up(standaloneDb)).not.toThrow()
    expect(primaryKeyColumns(standaloneDb, 'session_permission_modes')).toEqual(['server_id', 'session_id'])

    standaloneDb.close()
  })

  it('removes remote rows and restores session-scoped keys when rolled back', () => {
    insertSessionGoalRow(db, GOAL_INPUT)
    insertSessionGoalRow(db, { ...GOAL_INPUT, serverId: 'srv_x' })
    setSessionPermissionMode(db, 'ses_shared', 'auto')
    setSessionPermissionMode(db, 'ses_shared', 'ask', 'srv_x')

    expect(() => migration.down(db)).not.toThrow()

    expect(openGoalIndexColumns(db)).toEqual(['session_id'])
    expect(tableColumns(db, 'session_goals')).not.toContain('server_id')
    expect(primaryKeyColumns(db, 'session_permission_modes')).toEqual(['session_id'])
    expect(countRows(db, 'session_goals')).toBe(1)
    expect(countRows(db, 'session_permission_modes')).toBe(1)
    expect(db.prepare('SELECT session_id, mode FROM session_permission_modes').all()).toEqual([
      { session_id: 'ses_shared', mode: 'auto' },
    ])
  })

  it('upgrades legacy tables, keeps existing rows local and tolerates a second run', () => {
    const legacyDb = new Database(':memory:')
    createLegacyTables(legacyDb)
    legacyDb
      .prepare('INSERT INTO session_permission_modes(session_id, mode, updated_at) VALUES(?,?,?)')
      .run('ses_root', 'auto', Date.now())
    legacyDb
      .prepare(`
        INSERT INTO session_goals(session_id, directory, objective, status, turn_state, max_continuations, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?)
      `)
      .run('ses_root', '/repo', 'Ship it', 'active', 'waiting', 1, Date.now(), Date.now())
    const legacyGoalId = (legacyDb.prepare('SELECT id FROM session_goals LIMIT 1').get() as { id: number }).id

    migration.up(legacyDb)
    setSessionPermissionMode(legacyDb, 'ses_root', 'ask', 'srv_x')
    migration.up(legacyDb)

    expect(tableColumns(legacyDb, 'session_permission_modes')).toContain('server_id')
    expect(tableColumns(legacyDb, 'session_goals')).toContain('server_id')
    expect(openGoalIndexColumns(legacyDb)).toEqual(['server_id', 'session_id'])
    expect(primaryKeyColumns(legacyDb, 'session_permission_modes')).toEqual(['server_id', 'session_id'])
    expect(getSessionPermissionMode(legacyDb, 'ses_root')).toBe('auto')
    expect(getSessionPermissionMode(legacyDb, 'ses_root', 'srv_x')).toBe('ask')
    expect(countRows(legacyDb, 'session_permission_modes')).toBe(2)
    expect(sessionGoalServerIdRow(legacyDb, legacyGoalId)).toMatchObject({ serverId: 'local' })

    legacyDb.close()
  })
})
