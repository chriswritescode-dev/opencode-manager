import type { Database } from 'bun:sqlite'
import type {
  SessionGoalStatus,
  SessionGoalStopReason,
  SessionGoalTurnState,
  SessionGoalVerdict,
} from '@opencode-manager/shared/schemas'

export interface SessionGoalRecord {
  id: number
  sessionId: string
  directory: string
  objective: string
  status: SessionGoalStatus
  stopReason: SessionGoalStopReason | null
  turnState: SessionGoalTurnState
  continuationCount: number
  maxContinuations: number
  tokenBudget: number | null
  tokensAtStart: number
  tokensUsed: number
  consecutiveBlocked: number
  lastVerdict: SessionGoalVerdict | null
  lastReason: string | null
  createdAt: number
  updatedAt: number
  finishedAt: number | null
}

export interface InsertSessionGoalInput {
  sessionId: string
  directory: string
  objective: string
  maxContinuations: number
  tokenBudget: number | null
  tokensAtStart: number
}

export interface SessionGoalPatch {
  status?: SessionGoalStatus
  stopReason?: SessionGoalStopReason | null
  turnState?: SessionGoalTurnState
  continuationCount?: number
  tokensUsed?: number
  consecutiveBlocked?: number
  lastVerdict?: SessionGoalVerdict | null
  lastReason?: string | null
  finishedAt?: number | null
}

interface SessionGoalRow {
  id: number
  session_id: string
  directory: string
  objective: string
  status: SessionGoalStatus
  stop_reason: SessionGoalStopReason | null
  turn_state: SessionGoalTurnState
  continuation_count: number
  max_continuations: number
  token_budget: number | null
  tokens_at_start: number
  tokens_used: number
  consecutive_blocked: number
  last_verdict: SessionGoalVerdict | null
  last_reason: string | null
  created_at: number
  updated_at: number
  finished_at: number | null
}

const SESSION_GOAL_COLUMNS = `
  id, session_id, directory, objective, status, stop_reason, turn_state,
  continuation_count, max_continuations, token_budget, tokens_at_start, tokens_used,
  consecutive_blocked, last_verdict, last_reason, created_at, updated_at, finished_at
`

export function ensureSessionGoalsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS session_goals (
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_goals_open
    ON session_goals(session_id)
    WHERE status IN ('active','paused')
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_session_goals_session
    ON session_goals(session_id, created_at DESC)
  `)
}

export function insertSessionGoal(db: Database, input: InsertSessionGoalInput): SessionGoalRecord | null {
  const now = Date.now()
  try {
    const result = db.prepare(`
      INSERT INTO session_goals(
        session_id, directory, objective, status, stop_reason, turn_state,
        continuation_count, max_continuations, token_budget, tokens_at_start, tokens_used,
        consecutive_blocked, last_verdict, last_reason, created_at, updated_at, finished_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      input.sessionId,
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
    return getSessionGoalById(db, Number(result.lastInsertRowid))
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return null
    }
    throw error
  }
}

export function getSessionGoalById(db: Database, id: number): SessionGoalRecord | null {
  const row = db
    .prepare(`SELECT ${SESSION_GOAL_COLUMNS} FROM session_goals WHERE id = ?`)
    .get(id) as SessionGoalRow | undefined
  return row ? mapSessionGoalRow(row) : null
}

export function getLatestSessionGoal(db: Database, sessionId: string): SessionGoalRecord | null {
  const row = db
    .prepare(`SELECT ${SESSION_GOAL_COLUMNS} FROM session_goals WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(sessionId) as SessionGoalRow | undefined
  return row ? mapSessionGoalRow(row) : null
}

export function listOpenSessionGoals(db: Database): SessionGoalRecord[] {
  const rows = db
    .prepare(`SELECT ${SESSION_GOAL_COLUMNS} FROM session_goals WHERE status IN ('active','paused') ORDER BY created_at ASC`)
    .all() as SessionGoalRow[]
  return rows.map(mapSessionGoalRow)
}

export function transitionSessionGoal(
  db: Database,
  id: number,
  fromStatuses: SessionGoalStatus[],
  patch: SessionGoalPatch,
): SessionGoalRecord | null {
  const assignments: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [Date.now()]

  if (patch.status !== undefined) {
    assignments.push('status = ?')
    values.push(patch.status)
  }
  if (patch.stopReason !== undefined) {
    assignments.push('stop_reason = ?')
    values.push(patch.stopReason)
  }
  if (patch.turnState !== undefined) {
    assignments.push('turn_state = ?')
    values.push(patch.turnState)
  }
  if (patch.continuationCount !== undefined) {
    assignments.push('continuation_count = ?')
    values.push(patch.continuationCount)
  }
  if (patch.tokensUsed !== undefined) {
    assignments.push('tokens_used = ?')
    values.push(patch.tokensUsed)
  }
  if (patch.consecutiveBlocked !== undefined) {
    assignments.push('consecutive_blocked = ?')
    values.push(patch.consecutiveBlocked)
  }
  if (patch.lastVerdict !== undefined) {
    assignments.push('last_verdict = ?')
    values.push(patch.lastVerdict)
  }
  if (patch.lastReason !== undefined) {
    assignments.push('last_reason = ?')
    values.push(patch.lastReason)
  }
  if (patch.finishedAt !== undefined) {
    assignments.push('finished_at = ?')
    values.push(patch.finishedAt)
  }

  const placeholders = fromStatuses.map(() => '?').join(', ')
  const result = db
    .prepare(`UPDATE session_goals SET ${assignments.join(', ')} WHERE id = ? AND status IN (${placeholders})`)
    .run(...values, id, ...fromStatuses)

  if (result.changes === 0) {
    return null
  }
  return getSessionGoalById(db, id)
}

function mapSessionGoalRow(row: SessionGoalRow): SessionGoalRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    directory: row.directory,
    objective: row.objective,
    status: row.status,
    stopReason: row.stop_reason,
    turnState: row.turn_state,
    continuationCount: row.continuation_count,
    maxContinuations: row.max_continuations,
    tokenBudget: row.token_budget,
    tokensAtStart: row.tokens_at_start,
    tokensUsed: row.tokens_used,
    consecutiveBlocked: row.consecutive_blocked,
    lastVerdict: row.last_verdict,
    lastReason: row.last_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}
