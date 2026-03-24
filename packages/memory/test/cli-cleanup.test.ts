import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync } from 'fs'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'

function createTestMemoryDb(tempDir: string): Database {
  const dbPath = join(tempDir, 'memory.db')
  const db = new Database(dbPath)

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

  return db
}

function insertTestMemory(db: Database, projectId: string, scope: string, content: string, createdAt?: number): number {
  const now = createdAt || Date.now()
  const result = db.run(
    'INSERT INTO memories (project_id, scope, content, file_path, access_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [projectId, scope, content, null, 0, now, now]
  )
  return result.lastInsertRowid as number
}

describe('CLI Cleanup', () => {
  let tempDir: string
  let originalLog: typeof console.log
  let originalError: typeof console.error
  let originalExit: typeof process.exit

  beforeEach(() => {
    tempDir = mkdtempSync(join('.', 'temp-cleanup-test-'))
    originalLog = console.log
    originalError = console.error
    originalExit = process.exit
  })

  afterEach(() => {
    console.log = originalLog
    console.error = originalError
    process.exit = originalExit
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('requires at least one filter', async () => {
    const db = createTestMemoryDb(tempDir)
    db.close()

    const outputLines: string[] = []
    console.error = (msg: string) => outputLines.push(msg)

    let exited = false
    process.exit = (() => { exited = true }) as any

    try {
      const { run } = await import('../src/cli/commands/cleanup')
      await run({
        dbPath: join(tempDir, 'memory.db'),
        resolvedProjectId: 'test-project',
      })
    } finally {
      process.exit = originalExit
    }

    expect(exited).toBe(true)
    expect(outputLines.join('\n')).toContain('At least one filter')
  })

  test('--all requires --project', async () => {
    const db = createTestMemoryDb(tempDir)
    db.close()

    const outputLines: string[] = []
    console.error = (msg: string) => outputLines.push(msg)

    let exited = false
    process.exit = (() => { exited = true }) as any

    try {
      const { run } = await import('../src/cli/commands/cleanup')
      await run({
        dbPath: join(tempDir, 'memory.db'),
        all: true,
      })
    } finally {
      process.exit = originalExit
    }

    expect(exited).toBe(true)
    expect(outputLines.join('\n')).toContain('--all requires --project')
  })

  test('--ids parses comma-separated IDs', async () => {
    const db = createTestMemoryDb(tempDir)
    insertTestMemory(db, 'test-project', 'convention', 'Memory 1')
    insertTestMemory(db, 'test-project', 'convention', 'Memory 2')
    insertTestMemory(db, 'test-project', 'convention', 'Memory 3')
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/cleanup')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      ids: '1,3',
      force: true,
    })

    const db2 = new Database(join(tempDir, 'memory.db'))
    const remaining = db2.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }
    db2.close()

    expect(remaining.count).toBe(1)
  })

  test('--older-than filters by age', async () => {
    const db = createTestMemoryDb(tempDir)
    const oldTime = Date.now() - (3 * 24 * 60 * 60 * 1000)
    const newTime = Date.now()
    insertTestMemory(db, 'test-project', 'convention', 'Old memory', oldTime)
    insertTestMemory(db, 'test-project', 'convention', 'New memory', newTime)
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/cleanup')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      olderThan: 2,
      force: true,
    })

    const db2 = new Database(join(tempDir, 'memory.db'))
    const remaining = db2.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }
    db2.close()

    expect(remaining.count).toBe(1)
  })

  test('--scope filters by scope', async () => {
    const db = createTestMemoryDb(tempDir)
    const id1 = insertTestMemory(db, 'test-project', 'convention', 'Convention 1')
    const id2 = insertTestMemory(db, 'test-project', 'convention', 'Convention 2')
    insertTestMemory(db, 'test-project', 'decision', 'Decision 1')
    insertTestMemory(db, 'test-project', 'context', 'Context 1')
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/cleanup')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      ids: `${id1},${id2}`,
      scope: 'convention',
      force: true,
    })

    const db2 = new Database(join(tempDir, 'memory.db'))
    const remaining = db2.prepare('SELECT COUNT(*) as count FROM memories WHERE scope = ?').get('convention') as { count: number }
    const total = db2.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }
    db2.close()

    expect(remaining.count).toBe(0)
    expect(total.count).toBe(2)
  })

  test('--dry-run does not delete', async () => {
    const db = createTestMemoryDb(tempDir)
    insertTestMemory(db, 'test-project', 'convention', 'Memory 1')
    insertTestMemory(db, 'test-project', 'convention', 'Memory 2')
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/cleanup')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      all: true,
      dryRun: true,
      force: true,
    })

    const db2 = new Database(join(tempDir, 'memory.db'))
    const remaining = db2.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }
    db2.close()

    expect(remaining.count).toBe(2)
    expect(outputLines.join('\n')).toContain('Dry run')
  })

  test('--force --all deletes all project memories', async () => {
    const db = createTestMemoryDb(tempDir)
    insertTestMemory(db, 'test-project', 'convention', 'Memory 1')
    insertTestMemory(db, 'test-project', 'decision', 'Memory 2')
    insertTestMemory(db, 'test-project', 'context', 'Memory 3')
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/cleanup')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      all: true,
      force: true,
    })

    const db2 = new Database(join(tempDir, 'memory.db'))
    const remaining = db2.prepare('SELECT COUNT(*) as count FROM memories WHERE project_id = ?').get('test-project') as { count: number }
    db2.close()

    expect(remaining.count).toBe(0)
  })

  test('reports remaining count after deletion', async () => {
    const db = createTestMemoryDb(tempDir)
    insertTestMemory(db, 'test-project', 'convention', 'Memory 1')
    insertTestMemory(db, 'test-project', 'convention', 'Memory 2')
    insertTestMemory(db, 'test-project', 'convention', 'Memory 3')
    insertTestMemory(db, 'test-project', 'convention', 'Memory 4')
    insertTestMemory(db, 'test-project', 'convention', 'Memory 5')
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/cleanup')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      ids: '1,2',
      force: true,
    })

    const output = outputLines.join('\n')
    expect(output).toContain('remaining')
  })
})

describe('cleanupVecWorkers', () => {
  test('returns cleanup result message', async () => {
    const { cleanupVecWorkers } = await import('../src/cli/commands/cleanup')
    const result = await cleanupVecWorkers()
    expect(result).toContain('Vec-worker cleanup complete')
    expect(result).toContain('Terminated')
  })
})
