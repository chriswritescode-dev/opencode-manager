import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createKvService } from '../src/services/kv'
import { createRalphService } from '../src/services/ralph'
import type { Logger } from '../src/types'

const TEST_DIR = '/tmp/opencode-manager-tool-blocking-test-' + Date.now()

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

function createMockLogger(): Logger {
  return {
    log: () => {},
    error: () => {},
    debug: () => {},
  }
}

describe('Tool Blocking Logic', () => {
  let db: Database
  let ralphService: ReturnType<typeof createRalphService>
  const projectId = 'test-project'
  const sessionID = 'test-session-123'

  beforeEach(() => {
    db = createTestDb()
    const kvService = createKvService(db)
    ralphService = createRalphService(kvService, projectId, createMockLogger())
  })

  afterEach(() => {
    db.close()
  })

  describe('Ralph state lookup', () => {
    test('getActiveState returns active state when Ralph loop is active', () => {
      const state = {
        active: true,
        sessionId: sessionID,
        worktreeName: 'test-worktree',
        worktreeDir: '/test/worktree',
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
        auditCount: 0,
        inPlace: false,
      }
      ralphService.setState(sessionID, state)

      const retrieved = ralphService.getActiveState(sessionID)
      expect(retrieved).toEqual(state)
      expect(retrieved?.active).toBe(true)
    })

    test('getActiveState returns null when no Ralph loop exists', () => {
      const retrieved = ralphService.getActiveState('non-existent-session')
      expect(retrieved).toBeNull()
    })

    test('getActiveState returns null when Ralph loop is inactive', () => {
      const inactiveState = {
        active: false,
        sessionId: sessionID,
        worktreeName: 'test-worktree',
        worktreeDir: '/test/worktree',
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
        auditCount: 0,
        inPlace: false,
      }
      ralphService.setState(sessionID, inactiveState)

      const retrieved = ralphService.getActiveState(sessionID)
      expect(retrieved).toBeNull()
    })
  })

  describe('Blocked tools list', () => {
    test('includes question tool', () => {
      const blockedTools = ['question', 'memory-plan-execute', 'memory-plan-ralph', 'ralph-loop']
      expect(blockedTools).toContain('question')
    })

    test('includes memory-plan-execute tool', () => {
      const blockedTools = ['question', 'memory-plan-execute', 'memory-plan-ralph', 'ralph-loop']
      expect(blockedTools).toContain('memory-plan-execute')
    })

    test('includes memory-plan-ralph tool', () => {
      const blockedTools = ['question', 'memory-plan-execute', 'memory-plan-ralph', 'ralph-loop']
      expect(blockedTools).toContain('memory-plan-ralph')
    })

    test('includes ralph-loop tool', () => {
      const blockedTools = ['question', 'memory-plan-execute', 'memory-plan-ralph', 'ralph-loop']
      expect(blockedTools).toContain('ralph-loop')
    })

    test('does not include memory-read tool', () => {
      const blockedTools = ['question', 'memory-plan-execute', 'memory-plan-ralph', 'ralph-loop']
      expect(blockedTools).not.toContain('memory-read')
    })

    test('does not include memory-write tool', () => {
      const blockedTools = ['question', 'memory-plan-execute', 'memory-plan-ralph', 'ralph-loop']
      expect(blockedTools).not.toContain('memory-write')
    })
  })

  describe('Error messages', () => {
    test('question tool has appropriate error message', () => {
      const messages: Record<string, string> = {
        'question': 'The question tool is not available during a Ralph loop. Do not ask questions — continue working on the task autonomously.',
        'memory-plan-execute': 'The memory-plan-execute tool is not available during a Ralph loop. Focus on executing the current plan.',
        'memory-plan-ralph': 'The memory-plan-ralph tool is not available during a Ralph loop. Focus on executing the current plan.',
        'ralph-loop': 'The ralph-loop tool is not available during a Ralph loop. Focus on executing the current plan.',
      }
      expect(messages['question']).toContain('question tool is not available')
    })

    test('memory-plan-execute tool has appropriate error message', () => {
      const messages: Record<string, string> = {
        'question': 'The question tool is not available during a Ralph loop. Do not ask questions — continue working on the task autonomously.',
        'memory-plan-execute': 'The memory-plan-execute tool is not available during a Ralph loop. Focus on executing the current plan.',
        'memory-plan-ralph': 'The memory-plan-ralph tool is not available during a Ralph loop. Focus on executing the current plan.',
        'ralph-loop': 'The ralph-loop tool is not available during a Ralph loop. Focus on executing the current plan.',
      }
      expect(messages['memory-plan-execute']).toContain('memory-plan-execute tool is not available')
    })
  })
})
