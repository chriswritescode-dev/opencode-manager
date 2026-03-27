import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync } from 'fs'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'

interface LoopState {
  sessionId: string
  worktreeName: string
  worktreeBranch: string
  worktreeDir: string
  worktree: boolean
  iteration: number
  maxIterations: number
  phase: 'coding' | 'auditing'
  startedAt: string
  completedAt?: string
  terminationReason?: string
  active: boolean
  audit: boolean
  errorCount: number
  auditCount: number
  completionPromise?: string
  lastAuditResult?: string
}

function createTestKvDb(tempDir: string): Database {
  const dbPath = join(tempDir, 'memory.db')
  const db = new Database(dbPath)

  db.run(`
    CREATE TABLE IF NOT EXISTS project_kv (
      project_id TEXT NOT NULL,
      key TEXT NOT NULL,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, key)
    )
  `)

  return db
}

function insertLoopState(db: Database, projectId: string, worktreeName: string, state: Partial<LoopState>): void {
  const defaultState: LoopState = {
    sessionId: 'test-session-id',
    worktreeName,
    worktreeBranch: 'main',
    worktreeDir: '/tmp/test-worktree',
    worktree: true,
    iteration: 1,
    maxIterations: 10,
    phase: 'coding',
    startedAt: new Date().toISOString(),
    active: true,
    audit: false,
    errorCount: 0,
    auditCount: 0,
    ...state,
  }

  const now = Date.now()
  const expiresAt = now + 86400000
  const data = JSON.stringify(defaultState)

  db.run(
    'INSERT OR REPLACE INTO project_kv (project_id, key, data, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [projectId, `loop:${worktreeName}`, data, expiresAt, now]
  )
}

describe('CLI Cancel', () => {
  let tempDir: string
  let originalLog: typeof console.log
  let originalError: typeof console.error

  beforeEach(() => {
    tempDir = mkdtempSync(join('.', 'temp-cancel-test-'))
    originalLog = console.log
    originalError = console.error
  })

  afterEach(() => {
    console.log = originalLog
    console.error = originalError
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('shows no active loops when KV is empty', async () => {
    const db = createTestKvDb(tempDir)
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/cancel')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      force: true,
    })

    const output = outputLines.join('\n')
    expect(output).toContain('No active memory loops')
  })

  test('shows no active loops when all are inactive', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'inactive-worktree', {
      active: false,
      completedAt: new Date().toISOString(),
    })
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/cancel')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      force: true,
    })

    const output = outputLines.join('\n')
    expect(output).toContain('No active memory loops')
  })

  test('auto-selects single active loop with force', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'single-loop', {})
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/cancel')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      force: true,
    })

    const db2 = new Database(join(tempDir, 'memory.db'))
    const row = db2.prepare('SELECT data FROM project_kv WHERE key = ?').get('loop:single-loop') as { data: string }
    const state = JSON.parse(row.data) as LoopState
    db2.close()

    expect(state.active).toBe(false)
    expect(state.terminationReason).toBe('cancelled')
    expect(state.completedAt).toBeDefined()
  })

  test('cancellation sets correct state fields', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'test-loop', {})
    db.close()

    const beforeCancel = new Date()
    const { run } = await import('../src/cli/commands/cancel')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      force: true,
    })

    const db2 = new Database(join(tempDir, 'memory.db'))
    const row = db2.prepare('SELECT data FROM project_kv WHERE key = ?').get('loop:test-loop') as { data: string }
    const state = JSON.parse(row.data) as LoopState
    db2.close()

    expect(state.active).toBe(false)
    expect(state.terminationReason).toBe('cancelled')
    expect(state.completedAt).toBeDefined()
    expect(new Date(state.completedAt!).getTime()).toBeGreaterThanOrEqual(beforeCancel.getTime())
  })

  test('lists active loops when multiple exist and no name given', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'loop-one', {})
    insertLoopState(db, 'test-project', 'loop-two', {})
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)
    console.error = (msg: string) => outputLines.push(msg)

    let exited = false
    const originalExit = process.exit
    process.exit = (() => { exited = true; throw new Error('process.exit called') }) as any

    try {
      const { run } = await import('../src/cli/commands/cancel')
      await run({
        dbPath: join(tempDir, 'memory.db'),
        resolvedProjectId: 'test-project',
      })
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('process.exit')) {
        throw e
      }
    } finally {
      process.exit = originalExit
    }

    expect(exited).toBe(true)
    const output = outputLines.join('\n')
    expect(output).toContain('Multiple active memory loops')
    expect(output).toContain('loop-one')
    expect(output).toContain('loop-two')
  })

  test('finds loop by name when multiple active', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'loop-alpha', {})
    insertLoopState(db, 'test-project', 'loop-beta', {})
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/cancel')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      name: 'loop-beta',
      force: true,
    })

    const db2 = new Database(join(tempDir, 'memory.db'))
    const alphaRow = db2.prepare('SELECT data FROM project_kv WHERE key = ?').get('loop:loop-alpha') as { data: string }
    const betaRow = db2.prepare('SELECT data FROM project_kv WHERE key = ?').get('loop:loop-beta') as { data: string }
    const alphaState = JSON.parse(alphaRow.data) as LoopState
    const betaState = JSON.parse(betaRow.data) as LoopState
    db2.close()

    expect(alphaState.active).toBe(true)
    expect(betaState.active).toBe(false)
    expect(betaState.terminationReason).toBe('cancelled')
  })

  test('partial name matches single loop proceeds with cancel', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'loop-feat-auth', {})
    insertLoopState(db, 'test-project', 'loop-fix-bug', {})
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/cancel')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      name: 'auth',
      force: true,
    })

    const db2 = new Database(join(tempDir, 'memory.db'))
    const authRow = db2.prepare('SELECT data FROM project_kv WHERE key = ?').get('loop:loop-feat-auth') as { data: string }
    const authState = JSON.parse(authRow.data) as LoopState
    db2.close()

    expect(authState.active).toBe(false)
    expect(authState.terminationReason).toBe('cancelled')
  })

  test('partial name matches multiple loops lists ambiguous and exits', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'loop-feat-auth', {})
    insertLoopState(db, 'test-project', 'loop-auth-fix', {})
    db.close()

    const outputLines: string[] = []
    console.error = (msg: string) => outputLines.push(msg)

    let exited = false
    const originalExit = process.exit
    process.exit = (() => { exited = true; throw new Error('process.exit called') }) as any

    try {
      const { run } = await import('../src/cli/commands/cancel')
      await run({
        dbPath: join(tempDir, 'memory.db'),
        resolvedProjectId: 'test-project',
        name: 'auth',
      })
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('process.exit')) {
        throw e
      }
    } finally {
      process.exit = originalExit
    }

    expect(exited).toBe(true)
    const output = outputLines.join('\n')
    expect(output).toContain("Multiple loops match 'auth':")
    expect(output).toContain('loop-feat-auth')
    expect(output).toContain('loop-auth-fix')
  })
})
