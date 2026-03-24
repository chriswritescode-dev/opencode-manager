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

function insertTestMemory(db: Database, projectId: string, scope: string, content: string, createdAt?: number): void {
  const now = createdAt || Date.now()
  db.run(
    'INSERT INTO memories (project_id, scope, content, file_path, access_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [projectId, scope, content, null, 0, now, now]
  )
}

describe('CLI List', () => {
  let tempDir: string
  let originalLog: typeof console.log

  beforeEach(() => {
    tempDir = mkdtempSync(join('.', 'temp-list-test-'))
    originalLog = console.log
  })

  afterEach(() => {
    console.log = originalLog
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('lists projects with memory counts', async () => {
    const db = createTestMemoryDb(tempDir)
    insertTestMemory(db, 'project-one', 'convention', 'First convention')
    insertTestMemory(db, 'project-one', 'decision', 'First decision')
    insertTestMemory(db, 'project-two', 'context', 'Context for project two')
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/list')
    run({ dbPath: join(tempDir, 'memory.db') })

    const output = outputLines.join('\n')
    expect(output).toContain('Projects with memories:')
    expect(output).toContain('project-one')
    expect(output).toContain('project-two')
  })

  test('shows no memories message when empty', async () => {
    const db = createTestMemoryDb(tempDir)
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/list')
    run({ dbPath: join(tempDir, 'memory.db') })

    const output = outputLines.join('\n')
    expect(output).toContain('No memories found')
  })

  test('shows correct oldest and newest dates', async () => {
    const db = createTestMemoryDb(tempDir)
    const oldTime = Date.now() - 86400000
    const newTime = Date.now()
    insertTestMemory(db, 'test-project', 'convention', 'Old memory', oldTime)
    insertTestMemory(db, 'test-project', 'convention', 'New memory', newTime)
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/list')
    run({ dbPath: join(tempDir, 'memory.db') })

    const output = outputLines.join('\n')
    const oldDate = new Date(oldTime).toISOString().split('T')[0]
    const newDate = new Date(newTime).toISOString().split('T')[0]
    expect(output).toContain(oldDate)
    expect(output).toContain(newDate)
  })
})

describe('CLI Stats', () => {
  let tempDir: string
  let originalLog: typeof console.log
  let originalError: typeof console.error
  let originalExit: typeof process.exit

  beforeEach(() => {
    tempDir = mkdtempSync(join('.', 'temp-stats-test-'))
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

  test('shows per-scope counts', async () => {
    const db = createTestMemoryDb(tempDir)
    insertTestMemory(db, 'test-project', 'convention', 'Convention 1')
    insertTestMemory(db, 'test-project', 'convention', 'Convention 2')
    insertTestMemory(db, 'test-project', 'decision', 'Decision 1')
    insertTestMemory(db, 'test-project', 'context', 'Context 1')
    insertTestMemory(db, 'test-project', 'context', 'Context 2')
    insertTestMemory(db, 'test-project', 'context', 'Context 3')
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/stats')
    run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
    })

    const output = outputLines.join('\n')
    expect(output).toContain('convention: 2')
    expect(output).toContain('decision:   1')
    expect(output).toContain('context:    3')
  })

  test('shows oldest and newest dates', async () => {
    const db = createTestMemoryDb(tempDir)
    const oldTime = Date.now() - 86400000
    const newTime = Date.now()
    insertTestMemory(db, 'test-project', 'convention', 'Old memory', oldTime)
    insertTestMemory(db, 'test-project', 'convention', 'New memory', newTime)
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/stats')
    run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
    })

    const output = outputLines.join('\n')
    const oldDate = new Date(oldTime).toISOString().split('T')[0]
    const newDate = new Date(newTime).toISOString().split('T')[0]
    expect(output).toContain('Oldest:')
    expect(output).toContain('Newest:')
    expect(output).toContain(oldDate)
    expect(output).toContain(newDate)
  })

  test('exits with error when no project ID', async () => {
    const db = createTestMemoryDb(tempDir)
    db.close()

    const outputLines: string[] = []
    console.error = (msg: string) => outputLines.push(msg)

    let exited = false
    process.exit = (() => { exited = true }) as any

    try {
      const { run } = await import('../src/cli/commands/stats')
      run({
        dbPath: join(tempDir, 'memory.db'),
      })
    } finally {
      process.exit = originalExit
    }

    expect(exited).toBe(true)
    expect(outputLines.join('\n')).toContain('Project ID required')
  })
})
