import { Database } from 'bun:sqlite'
import { mkdirSync, existsSync } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'

interface Migration {
  id: string
  description: string
  apply: (db: Database) => void
}

const migrations: Migration[] = [
  {
    id: '001',
    description: 'Remove status column from memories table',
    apply: (db: Database) => {
      const tableInfo = db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>
      const hasStatusColumn = tableInfo.some((col) => col.name === 'status')
      
      if (!hasStatusColumn) {
        return
      }

      try {
        db.run('ALTER TABLE memories DROP COLUMN status')
      } catch {
        const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memories'").all() as Array<{ name: string }>
        for (const idx of indexes) {
          if (idx.name.includes('status')) {
            db.run(`DROP INDEX IF EXISTS ${idx.name}`)
          }
        }
        db.run('ALTER TABLE memories DROP COLUMN status')
      }
    },
  },
]

function runMigrations(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)

  for (const migration of migrations) {
    const existing = db.prepare('SELECT id FROM migrations WHERE id = ?').get(migration.id)
    if (!existing) {
      migration.apply(db)
      db.prepare('INSERT INTO migrations (id, description, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.description,
        Date.now()
      )
    }
  }
}

export function resolveDataDir(): string {
  const defaultBase = join(homedir(), platform() === 'win32' ? 'AppData' : '.local', 'share')
  const xdgDataHome = process.env['XDG_DATA_HOME'] || defaultBase
  return join(xdgDataHome, 'opencode', 'memory')
}

export function resolveLogPath(): string {
  return join(resolveDataDir(), 'logs', 'memory.log')
}

export function initializeDatabase(dataDir: string): Database {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = `${dataDir}/memory.db`
  const db = new Database(dbPath)

  db.run('PRAGMA journal_mode=WAL')
  db.run('PRAGMA busy_timeout=5000')
  db.run('PRAGMA synchronous=NORMAL')

  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      content TEXT NOT NULL,
      file_path TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope)`)

  db.run(`
    CREATE TABLE IF NOT EXISTS session_state (
      key TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      data TEXT NOT NULL,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_session_state_project_id ON session_state(project_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_state_expires_at ON session_state(expires_at)`)

  runMigrations(db)

  db.run(`
    CREATE TABLE IF NOT EXISTS plugin_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  return db
}

export function closeDatabase(db: Database): void {
  db.close()
}
