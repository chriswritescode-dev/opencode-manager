import { describe, it, expect } from 'vitest'
import {
  buildGoalAuditPrompt,
  buildGoalContinuationPrompt,
  GOAL_AUDIT_REASON_MAX_CHARS,
  parseGoalVerdict,
} from '../../src/services/session-goal-audit'
import { SESSION_REPLY_MAX_LENGTH } from '../../src/services/session-reply'

describe('parseGoalVerdict', () => {
  it('parses a plain JSON verdict', () => {
    expect(parseGoalVerdict('{"verdict":"done","reason":"The feature shipped."}')).toEqual({
      verdict: 'done',
      reason: 'The feature shipped.',
    })
  })

  it('parses a fenced JSON verdict with surrounding prose', () => {
    const text = [
      'Here is my decision:',
      '```json',
      '{"verdict":"blocked","reason":"Needs a database decision."}',
      '```',
      'Let me know.',
    ].join('\n')

    expect(parseGoalVerdict(text)).toEqual({
      verdict: 'blocked',
      reason: 'Needs a database decision.',
    })
  })

  it('returns null for invalid JSON', () => {
    expect(parseGoalVerdict('not json at all')).toBeNull()
    expect(parseGoalVerdict('{"verdict":')).toBeNull()
  })

  it('returns null for an unknown verdict', () => {
    expect(parseGoalVerdict('{"verdict":"maybe","reason":"unsure"}')).toBeNull()
  })

  it('returns null for a missing or empty reason', () => {
    expect(parseGoalVerdict('{"verdict":"done"}')).toBeNull()
    expect(parseGoalVerdict('{"verdict":"done","reason":"   "}')).toBeNull()
  })

  it('caps the reason length', () => {
    const longReason = 'a'.repeat(GOAL_AUDIT_REASON_MAX_CHARS + 50)
    const parsed = parseGoalVerdict(`{"verdict":"continue","reason":"${longReason}"}`)

    expect(parsed?.verdict).toBe('continue')
    expect(parsed?.reason).toHaveLength(GOAL_AUDIT_REASON_MAX_CHARS)
  })
})

describe('buildGoalAuditPrompt', () => {
  it('includes the objective and reply and asks for JSON only', () => {
    const prompt = buildGoalAuditPrompt({ objective: 'Ship the feature', reply: 'I updated the route.' })

    expect(prompt).toContain('Ship the feature')
    expect(prompt).toContain('I updated the route.')
    expect(prompt).toContain('{"verdict":"continue"|"done"|"blocked","reason":"<one sentence>"}')
  })

  it('marks a missing reply', () => {
    expect(buildGoalAuditPrompt({ objective: 'Ship it', reply: null })).toContain('(no reply yet)')
  })

  it('truncates a long reply with a marker', () => {
    const reply = 'x'.repeat(SESSION_REPLY_MAX_LENGTH + 100)
    const prompt = buildGoalAuditPrompt({ objective: 'Ship it', reply })

    expect(prompt).toContain('[reply truncated]')
    expect(prompt).not.toContain('x'.repeat(SESSION_REPLY_MAX_LENGTH + 1))
  })
})

describe('buildGoalContinuationPrompt', () => {
  it('includes the objective and the progress reason', () => {
    const prompt = buildGoalContinuationPrompt({ objective: 'Ship the feature', reason: 'Tests still fail.' })

    expect(prompt).toContain('Ship the feature')
    expect(prompt).toContain('Tests still fail.')
    expect(prompt).toContain('state exactly what you need')
  })
})
