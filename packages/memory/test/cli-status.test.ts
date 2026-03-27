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
  inPlace: boolean
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
  const expiresAt = state.completedAt ? now + 86400000 : now + 86400000
  const data = JSON.stringify(defaultState)

  db.run(
    'INSERT OR REPLACE INTO project_kv (project_id, key, data, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [projectId, `loop:${worktreeName}`, data, expiresAt, now]
  )
}

describe('CLI Status - list-worktrees', () => {
  let tempDir: string
  let originalLog: typeof console.log

  beforeEach(() => {
    tempDir = mkdtempSync(join('.', 'temp-status-test-'))
    originalLog = console.log
  })

  afterEach(() => {
    console.log = originalLog
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('lists active worktree names', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'worktree-one', {})
    insertLoopState(db, 'test-project', 'worktree-two', {})
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
      listWorktrees: true,
    })

    expect(outputLines).toContain('worktree-one')
    expect(outputLines).toContain('worktree-two')
  })

  test('skips expired entries', async () => {
    const db = createTestKvDb(tempDir)
    const db2 = new Database(join(tempDir, 'memory.db'))
    const now = Date.now()
    const expiredAt = now - 86400000

    const expiredState: LoopState = {
      sessionId: 'test-session',
      worktreeName: 'expired-worktree',
      worktreeBranch: 'main',
      worktreeDir: '/tmp/test',
      worktree: true,
      iteration: 1,
      maxIterations: 10,
      phase: 'coding',
      startedAt: new Date().toISOString(),
      active: true,
      audit: false,
      errorCount: 0,
      auditCount: 0,
    }

    db2.run(
      'INSERT INTO project_kv (project_id, key, data, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['test-project', 'loop:expired-worktree', JSON.stringify(expiredState), expiredAt, now]
    )
    db2.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
      listWorktrees: true,
    })

    expect(outputLines).not.toContain('expired-worktree')
  })

  test('includes inactive loops in list', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'inactive-worktree', { active: false, completedAt: new Date().toISOString() })
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
      listWorktrees: true,
    })

    expect(outputLines).toContain('inactive-worktree')
  })
})

describe('CLI Status - summary', () => {
  let tempDir: string
  let originalLog: typeof console.log
  let originalError: typeof console.error

  beforeEach(() => {
    tempDir = mkdtempSync(join('.', 'temp-status-summary-'))
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

  test('shows active loops when no name given', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'active-one', { startedAt: new Date(Date.now() - 3600000).toISOString() })
    insertLoopState(db, 'test-project', 'active-two', { startedAt: new Date(Date.now() - 1800000).toISOString() })
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
    })

    const output = outputLines.join('\n')
    expect(output).toContain('Active Memory Loops:')
    expect(output).toContain('active-one')
    expect(output).toContain('active-two')
  })

  test('shows no loops message when empty', async () => {
    const db = createTestKvDb(tempDir)
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
    })

    const output = outputLines.join('\n')
    expect(output).toContain('No memory loops found')
  })

  test('shows recently completed loops', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'completed-one', {
      active: false,
      completedAt: new Date().toISOString(),
      terminationReason: 'success',
    })
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
    })

    const output = outputLines.join('\n')
    expect(output).toContain('Recently Completed:')
    expect(output).toContain('completed-one')
  })
})

