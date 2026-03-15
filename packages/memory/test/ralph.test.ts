import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createKvQuery } from '../src/storage/kv-queries'
import { createKvService } from '../src/services/kv'
import { createRalphService } from '../src/services/ralph'
import { hasAuditIssues } from '../src/hooks/ralph'

const TEST_DIR = '/tmp/opencode-manager-ralph-test-' + Date.now()

function createTestDb(): Database {
  const db = new Database(`${TEST_DIR}-${Math.random().toString(36).slice(2)}.db`)
  db.run(`
    CREATE TABLE IF NOT EXISTS project_kv (
      project_id TEXT NOT NULL,
      key TEXT NOT NULL,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, key)
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_project_kv_expires_at ON project_kv(expires_at)`)
  return db
}

function createMockLogger() {
  return {
    log: () => {},
    error: () => {},
    debug: () => {},
  }
}

describe('RalphService', () => {
  let db: Database
  let kvService: ReturnType<typeof createKvService>
  let ralphService: ReturnType<typeof createRalphService>
  const projectId = 'test-project'

  beforeEach(() => {
    db = createTestDb()
    kvService = createKvService(db)
    ralphService = createRalphService(kvService, projectId, createMockLogger())
  })

  afterEach(() => {
    db.close()
  })

  test('state CRUD operations', () => {
    const state = {
      active: true,
      sessionId: 'session-123',
      worktreeName: 'test-worktree',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-test',
      workspaceId: 'wrk-test-worktree',
      iteration: 1,
      maxIterations: 5,
      completionPromise: 'DONE',
      startedAt: new Date().toISOString(),
      prompt: 'Test prompt',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    ralphService.setState('session-123', state)
    const retrieved = ralphService.getActiveState('session-123')
    expect(retrieved).toEqual(state)

    ralphService.setState('session-123', { ...state, iteration: 2 })
    const updated = ralphService.getActiveState('session-123')
    expect(updated?.iteration).toBe(2)

    ralphService.deleteState('session-123')
    const deleted = ralphService.getActiveState('session-123')
    expect(deleted).toBeNull()
  })

  test('getState returns null for inactive state', () => {
    const inactiveState = {
      active: false,
      sessionId: 'session-456',
      worktreeName: 'test-worktree',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-test',
      workspaceId: 'wrk-test-worktree',
      iteration: 1,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'Test prompt',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    ralphService.setState('session-456', inactiveState)
    const retrieved = ralphService.getActiveState('session-456')
    expect(retrieved).toBeNull()
  })

  test('getActiveState returns null for non-existent session', () => {
    const retrieved = ralphService.getActiveState('non-existent')
    expect(retrieved).toBeNull()
  })

  test('checkCompletionPromise matches exact promise', () => {
    const text = 'Some response text <promise>DONE</promise> more text'
    expect(ralphService.checkCompletionPromise(text, 'DONE')).toBe(true)
  })

  test('checkCompletionPromise returns false when no promise tags', () => {
    const text = 'Some response text without promise tags'
    expect(ralphService.checkCompletionPromise(text, 'DONE')).toBe(false)
  })

  test('checkCompletionPromise returns false when promise does not match', () => {
    const text = 'Some response <promise>NOT_DONE</promise> text'
    expect(ralphService.checkCompletionPromise(text, 'DONE')).toBe(false)
  })

  test('checkCompletionPromise handles whitespace normalization', () => {
    const text = 'Response <promise>  DONE   WITH   SPACES  </promise> text'
    expect(ralphService.checkCompletionPromise(text, 'DONE WITH SPACES')).toBe(true)
  })

  test('checkCompletionPromise matches first promise tag when multiple present', () => {
    const text = 'First <promise>FIRST</promise> second <promise>SECOND</promise>'
    expect(ralphService.checkCompletionPromise(text, 'FIRST')).toBe(true)
    expect(ralphService.checkCompletionPromise(text, 'SECOND')).toBe(false)
  })

  test('checkCompletionPromise handles multiline promise', () => {
    const text = 'Response <promise>\n  MULTI\n  LINE\n</promise> text'
    expect(ralphService.checkCompletionPromise(text, 'MULTI LINE')).toBe(true)
  })

  test('buildContinuationPrompt includes iteration number', () => {
    const state = {
      active: true,
      sessionId: 'session-789',
      worktreeName: 'test-worktree',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-test',
      workspaceId: 'wrk-test-worktree',
      iteration: 3,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'My test prompt',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    const prompt = ralphService.buildContinuationPrompt(state)
    expect(prompt).toContain('Ralph iteration 3')
    expect(prompt).toContain('My test prompt')
  })

  test('buildContinuationPrompt includes completion promise instruction', () => {
    const state = {
      active: true,
      sessionId: 'session-789',
      worktreeName: 'test-worktree',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-test',
      workspaceId: 'wrk-test-worktree',
      iteration: 1,
      maxIterations: 0,
      completionPromise: 'COMPLETE_TASK',
      startedAt: new Date().toISOString(),
      prompt: 'My test prompt',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    const prompt = ralphService.buildContinuationPrompt(state)
    expect(prompt).toContain('[Ralph iteration 1 | To stop: output <promise>COMPLETE_TASK</promise> (ONLY when all requirements are met)]')
  })

  test('buildContinuationPrompt includes max iterations when no promise', () => {
    const state = {
      active: true,
      sessionId: 'session-789',
      worktreeName: 'test-worktree',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-test',
      workspaceId: 'wrk-test-worktree',
      iteration: 2,
      maxIterations: 10,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'My test prompt',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    const prompt = ralphService.buildContinuationPrompt(state)
    expect(prompt).toContain('[Ralph iteration 2 / 10]')
  })

  test('buildContinuationPrompt shows unlimited message when no promise and no max', () => {
    const state = {
      active: true,
      sessionId: 'session-789',
      worktreeName: 'test-worktree',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-test',
      workspaceId: 'wrk-test-worktree',
      iteration: 1,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'My test prompt',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    const prompt = ralphService.buildContinuationPrompt(state)
    expect(prompt).toContain('[Ralph iteration 1 | No completion promise set - loop runs until cancelled]')
  })

  test('state persists across service recreation', () => {
    const state = {
      active: true,
      sessionId: 'session-persist',
      worktreeName: 'test-worktree',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-test',
      workspaceId: 'wrk-test-worktree',
      iteration: 5,
      maxIterations: 10,
      completionPromise: 'PERSIST_TEST',
      startedAt: new Date().toISOString(),
      prompt: 'Persistence test',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    ralphService.setState('session-persist', state)

    const newKvService = createKvService(db)
    const newRalphService = createRalphService(newKvService, projectId, createMockLogger())

    const retrieved = newRalphService.getActiveState('session-persist')
    expect(retrieved).toEqual(state)
  })

  test('buildAuditPrompt returns audit instruction', () => {
    const state = {
      active: true,
      sessionId: 'session-audit',
      worktreeName: 'test-worktree',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-test',
      workspaceId: 'wrk-test-worktree',
      iteration: 1,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'Test prompt',
      phase: 'coding' as const,
      audit: true,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    const prompt = ralphService.buildAuditPrompt(state)
    expect(prompt).toContain('Review the code changes')
    expect(prompt).toContain('bugs, logic errors, missing error handling')
    expect(prompt).toContain('No issues found')
  })

  test('buildContinuationPrompt appends audit findings when provided', () => {
    const state = {
      active: true,
      sessionId: 'session-audit',
      worktreeName: 'test-worktree',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-test',
      workspaceId: 'wrk-test-worktree',
      iteration: 2,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'Test prompt',
      phase: 'coding' as const,
      audit: true,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    const auditFindings = 'Found a bug in line 10'
    const prompt = ralphService.buildContinuationPrompt(state, auditFindings)
    expect(prompt).toContain('Ralph iteration 2')
    expect(prompt).toContain('Test prompt')
    expect(prompt).toContain('The following issues were found by the code auditor')
    expect(prompt).toContain('Found a bug in line 10')
  })

  test('buildContinuationPrompt without audit findings does not append section', () => {
    const state = {
      active: true,
      sessionId: 'session-audit',
      worktreeName: 'test-worktree',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-test',
      workspaceId: 'wrk-test-worktree',
      iteration: 2,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'Test prompt',
      phase: 'coding' as const,
      audit: true,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    const prompt = ralphService.buildContinuationPrompt(state)
    expect(prompt).toContain('Ralph iteration 2')
    expect(prompt).toContain('Test prompt')
    expect(prompt).not.toContain('The following issues were found')
  })

  test('listActive returns only active states', () => {
    const activeState1 = {
      active: true,
      sessionId: 'active-1',
      worktreeName: 'worktree-1',
      worktreeDir: '/path/to/worktree1',
      worktreeBranch: 'opencode/ralph-worktree-1',
      workspaceId: 'wrk-worktree-1',
      iteration: 1,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'Active prompt 1',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    const activeState2 = {
      active: true,
      sessionId: 'active-2',
      worktreeName: 'worktree-2',
      worktreeDir: '/path/to/worktree2',
      worktreeBranch: 'opencode/ralph-worktree-2',
      workspaceId: 'ralph-worktree-2',
      iteration: 2,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'Active prompt 2',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    const inactiveState = {
      active: false,
      sessionId: 'inactive-1',
      worktreeName: 'worktree-3',
      worktreeDir: '/path/to/worktree3',
      worktreeBranch: 'opencode/ralph-worktree-3',
      workspaceId: 'ralph-worktree-3',
      iteration: 1,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'Inactive prompt',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    ralphService.setState('active-1', activeState1)
    ralphService.setState('active-2', activeState2)
    ralphService.setState('inactive-1', inactiveState)

    const active = ralphService.listActive()
    expect(active.length).toBe(2)
    expect(active.map((s) => s.sessionId)).toContain('active-1')
    expect(active.map((s) => s.sessionId)).toContain('active-2')
    expect(active.map((s) => s.sessionId)).not.toContain('inactive-1')
  })

  test('findByWorktreeName returns state by worktree name', () => {
    const state1 = {
      active: true,
      sessionId: 'session-1',
      worktreeName: 'unique-worktree-name',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-unique-worktree-name',
      workspaceId: 'wrk-unique-worktree-name',
      iteration: 1,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'Test prompt',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
    }

    ralphService.setState('session-1', state1)

    const found = ralphService.findByWorktreeName('unique-worktree-name')
    expect(found).toEqual(state1)

    const notFound = ralphService.findByWorktreeName('non-existent')
    expect(notFound).toBeNull()
  })

  test('state with errorCount and cleanAuditCount persists correctly', () => {
    const state = {
      active: true,
      sessionId: 'session-err',
      worktreeName: 'test-worktree',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-test',
      workspaceId: 'wrk-test-worktree',
      iteration: 1,
      maxIterations: 5,
      completionPromise: 'DONE',
      startedAt: new Date().toISOString(),
      prompt: 'Test prompt',
      phase: 'coding' as const,
      audit: false,
      errorCount: 2,
      cleanAuditCount: 1,
      terminationReason: undefined,
      parentSessionId: 'parent-session-123',
    }
    ralphService.setState('session-err', state)
    const retrieved = ralphService.getActiveState('session-err')
    expect(retrieved?.errorCount).toBe(2)
    expect(retrieved?.cleanAuditCount).toBe(1)
    expect(retrieved?.parentSessionId).toBe('parent-session-123')
  })

  test('state defaults errorCount to 0', () => {
    const state = {
      active: true,
      sessionId: 'session-default',
      worktreeName: 'test-worktree',
      worktreeDir: '/path/to/worktree',
      worktreeBranch: 'opencode/ralph-test',
      workspaceId: 'wrk-test-worktree',
      iteration: 1,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'Test prompt',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
    }
    ralphService.setState('session-default', state)
    const retrieved = ralphService.getActiveState('session-default')
    expect(retrieved?.errorCount).toBe(0)
    expect(retrieved?.cleanAuditCount).toBe(0)
  })

  test('state with inPlace flag persists correctly', () => {
    const inPlaceState = {
      active: true,
      sessionId: 'session-inplace',
      worktreeName: 'inplace-worktree',
      worktreeDir: '/path/to/project',
      worktreeBranch: 'main',
      workspaceId: '',
      iteration: 1,
      maxIterations: 5,
      completionPromise: 'DONE',
      startedAt: new Date().toISOString(),
      prompt: 'In-place test prompt',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
      inPlace: true,
    }
    ralphService.setState('session-inplace', inPlaceState)
    const retrieved = ralphService.getActiveState('session-inplace')
    expect(retrieved?.inPlace).toBe(true)
    expect(retrieved?.workspaceId).toBe('')
    expect(retrieved?.worktreeDir).toBe('/path/to/project')
  })

  test('findByWorktreeName works with inPlace state', () => {
    const inPlaceState = {
      active: true,
      sessionId: 'session-inplace-2',
      worktreeName: 'unique-inplace-name',
      worktreeDir: '/path/to/project',
      worktreeBranch: 'develop',
      workspaceId: '',
      iteration: 2,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'Test prompt',
      phase: 'coding' as const,
      audit: true,
      errorCount: 0,
      cleanAuditCount: 1,
      inPlace: true,
    }
    ralphService.setState('session-inplace-2', inPlaceState)
    const found = ralphService.findByWorktreeName('unique-inplace-name')
    expect(found).toEqual(inPlaceState)
    expect(found?.inPlace).toBe(true)
  })

  test('buildContinuationPrompt works with inPlace state', () => {
    const inPlaceState = {
      active: true,
      sessionId: 'session-inplace-3',
      worktreeName: 'inplace-prompt-test',
      worktreeDir: '/path/to/project',
      worktreeBranch: 'main',
      workspaceId: '',
      iteration: 3,
      maxIterations: 0,
      completionPromise: 'COMPLETE',
      startedAt: new Date().toISOString(),
      prompt: 'In-place prompt test',
      phase: 'coding' as const,
      audit: false,
      errorCount: 0,
      cleanAuditCount: 0,
      inPlace: true,
    }
    const prompt = ralphService.buildContinuationPrompt(inPlaceState)
    expect(prompt).toContain('Ralph iteration 3')
    expect(prompt).toContain('In-place prompt test')
    expect(prompt).toContain('<promise>COMPLETE</promise>')
  })

  test('buildContinuationPrompt with audit findings works with inPlace state', () => {
    const inPlaceState = {
      active: true,
      sessionId: 'session-inplace-4',
      worktreeName: 'inplace-audit-test',
      worktreeDir: '/path/to/project',
      worktreeBranch: 'main',
      workspaceId: '',
      iteration: 2,
      maxIterations: 0,
      completionPromise: null,
      startedAt: new Date().toISOString(),
      prompt: 'In-place audit test',
      phase: 'coding' as const,
      audit: true,
      errorCount: 0,
      cleanAuditCount: 0,
      inPlace: true,
    }
    const auditFindings = 'Bug found in component'
    const prompt = ralphService.buildContinuationPrompt(inPlaceState, auditFindings)
    expect(prompt).toContain('Ralph iteration 2')
    expect(prompt).toContain('In-place audit test')
    expect(prompt).toContain('The following issues were found by the code auditor')
    expect(prompt).toContain('Bug found in component')
  })
})

describe('hasAuditIssues', () => {
  test('returns false for "No issues found"', () => {
    expect(hasAuditIssues('No issues found')).toBe(false)
  })

  test('returns false for "0 issues found"', () => {
    expect(hasAuditIssues('0 issues found')).toBe(false)
  })

  test('returns true for severity: bug', () => {
    expect(hasAuditIssues('**Severity**: bug\nFound a bug')).toBe(true)
  })

  test('returns true for severity: warning', () => {
    expect(hasAuditIssues('severity: warning\nSome warning')).toBe(true)
  })

  test('returns true for "3 issues found"', () => {
    expect(hasAuditIssues('3 issues found in the code')).toBe(true)
  })

  test('returns true for "1 bug found"', () => {
    expect(hasAuditIssues('1 bug found on line 10')).toBe(true)
  })

  test('returns true for ### Issues section with content', () => {
    const text = `### Issues

- Missing error handling
- Type safety issue`
    expect(hasAuditIssues(text)).toBe(true)
  })

  test('returns false for ### Issues section with "None"', () => {
    expect(hasAuditIssues('### Issues\n\nNone')).toBe(false)
  })

  test('returns false for ### Issues section with "N/A"', () => {
    expect(hasAuditIssues('### Issues\n\nN/A')).toBe(false)
  })

  test('returns false for empty text', () => {
    expect(hasAuditIssues('')).toBe(false)
  })

  test('returns false for text without any issue signals', () => {
    expect(hasAuditIssues('Code looks good')).toBe(false)
  })

  test('returns true for severity:bug without space', () => {
    expect(hasAuditIssues('severity:bug in function')).toBe(true)
  })

  test('returns true for **severity**: bug', () => {
    expect(hasAuditIssues('**severity**: bug')).toBe(true)
  })
})
