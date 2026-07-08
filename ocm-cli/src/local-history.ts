import { existsSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join } from 'path'
import type { HistoryEventRow } from './session-move.js'

function opencodeDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME
  return xdg ? join(xdg, 'opencode') : join(homedir(), '.local', 'share', 'opencode')
}

/**
 * Resolves the opencode durable-event database path the same way
 * `Database.path()` does in opencode core: an `OPENCODE_DB` override wins,
 * then the default `opencode.db`, then the newest channel-suffixed variant
 * (`opencode-<channel>.db`) for non-release channels.
 */
export function resolveOpencodeDbPath(): string | null {
  const override = process.env.OPENCODE_DB
  const dataDir = opencodeDataDir()
  if (override) {
    if (override === ':memory:' || isAbsolute(override)) return override
    return join(dataDir, override)
  }

  const defaultPath = join(dataDir, 'opencode.db')
  if (existsSync(defaultPath)) return defaultPath
  if (!existsSync(dataDir)) return null

  const variants = readdirSync(dataDir)
    .filter((name) => name.startsWith('opencode-') && name.endsWith('.db'))
    .map((name) => join(dataDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)

  return variants[0] ?? null
}

export async function readSessionEvents(sessionID: string): Promise<HistoryEventRow[]> {
  const dbPath = resolveOpencodeDbPath()
  if (!dbPath) {
    throw new Error('opencode database not found; is this machine running opencode with durable history?')
  }

  const { Database } = await import('bun:sqlite')
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = db
      .query<{ id: string; aggregate_id: string; seq: number; type: string; data: string }, [string]>(
        'SELECT id, aggregate_id, seq, type, data FROM event WHERE aggregate_id = ? ORDER BY seq ASC',
      )
      .all(sessionID)

    return rows.map((row) => ({
      id: row.id,
      aggregate_id: row.aggregate_id,
      seq: row.seq,
      type: row.type,
      data: JSON.parse(row.data) as Record<string, unknown>,
    }))
  } finally {
    db.close()
  }
}
