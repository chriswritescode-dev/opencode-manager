import { describe, test, expect } from 'vitest'
import { stripPromiseTags } from '../src/utils/strip-promise-tags'

describe('stripPromiseTags', () => {
  test('returns unchanged text when no promise tags present', () => {
    const text = 'This is a normal plan without any special tags'
    const { cleaned, stripped } = stripPromiseTags(text)
    expect(cleaned).toBe(text)
    expect(stripped).toBe(false)
  })

  test('strips bare promise tags', () => {
    const text = 'Plan text here <promise>All phases of the plan have been completed successfully</promise>'
    const { cleaned, stripped } = stripPromiseTags(text)
    expect(cleaned).toBe('Plan text here')
    expect(stripped).toBe(true)
    expect(cleaned).not.toContain('<promise>')
  })

  test('strips full instruction block with promise tags', () => {
    const text = `Plan text here

---

**IMPORTANT - Completion Signal:** When you have completed ALL phases of this plan successfully, you MUST output the following tag exactly: <promise>All phases of the plan have been completed successfully</promise>

Do NOT output this tag until every phase is truly complete. The loop will continue until this signal is detected.`
    const { cleaned, stripped } = stripPromiseTags(text)
    expect(cleaned).toBe('Plan text here')
    expect(stripped).toBe(true)
    expect(cleaned).not.toContain('<promise>')
    expect(cleaned).not.toContain('Completion Signal')
  })

  test('preserves plan content before promise tags', () => {
    const plan = `## Phase 1
Do something

## Phase 2
Do something else

<promise>DONE</promise>`
    const { cleaned, stripped } = stripPromiseTags(plan)
    expect(cleaned).toContain('## Phase 1')
    expect(cleaned).toContain('## Phase 2')
    expect(cleaned).not.toContain('<promise>')
    expect(stripped).toBe(true)
  })

  test('handles promise tags with multiline content', () => {
    const text = 'Plan <promise>\nMulti\nLine\nContent\n</promise> end'
    const { cleaned, stripped } = stripPromiseTags(text)
    expect(cleaned).not.toContain('<promise>')
    expect(stripped).toBe(true)
  })
})
