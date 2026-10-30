import type { Database } from 'bun:sqlite'
import type { Migration } from '../migration-runner'

function createSessionGoalsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS session_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      server_id TEXT NOT NULL DEFAULT 'local',
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_goals_open
    ON session_goals(server_id, session_id)
    WHERE status IN ('active','paused')
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_session_goals_session
    ON session_goals(session_id, created_at DESC)
  `)
}

const migration: Migration = {
  id: '202610291200-drop-session-goals',

  up(db) {
    db.run('DROP INDEX IF EXISTS idx_session_goals_open')
    db.run('DROP INDEX IF EXISTS idx_session_goals_session')
    db.run('DROP TABLE IF EXISTS session_goals')
  },

  down(db) {
    createSessionGoalsTable(db)
  },
}

export default migration
