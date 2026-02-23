import { describe, test, expect } from 'bun:test'
import {
  buildCustomCompactionPrompt,
  formatPlanningState,
  formatCompactionDiagnostics,
  estimateTokens,
  trimToTokenBudget,
} from '../src/hooks/compaction-utils'
import type { PlanningState } from '../src/types'

describe('buildCustomCompactionPrompt', () => {
  test('returns a non-empty string', () => {
    const prompt = buildCustomCompactionPrompt()
    expect(prompt).toBeTruthy()
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(100)
  })

  test('contains required sections', () => {
    const prompt = buildCustomCompactionPrompt()
    expect(prompt).toContain('## CRITICAL - Preserve These Verbatim')
    expect(prompt).toContain('### Active Task')
    expect(prompt).toContain('### Planning State')
    expect(prompt).toContain('### Key Context')
    expect(prompt).toContain('### Active Files')
    expect(prompt).toContain('### Next Steps')
  })
})

describe('formatPlanningState', () => {
  test('returns null for null input', () => {
    const result = formatPlanningState(null)
    expect(result).toBeNull()
  })

  test('formats basic planning state', () => {
    const planningState: PlanningState = {
      objective: 'Implement feature X',
      current: 'Writing code',
      next: 'Run tests',
    }

    const result = formatPlanningState(planningState)

    expect(result).toContain('**Objective:** Implement feature X')
    expect(result).toContain('**Current:** Writing code')
    expect(result).toContain('**Next:** Run tests')
  })

  test('formats phases with status', () => {
    const planningState: PlanningState = {
      objective: 'Test',
      phases: [
        { title: 'Phase 1', status: 'completed', notes: 'Done' },
        { title: 'Phase 2', status: 'in_progress' },
        { title: 'Phase 3', status: 'pending' },
      ],
    }

    const result = formatPlanningState(planningState)

    expect(result).toContain('### Phases:')
    expect(result).toContain('[x] Phase 1 - Done')
    expect(result).toContain('[~] Phase 2')
    expect(result).toContain('[ ] Phase 3')
  })

  test('formats findings', () => {
    const planningState: PlanningState = {
      objective: 'Test',
      findings: ['Found bug A', 'Performance issue'],
    }

    const result = formatPlanningState(planningState)

    expect(result).toContain('### Key Findings:')
    expect(result).toContain('- Found bug A')
    expect(result).toContain('- Performance issue')
  })

  test('formats errors to avoid', () => {
    const planningState: PlanningState = {
      objective: 'Test',
      errors: ['Memory leak', 'Race condition'],
    }

    const result = formatPlanningState(planningState)

    expect(result).toContain('### Errors to Avoid:')
    expect(result).toContain('- Memory leak')
    expect(result).toContain('- Race condition')
  })
})

describe('formatCompactionDiagnostics', () => {
  test('returns empty string for zero counts', () => {
    const result = formatCompactionDiagnostics({
      planningPhases: 0,
      conventions: 0,
      decisions: 0,
      tokensInjected: 0,
    })
    expect(result).toBe('')
  })

  test('formats single items correctly', () => {
    const result = formatCompactionDiagnostics({
      planningPhases: 1,
      conventions: 0,
      decisions: 0,
      tokensInjected: 100,
    })
    expect(result).toContain('1 planning phase')
    expect(result).toContain('~100 tokens injected')
  })

  test('formats multiple items correctly', () => {
    const result = formatCompactionDiagnostics({
      planningPhases: 3,
      conventions: 5,
      decisions: 2,
      tokensInjected: 800,
    })
    expect(result).toContain('3 planning phases')
    expect(result).toContain('5 conventions')
    expect(result).toContain('2 decisions')
    expect(result).toContain('~800 tokens injected')
  })
})

describe('estimateTokens', () => {
  test('estimates based on character count', () => {
    const text = 'a'.repeat(400)
    const tokens = estimateTokens(text)
    expect(tokens).toBe(100)
  })

  test('handles empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })
})

describe('trimToTokenBudget', () => {
  test('returns original if under budget', () => {
    const text = 'short text'
    const result = trimToTokenBudget(text, 100, 'high')
    expect(result).toBe('short text')
  })

  test('trims from end for low priority', () => {
    const text = 'line1\nline2\nline3\nline4\nline5'
    const result = trimToTokenBudget(text, 1, 'low')
    expect(result).toContain('...')
    expect(result.startsWith('line')).toBe(true)
  })

  test('trims from middle for medium priority', () => {
    const text = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10'
    const result = trimToTokenBudget(text, 2, 'medium')
    expect(result).toContain('...')
  })

  test('preserves high priority content', () => {
    const text = 'line1\nline2\nline3'
    const result = trimToTokenBudget(text, 1, 'high')
    expect(result).toContain('...')
  })
})
