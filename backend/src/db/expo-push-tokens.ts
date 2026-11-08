import type { Database } from 'bun:sqlite'
import type { ExpoPushTokenRecord } from '@opencode-manager/shared'

interface ExpoPushTokenRow {
  id: number
  user_id: string
  token: string
  device_name: string | null
  created_at: number
  last_used_at: number | null
}

/** Identifies the device token to register and the user and session that reported it. */
export interface UpsertExpoPushTokenInput {
  userId: string
  token: string
  deviceName?: string | null
  sessionId?: string | null
  now: number
}

/** One Expo receipt id pending a delivery check. */
export interface ExpoPushReceiptInput {
  receiptId: string
  token: string
  checkAfter: number
}

/** Creates the Expo push token and receipt tables together with their lookup indexes. */
export function ensureExpoPushTokensTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS expo_push_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      device_name TEXT,
      session_id TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS expo_push_receipts (
      receipt_id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      check_after INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

  db.run('CREATE INDEX IF NOT EXISTS idx_expo_push_tokens_user ON expo_push_tokens(user_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_expo_push_tokens_session ON expo_push_tokens(session_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_expo_push_receipts_check_after ON expo_push_receipts(check_after)')
}

function mapExpoPushTokenRow(row: ExpoPushTokenRow): ExpoPushTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    token: row.token,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }
}

/** Registers a device token, reassigning it to the latest user and session that reported it. */
export function upsertExpoPushToken(db: Database, input: UpsertExpoPushTokenInput): ExpoPushTokenRecord {
  db.prepare(
    `INSERT INTO expo_push_tokens (user_id, token, device_name, session_id, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET
       user_id = excluded.user_id,
       session_id = excluded.session_id,
       device_name = COALESCE(excluded.device_name, expo_push_tokens.device_name),
       last_used_at = excluded.last_used_at`,
  ).run(input.userId, input.token, input.deviceName ?? null, input.sessionId ?? null, input.now, input.now)

  const row = db
    .prepare('SELECT id, user_id, token, device_name, created_at, last_used_at FROM expo_push_tokens WHERE token = ?')
    .get(input.token) as ExpoPushTokenRow
  return mapExpoPushTokenRow(row)
}

/** Deletes a device token, optionally only when it belongs to the given user. */
export function deleteExpoPushToken(db: Database, token: string, userId?: string): boolean {
  const changes =
    userId === undefined
      ? db.prepare('DELETE FROM expo_push_tokens WHERE token = ?').run(token).changes
      : db.prepare('DELETE FROM expo_push_tokens WHERE token = ? AND user_id = ?').run(token, userId).changes
  return changes > 0
}

/** Lists the device tokens registered by one user, newest registration first. */
export function listExpoPushTokens(db: Database, userId: string): ExpoPushTokenRecord[] {
  const rows = db
    .prepare(
      'SELECT id, user_id, token, device_name, created_at, last_used_at FROM expo_push_tokens WHERE user_id = ? ORDER BY created_at DESC',
    )
    .all(userId) as ExpoPushTokenRow[]
  return rows.map(mapExpoPushTokenRow)
}

/** Lists the users that currently have at least one registered device token. */
export function listExpoPushTokenUserIds(db: Database): string[] {
  const rows = db.prepare('SELECT DISTINCT user_id FROM expo_push_tokens').all() as Array<{ user_id: string }>
  return rows.map((row) => row.user_id)
}

/** Deletes every registration matching one of the given device tokens and reports how many were removed. */
export function deleteExpoPushTokensByValue(db: Database, tokens: string[]): number {
  if (tokens.length === 0) return 0
  const placeholders = tokens.map(() => '?').join(', ')
  return db.prepare(`DELETE FROM expo_push_tokens WHERE token IN (${placeholders})`).run(...tokens).changes
}

/** Records that the given device tokens were used successfully just now. */
export function markExpoPushTokensUsed(db: Database, tokens: string[], now: number): void {
  if (tokens.length === 0) return
  const placeholders = tokens.map(() => '?').join(', ')
  db.prepare(`UPDATE expo_push_tokens SET last_used_at = ? WHERE token IN (${placeholders})`).run(now, ...tokens)
}

/** Deletes the device tokens registered by any of the given Better Auth sessions. */
export function deleteExpoPushTokensForSessions(db: Database, sessionIds: string[]): number {
  if (sessionIds.length === 0) return 0
  const placeholders = sessionIds.map(() => '?').join(', ')
  return db
    .prepare(`DELETE FROM expo_push_tokens WHERE session_id IN (${placeholders})`)
    .run(...sessionIds).changes
}

/** Stores Expo receipt ids to check later, ignoring receipts that are already recorded. */
export function insertExpoPushReceipts(db: Database, rows: ExpoPushReceiptInput[], now: number): void {
  if (rows.length === 0) return
  const statement = db.prepare(
    'INSERT OR IGNORE INTO expo_push_receipts (receipt_id, token, check_after, created_at) VALUES (?, ?, ?, ?)',
  )
  const insertAll = () => {
    for (const row of rows) {
      statement.run(row.receiptId, row.token, row.checkAfter, now)
    }
  }
  if (rows.length > 1) {
    db.transaction(insertAll)()
    return
  }
  insertAll()
}

/** Lists the pending receipts whose check time has passed, earliest due first. */
export function listDueExpoPushReceipts(
  db: Database,
  now: number,
  limit: number,
): Array<Pick<ExpoPushReceiptInput, 'receiptId' | 'token'>> {
  const rows = db
    .prepare('SELECT receipt_id, token FROM expo_push_receipts WHERE check_after <= ? ORDER BY check_after LIMIT ?')
    .all(now, limit) as Array<{ receipt_id: string; token: string }>
  return rows.map((row) => ({ receiptId: row.receipt_id, token: row.token }))
}

/** Deletes the receipts already checked with Expo. */
export function deleteExpoPushReceipts(db: Database, receiptIds: string[]): void {
  if (receiptIds.length === 0) return
  const placeholders = receiptIds.map(() => '?').join(', ')
  db.prepare(`DELETE FROM expo_push_receipts WHERE receipt_id IN (${placeholders})`).run(...receiptIds)
}

/** Deletes receipts stored before the cutoff and reports how many were removed. */
export function deleteExpoPushReceiptsCreatedBefore(db: Database, cutoff: number): number {
  return db.prepare('DELETE FROM expo_push_receipts WHERE created_at < ?').run(cutoff).changes
}
