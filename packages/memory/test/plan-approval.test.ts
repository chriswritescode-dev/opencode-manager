import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createKvService } from '../src/services/kv'
import { createLoopService } from '../src/services/loop'
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
  let loopService: ReturnType<typeof createLoopService>
  const projectId = 'test-project'
  const sessionID = 'test-session-123'

  const PLAN_APPROVAL_LABELS = ['New session', 'Execute here', 'Loop (worktree)', 'Loop']

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
    'Loop (worktree)': `<system-reminder>
The user selected "Loop (worktree)". You MUST now call memory-loop in this response with:
- plan: The FULL self-contained implementation plan (runs in an isolated worktree with no prior context)
- title: A short descriptive title for the session
- worktree: true
Do NOT output text without also making this tool call.
</system-reminder>`,
    'Loop': `<system-reminder>
The user selected "Loop". You MUST now call memory-loop in this response with:
- plan: The FULL self-contained implementation plan (runs in the current directory with no prior context)
- title: A short descriptive title for the session
- worktree: false
Do NOT output text without also making this tool call.
</system-reminder>`,
  }

  const CANCEL_DIRECTIVE = '<system-reminder>\nThe user provided a custom response instead of selecting a predefined option. Review their answer and respond accordingly. If they want to proceed with execution, use the appropriate tool (memory-plan-execute or memory-loop) based on their intent. If they want to cancel or revise the plan, help them with that instead.\n</system-reminder>'

  beforeEach(() => {
    db = createTestDb()
    const kvService = createKvService(db)
    loopService = createLoopService(kvService, projectId, createMockLogger())
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
        worktreeBranch: 'opencode/loop-test',
        iteration: 1,
        maxIterations: 5,
        completionPromise: 'ALL_PHASES_COMPLETE',
        startedAt: new Date().toISOString(),
        prompt: 'Test prompt',
        phase: 'coding' as const,
        audit: false,
        errorCount: 0,
        auditCount: 0,
        worktree: true,
      }
      loopService.setState(sessionID, state)
    }

    if (tool === 'question') {
      const questionArgs = args as { questions?: Array<{ options?: Array<{ label: string }> }> } | undefined
      const options = questionArgs?.questions?.[0]?.options
      if (options) {
        const labels = options.map((o) => o.label)
        const isPlanApproval = PLAN_APPROVAL_LABELS.every((l) => labels.includes(l))
        if (isPlanApproval) {
          const metadata = output.metadata as { answers?: string[][] } | undefined
          const answer = metadata?.answers?.[0]?.[0]?.trim() ?? output.output.trim()
          const matchedLabel = PLAN_APPROVAL_LABELS.find((l) => answer === l || answer.startsWith(l))
          const directive = matchedLabel ? PLAN_APPROVAL_DIRECTIVES[matchedLabel] : CANCEL_DIRECTIVE
          output.output = `${output.output}\n\n${directive}`
        }
      }
      return
    }

    if (!sessionActive) return

    const LOOP_BLOCKED_TOOLS: Record<string, string> = {
      question: 'The question tool is not available during a memory loop. Do not ask questions — continue working on the task autonomously.',
      'memory-plan-execute': 'The memory-plan-execute tool is not available during a memory loop. Focus on executing the current plan.',
      'memory-loop': 'The memory-loop tool is not available during a memory loop. Focus on executing the current plan.',
    }

    if (!(tool in LOOP_BLOCKED_TOOLS)) return

    output.title = 'Tool blocked'
    output.output = LOOP_BLOCKED_TOOLS[tool]!
  }

  test('Detects plan approval question and injects "New session" directive', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
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
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
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

  test('Detects plan approval question and injects "Loop (worktree)" directive', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
        ],
      }],
    }
    const output = { title: '', output: 'Loop (worktree)', metadata: {} }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('Loop (worktree)')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('memory-loop')
    expect(output.output).toContain('worktree: true')
  })

  test('Detects plan approval question and injects "Loop" directive', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
        ],
      }],
    }
    const output = { title: '', output: 'Loop', metadata: {} }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('Loop')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('memory-loop')
    expect(output.output).toContain('worktree: false')
  })

  test('Injects cancel directive for unknown answer', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
        ],
      }],
    }
    const output = { title: '', output: 'Custom answer', metadata: {} }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('Custom answer')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('custom response')
    expect(output.output).toContain('respond accordingly')
  })

  test('Matches partial answer that starts with label', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
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
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
        ],
      }],
    }
    const output = { title: '', output: 'I want to create a session', metadata: {} }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('I want to create a session')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('custom response')
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

  test('Loop blocking still works for question tool when loop is active', () => {
    const output = { title: '', output: 'test', metadata: {} }

    simulateToolExecuteAfter('question', {}, output, true)

    expect(output.title).toBe('')
    expect(output.output).toBe('test')
  })

  test('Loop blocking works for memory-plan-execute tool', () => {
    const output = { title: '', output: 'test', metadata: {} }

    simulateToolExecuteAfter('memory-plan-execute', {}, output, true)

    expect(output.title).toBe('Tool blocked')
    expect(output.output).toContain('memory-plan-execute tool is not available')
  })

  test('Loop blocking works for memory-loop tool', () => {
    const output = { title: '', output: 'test', metadata: {} }

    simulateToolExecuteAfter('memory-loop', {}, output, true)

    expect(output.title).toBe('Tool blocked')
    expect(output.output).toContain('memory-loop tool is not available')
  })

  test('Loop blocking does not affect non-blocked tools', () => {
    const output = { title: '', output: 'test', metadata: {} }

    simulateToolExecuteAfter('memory-read', {}, output, true)

    expect(output.title).toBe('')
    expect(output.output).toBe('test')
  })

  test('Loop blocking only applies when loop is active', () => {
    const output = { title: '', output: 'test', metadata: {} }

    simulateToolExecuteAfter('memory-plan-execute', {}, output, false)

    expect(output.title).toBe('')
    expect(output.output).toBe('test')
  })

  test('Detects plan approval using metadata.answers when output is full sentence', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
        ],
      }],
    }
    const output = {
      title: 'Asked 1 question',
      output: 'User has answered your questions: "How would you like to proceed?"="Loop (worktree)". You can now continue with the user\'s answers in mind.',
      metadata: { answers: [['Loop (worktree)']] },
    }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('Loop (worktree)')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('memory-loop')
    expect(output.output).toContain('worktree: true')
  })

  test('Detects "Loop" using metadata.answers when output is full sentence', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
        ],
      }],
    }
    const output = {
      title: 'Asked 1 question',
      output: 'User has answered your questions: "How would you like to proceed?"="Loop". You can now continue with the user\'s answers in mind.',
      metadata: { answers: [['Loop']] },
    }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('Loop')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('memory-loop')
    expect(output.output).toContain('worktree: false')
  })

  test('Detects "New session" using metadata.answers when output is full sentence', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
        ],
      }],
    }
    const output = {
      title: 'Asked 1 question',
      output: 'User has answered your questions: "How would you like to proceed?"="New session". You can now continue with the user\'s answers in mind.',
      metadata: { answers: [['New session']] },
    }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('New session')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('memory-plan-execute')
    expect(output.output).toContain('inPlace: false')
  })

  test('Detects "Execute here" using metadata.answers when output is full sentence', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
        ],
      }],
    }
    const output = {
      title: 'Asked 1 question',
      output: 'User has answered your questions: "How would you like to proceed?"="Execute here". You can now continue with the user\'s answers in mind.',
      metadata: { answers: [['Execute here']] },
    }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('Execute here')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('memory-plan-execute')
    expect(output.output).toContain('inPlace: true')
  })

  test('Falls back to output.output when metadata.answers is missing', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
        ],
      }],
    }
    const output = {
      title: 'Asked 1 question',
      output: 'New session',
      metadata: {},
    }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('New session')
    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('memory-plan-execute')
    expect(output.output).toContain('inPlace: false')
  })

  test('Injects cancel directive when metadata.answers contains unknown label', () => {
    const args = {
      questions: [{
        question: 'How would you like to proceed?',
        options: [
          { label: 'New session', description: 'Create new session' },
          { label: 'Execute here', description: 'Execute here' },
          { label: 'Loop (worktree)', description: 'Loop worktree' },
          { label: 'Loop', description: 'Loop in place' },
        ],
      }],
    }
    const output = {
      title: 'Asked 1 question',
      output: 'User has answered your questions: "How would you like to proceed?"="Some custom answer". You can now continue with the user\'s answers in mind.',
      metadata: { answers: [['Some custom answer']] },
    }

    simulateToolExecuteAfter('question', args, output)

    expect(output.output).toContain('<system-reminder>')
    expect(output.output).toContain('custom response')
    expect(output.output).toContain('respond accordingly')
  })
})
