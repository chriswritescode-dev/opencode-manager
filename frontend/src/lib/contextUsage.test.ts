import { describe, expect, it } from 'vitest'
import {
  contextUsageAccessibleLabel,
  contextUsageTone,
  formatCompactTokens,
  formatContextUsage,
} from './contextUsage'

describe('contextUsageTone', () => {
  it('keeps usage below 50 percent in the success tone', () => {
    expect(contextUsageTone(0)).toBe('success')
    expect(contextUsageTone(49)).toBe('success')
  })

  it('moves to warning from 50 percent and destructive from 80 percent', () => {
    expect(contextUsageTone(50)).toBe('warning')
    expect(contextUsageTone(79)).toBe('warning')
    expect(contextUsageTone(80)).toBe('destructive')
    expect(contextUsageTone(140)).toBe('destructive')
  })

  it('treats an unknown percentage as success', () => {
    expect(contextUsageTone(null)).toBe('success')
  })
})

describe('formatCompactTokens', () => {
  it('prints exact counts below a thousand', () => {
    expect(formatCompactTokens(999)).toBe('999')
  })

  it('abbreviates thousands and millions', () => {
    expect(formatCompactTokens(12000)).toBe('12k')
    expect(formatCompactTokens(999999)).toBe('1M')
    expect(formatCompactTokens(1300000)).toBe('1.3M')
  })
})

describe('formatContextUsage', () => {
  it('prefers the percentage when the limit is known', () => {
    expect(formatContextUsage({ totalTokens: 84000, usagePercentage: 42, contextLimit: 200000 })).toBe('42%')
  })

  it('falls back to compact tokens without a limit', () => {
    expect(formatContextUsage({ totalTokens: 12400, usagePercentage: null, contextLimit: null })).toBe('12k')
  })
})

describe('contextUsageAccessibleLabel', () => {
  it('announces the percentage when the limit is known', () => {
    expect(contextUsageAccessibleLabel({ totalTokens: 84000, usagePercentage: 42, contextLimit: 200000 }))
      .toBe('context 42% used')
  })

  it('announces compact tokens without a limit', () => {
    expect(contextUsageAccessibleLabel({ totalTokens: 12400, usagePercentage: null, contextLimit: null }))
      .toBe('context 12k tokens used')
  })
})