describe('CLI Status - partial matching', () => {
  let tempDir: string
  let originalLog: typeof console.log
  let originalError: typeof console.error

  beforeEach(() => {
    tempDir = mkdtempSync(join('.', 'temp-status-partial-'))
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

  test('partial name matches single active loop', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'ralph-feat-auth', {
      startedAt: new Date(Date.now() - 3600000).toISOString(),
    })
    insertLoopState(db, 'test-project', 'ralph-fix-bug', {
      startedAt: new Date(Date.now() - 1800000).toISOString(),
    })
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
      name: 'auth',
    })

    const output = outputLines.join('\n')
    expect(output).toContain('Memory Loop: ralph-feat-auth')
  })

  test('partial name matches single recent loop', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'ralph-completed-auth', {
      active: false,
      completedAt: new Date().toISOString(),
      terminationReason: 'success',
    })
    insertLoopState(db, 'test-project', 'ralph-fix-bug', {
      active: true,
      startedAt: new Date(Date.now() - 1800000).toISOString(),
    })
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
      name: 'completed',
    })

    const output = outputLines.join('\n')
    expect(output).toContain('Memory Loop (Completed): ralph-completed-auth')
  })

  test('partial name matches multiple loops lists ambiguous', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'ralph-feat-auth', {})
    insertLoopState(db, 'test-project', 'ralph-auth-fix', {})
    db.close()

    const outputLines: string[] = []
    console.error = (msg: string) => outputLines.push(msg)

    let exited = false
    const originalExit = process.exit
    process.exit = (() => { exited = true; throw new Error('process.exit called') }) as any

    try {
      const { run } = await import('../src/cli/commands/status')
      await run({
        dbPath: join(tempDir, 'memory.db'),
        resolvedProjectId: 'test-project',
        server: 'http://localhost:5551',
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
    expect(output).toContain('ralph-feat-auth')
    expect(output).toContain('ralph-auth-fix')
  })

  test('partial name matches via worktreeBranch field', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'ralph-feat-auth', {
      worktreeBranch: 'feat/auth',
      startedAt: new Date(Date.now() - 3600000).toISOString(),
    })
    insertLoopState(db, 'test-project', 'ralph-fix-bug', {
      worktreeBranch: 'fix/bug',
      startedAt: new Date(Date.now() - 1800000).toISOString(),
    })
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
      name: 'feat/auth',
    })

    const output = outputLines.join('\n')
    expect(output).toContain('Memory Loop: ralph-feat-auth')
    expect(output).toContain('Branch:          feat/auth')
  })

  test('case-insensitive matching works', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'ralph-feat-auth', {
      startedAt: new Date(Date.now() - 3600000).toISOString(),
    })
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
      name: 'AUTH',
    })

    const output = outputLines.join('\n')
    expect(output).toContain('Memory Loop: ralph-feat-auth')
  })

  test('exact match takes priority over partial', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'auth', {
      startedAt: new Date(Date.now() - 3600000).toISOString(),
    })
    insertLoopState(db, 'test-project', 'ralph-auth', {
      startedAt: new Date(Date.now() - 1800000).toISOString(),
    })
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
      name: 'auth',
    })

    const output = outputLines.join('\n')
    expect(output).toContain('Memory Loop: auth')
    expect(output).not.toContain('Memory Loop: ralph-auth')
  })

  test('--list-worktrees with filter returns filtered results', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'ralph-feat-auth', { worktreeBranch: 'feat/auth' })
    insertLoopState(db, 'test-project', 'ralph-fix-bug', { worktreeBranch: 'fix/bug' })
    insertLoopState(db, 'test-project', 'ralph-update-deps', {})
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
      listWorktrees: true,
      listWorktreesFilter: 'auth',
    })

    const output = outputLines.join('\n')
    expect(output).toContain('ralph-feat-auth')
    expect(output).not.toContain('ralph-fix-bug')
    expect(output).not.toContain('ralph-update-deps')
  })

  test('--list-worktrees without filter returns all', async () => {
    const db = createTestKvDb(tempDir)
    insertLoopState(db, 'test-project', 'ralph-feat-auth', {})
    insertLoopState(db, 'test-project', 'ralph-fix-bug', {})
    db.close()

    const outputLines: string[] = []
    console.log = (msg: string) => outputLines.push(msg)

    const { run } = await import('../src/cli/commands/status')
    await run({
      dbPath: join(tempDir, 'memory.db'),
      resolvedProjectId: 'test-project',
      server: 'http://localhost:5551',
      listWorktrees: true,
    })

    const output = outputLines.join('\n')
    expect(output).toContain('ralph-feat-auth')
    expect(output).toContain('ralph-fix-bug')
  })
})
