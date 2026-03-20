import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createKvService } from '../src/services/kv'
import { createRalphService } from '../src/services/ralph'
import type { Logger } from '../src/types'

const TEST_DIR = '/tmp/opencode-manager-plan-approval-test-' + Date.now()

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

describe('Plan Approval Tool Interception', () => {
  let db: Database
  let ralphService: ReturnType<typeof createRalphService>
  const projectId = 'test-project'
  const sessionID = 'test-session-123'

  const PLAN_APPROVAL_LABELS = ['New session', 'Execute here', 'Ralph (worktree)', 'Ralph (in place)']

  const PLAN_APPROVAL_DIRECTIVES: Record<string, string> = {
    'New session': `<system-reminder>
The user selected "New session". You MUST now call memory-plan-execute in this response with:
- plan: The FULL self-contained implementation plan (the code agent starts with zero context)
- title: A short descriptive title for the session
- inPlace: false (or omit)
Do NOT output text without also making this tool call.
</system-reminder>`,
    'Execute here': `<system-reminder>
The user selected "Execute here". You MUST now call memory-plan-execute in this response with:
- plan: "See plan above" (the code agent continues this session and already has context)
- title: A short descriptive title for the session
- inPlace: true
Do NOT output text without also making this tool call.
</system-reminder>`,
    'Ralph (worktree)': `<system-reminder>
The user selected "Ralph (worktree)". You MUST now call memory-plan-ralph in this response with:
- plan: The FULL self-contained implementation plan (Ralph runs in an isolated worktree with no prior context)
- title: A short descriptive title for the session
- inPlace: false (or omit)
Do NOT output text without also making this tool call.
</system-reminder>`,
    'Ralph (in place)': `<system-reminder>
The user selected "Ralph (in place)". You MUST now call memory-plan-ralph in this response with:
- plan: The FULL self-contained implementation plan (Ralph runs in the current directory with no prior context)
- title: A short descriptive title for the session
- inPlace: true
Do NOT output text without also making this tool call.
</system-reminder>`,
  }

  const CANCEL_DIRECTIVE = '<system-reminder>\nThe user cancelled or provided a custom response. Do NOT call memory-plan-execute or memory-plan-ralph.\n</system-reminder>'

  beforeEach(() => {
    db = createTestDb()
    const kvService = createKvService(db)
    ralphService = createRalphService(kvService, projectId, createMockLogger())
  })

  afterEach(() => {
    db.close()
  })

  function simulateToolExecuteAfter(
    tool: string,
    args: unknown,
    output: { title: string; output: string; metadata: unknown },
    sessionActive = false
  ) {
    if (sessionActive) {
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
    }

    if (tool === 'question') {
      const questionArgs = args as { questions?: Array<{ options?: Array<{ label: string }> }> } | undefined
      const options = questionArgs?.questions?.[0]?.options
      if (options) {
        const labels = options.map((o) => o.label)
        const isPlanApproval = PLAN_APPROVAL_LABELS.every((l) => labels.includes(l))
        if (isPlanApproval) {
          const answer = output.output.trim()
          const matchedLabel = PLAN_APPROVAL_LABELS.find((l) => answer === l || answer.startsWith(l))
          const directive = matchedLabel ? PLAN_APPROVAL_DIRECTIVES[matchedLabel] : CANCEL_DIRECTIVE
          output.output = `${output.output}\n\n${directive}`
        }
      }
      return
    }

    if (!sessionActive) return

    const RALPH_BLOCKED_TOOLS: Record<string, string> = {
      question: 'The question tool is not available during a Ralph loop. Do not ask questions — continue working on the task autonomously.',
      'memory-plan-execute': 'The memory-plan-execute tool is not available during a Ralph loop. Focus on executing the current plan.',
      'memory-plan-ralph': 'The memory-plan-ralph tool is not available during a Ralph loop. Focus on executing the current plan.',
    }

    if (!(tool in RALPH_BLOCKED_TOOLS)) return

    output.title = 'Tool blocked'
    output.output = RALPH_BLOCKED_TOOLS[tool]!
  }

  test('Detects plan approval question and injects "New session" directive', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Ralph (worktree)', description: 'Ralph worktree' },
          { label: 'Ralph (in place)', description: 'Ralph in place' },
        ],
      }],
    }
    const output = { title: '', output: 'New session', metadata: {} }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('New session')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('memory-plan-execute')
    expect(output.output).toContain('inPlace: false')
  })

  test('Detects plan approval question and injects "Execute here" directive', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Ralph (worktree)', description: 'Ralph worktree' },
          { label: 'Ralph (in place)', description: 'Ralph in place' },
        ],
      }],
    }
    const output = { title: '', output: 'Execute here', metadata: {} }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('Execute here')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('memory-plan-execute')
    expect(output.output).toContain('inPlace: true')
  })

  test('Detects plan approval question and injects "Ralph (worktree)" directive', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Ralph (worktree)', description: 'Ralph worktree' },
          { label: 'Ralph (in place)', description: 'Ralph in place' },
        ],
      }],
    }
    const output = { title: '', output: 'Ralph (worktree)', metadata: {} }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('Ralph (worktree)')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('memory-plan-ralph')
    expect(output.output).toContain('inPlace: false')
  })

  test('Detects plan approval question and injects "Ralph (in place)" directive', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Ralph (worktree)', description: 'Ralph worktree' },
          { label: 'Ralph (in place)', description: 'Ralph in place' },
        ],
      }],
    }
    const output = { title: '', output: 'Ralph (in place)', metadata: {} }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('Ralph (in place)')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('memory-plan-ralph')
    expect(output.output).toContain('inPlace: true')
  })

  test('Injects cancel directive for unknown answer', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Ralph (worktree)', description: 'Ralph worktree' },
          { label: 'Ralph (in place)', description: 'Ralph in place' },
        ],
      }],
    }
    const output = { title: '', output: 'Custom answer', metadata: {} }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('Custom answer')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('cancelled or provided a custom response')
    expect(output.output).toContain('Do NOT call memory-plan-execute or memory-plan-ralph')
  })

  test('Matches partial answer that starts with label', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Ralph (worktree)', description: 'Ralph worktree' },
          { label: 'Ralph (in place)', description: 'Ralph in place' },
        ],
      }],
    }
    const output = { title: '', output: 'New session (with custom config)', metadata: {} }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('New session (with custom config)')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('memory-plan-execute')
  })

  test('Does not match partial label in middle of text', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Ralph (worktree)', description: 'Ralph worktree' },
          { label: 'Ralph (in place)', description: 'Ralph in place' },
        ],
      }],
    }
    const output = { title: '', output: 'I want to create a session', metadata: {} }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('I want to create a session')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('cancelled or provided a custom response')
  })

  test('Does not modify non-approval questions', () => {
    const args = {
      questions: [{
        question: 'What is your preference?',
        options: [
          { label: 'Option A', description: 'First option' },
          { label: 'Option B', description: 'Second option' },
        ],
      }],
    }
    const output = { title: '', output: 'Option A', metadata: {} }
    const originalOutput = output.output

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toBe(originalOutput)
    expect(output.output).not.toContain('<system-reminder>')
  })

  test('Does not modify non-question tools', () => {
    const output = { title: '', output: 'Some result', metadata: {} }
    const originalOutput = output.output

    simulateToolExecuteAfter('memory-read', {}, output)

    expect(output.output).toBe(originalOutput)
  })

  test('Ralph blocking still works for question tool when Ralph is active', () => {
    const output = { title: '', output: 'test', metadata: {} }

    simulateToolExecuteAfter('question', {}, output, true)

    expect(output.title).toBe('')
    expect(output.output).toBe('test')
  })

  test('Ralph blocking works for memory-plan-execute tool', () => {
    const output = { title: '', output: 'test', metadata: {} }

    simulateToolExecuteAfter('memory-plan-execute', {}, output, true)

    expect(output.title).toBe('Tool blocked')
    expect(output.output).toContain('memory-plan-execute tool is not available')
  })

  test('Ralph blocking works for memory-plan-ralph tool', () => {
    const output = { title: '', output: 'test', metadata: {} }

    simulateToolExecuteAfter('memory-plan-ralph', {}, output, true)

    expect(output.title).toBe('Tool blocked')
    expect(output.output).toContain('memory-plan-ralph tool is not available')
  })

  test('Ralph blocking does not affect non-blocked tools', () => {
    const output = { title: '', output: 'test', metadata: {} }

    simulateToolExecuteAfter('memory-read', {}, output, true)

    expect(output.title).toBe('')
    expect(output.output).toBe('test')
  })

  test('Ralph blocking only applies when Ralph is active', () => {
    const output = { title: '', output: 'test', metadata: {} }

    simulateToolExecuteAfter('memory-plan-execute', {}, output, false)

    expect(output.title).toBe('')
    expect(output.output).toBe('test')
  })
})
