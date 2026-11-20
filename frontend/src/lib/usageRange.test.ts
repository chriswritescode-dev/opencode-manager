import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GLOBAL_USAGE_RANGE,
  DEFAULT_SESSION_USAGE_RANGE,
  USAGE_RANGE_LABELS,
  USAGE_RANGE_PRESETS,
  describeUnresolvedUsageRange,
  isWithinUsageRange,
  rangeHasDailyActivity,
  resolveUsageRange,
  usageRangeSelectionSchema,
} from './usageRange'
import type { UsageRangePreset, UsageRangeSelection } from './usageRange'

const NOW = 1_000_000_000

describe('USAGE_RANGE_PRESETS', () => {
  it('lists every preset in display order', () => {
    expect([...USAGE_RANGE_PRESETS]).toEqual([
      '15m',
      '1h',
      '4h',
      '8h',
      '24h',
      '48h',
      '7d',
      '30d',
      '90d',
      'all',
      'custom',
    ])
  })
})

describe('USAGE_RANGE_LABELS', () => {
  it('labels every preset', () => {
    expect(USAGE_RANGE_LABELS).toEqual({
      '15m': 'Last 15 minutes',
      '1h': 'Last hour',
      '4h': 'Last 4 hours',
      '8h': 'Last 8 hours',
      '24h': 'Last 24 hours',
      '48h': 'Last 48 hours',
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
      '90d': 'Last 90 days',
      all: 'All time',
      custom: 'Custom',
    })
  })

  it('has a label for each preset in the preset list', () => {
    for (const preset of USAGE_RANGE_PRESETS) {
      expect(USAGE_RANGE_LABELS[preset satisfies UsageRangePreset]).toEqual(expect.any(String))
    }
  })
})

describe('defaults', () => {
  it('defaults the global range to four hours and sessions to all time', () => {
    expect(DEFAULT_GLOBAL_USAGE_RANGE).toEqual({ preset: '4h' })
    expect(DEFAULT_SESSION_USAGE_RANGE).toEqual({ preset: 'all' })
  })
})

describe('resolveUsageRange', () => {
  it('resolves the four hour preset to exact bounds', () => {
    expect(resolveUsageRange({ preset: '4h' }, NOW)).toEqual({
      from: NOW - 14_400_000,
      to: NOW,
    })
  })

  it('resolves each relative preset duration', () => {
    const durations: Array<[Exclude<UsageRangePreset, 'all' | 'custom'>, number]> = [
      ['15m', 900_000],
      ['1h', 3_600_000],
      ['4h', 14_400_000],
      ['8h', 28_800_000],
      ['24h', 86_400_000],
      ['48h', 172_800_000],
      ['7d', 604_800_000],
      ['30d', 2_592_000_000],
      ['90d', 7_776_000_000],
    ]

    for (const [preset, duration] of durations) {
      expect(resolveUsageRange({ preset }, NOW)).toEqual({ from: NOW - duration, to: NOW })
    }
  })

  it('resolves all time to an unbounded range', () => {
    expect(resolveUsageRange({ preset: 'all' }, NOW)).toEqual({})
  })

  it('resolves a complete custom range to its bounds', () => {
    expect(resolveUsageRange({ preset: 'custom', from: 10, to: 20 }, NOW)).toEqual({
      from: 10,
      to: 20,
    })
  })

  it('rejects custom ranges with a missing bound', () => {
    expect(resolveUsageRange({ preset: 'custom', from: null, to: 20 }, NOW)).toBeNull()
    expect(resolveUsageRange({ preset: 'custom', from: 10, to: null }, NOW)).toBeNull()
  })

  it('rejects custom ranges that are empty or reversed', () => {
    expect(resolveUsageRange({ preset: 'custom', from: 10, to: 10 }, NOW)).toBeNull()
    expect(resolveUsageRange({ preset: 'custom', from: 20, to: 10 }, NOW)).toBeNull()
  })
})

describe('describeUnresolvedUsageRange', () => {
  it('asks for both bounds when a custom range is incomplete', () => {
    const message = 'Choose a start and end time to see usage for a custom range.'
    expect(describeUnresolvedUsageRange({ preset: 'custom', from: null, to: null })).toBe(message)
    expect(describeUnresolvedUsageRange({ preset: 'custom', from: 10, to: null })).toBe(message)
    expect(describeUnresolvedUsageRange({ preset: 'custom', from: null, to: 20 })).toBe(message)
  })

  it('reports a reversed or empty custom range', () => {
    expect(describeUnresolvedUsageRange({ preset: 'custom', from: 20, to: 10 })).toBe(
      'End must be after start.',
    )
    expect(describeUnresolvedUsageRange({ preset: 'custom', from: 10, to: 10 })).toBe(
      'End must be after start.',
    )
  })

  it('falls back to asking for a custom range for presets', () => {
    expect(describeUnresolvedUsageRange({ preset: 'all' })).toBe(
      'Choose a start and end time to see usage for a custom range.',
    )
  })
})

describe('rangeHasDailyActivity', () => {
  it('enables daily activity for multi-day presets and all time', () => {
    for (const preset of ['7d', '30d', '90d', 'all'] as const) {
      expect(rangeHasDailyActivity({ preset }, NOW)).toBe(true)
    }
  })

  it('disables daily activity for short presets', () => {
    for (const preset of ['15m', '1h', '4h', '8h', '24h', '48h'] as const) {
      expect(rangeHasDailyActivity({ preset }, NOW)).toBe(false)
    }
  })

  it('enables daily activity for custom ranges spanning at least 48 hours', () => {
    const fortyEightHours: UsageRangeSelection = { preset: 'custom', from: 0, to: 172_800_000 }
    expect(rangeHasDailyActivity(fortyEightHours, NOW)).toBe(true)
  })

  it('disables daily activity for custom ranges under 48 hours', () => {
    const fortySevenHours: UsageRangeSelection = { preset: 'custom', from: 0, to: 169_200_000 }
    expect(rangeHasDailyActivity(fortySevenHours, NOW)).toBe(false)
  })

  it('disables daily activity for incomplete custom ranges', () => {
    expect(rangeHasDailyActivity({ preset: 'custom', from: null, to: 20 }, NOW)).toBe(false)
    expect(rangeHasDailyActivity({ preset: 'custom', from: 10, to: null }, NOW)).toBe(false)
  })
})

describe('isWithinUsageRange', () => {
  it('checks both bounds inclusively', () => {
    expect(isWithinUsageRange(5, { from: 5, to: 10 })).toBe(true)
    expect(isWithinUsageRange(10, { from: 5, to: 10 })).toBe(true)
    expect(isWithinUsageRange(7, { from: 5, to: 10 })).toBe(true)
    expect(isWithinUsageRange(4, { from: 5, to: 10 })).toBe(false)
    expect(isWithinUsageRange(11, { from: 5, to: 10 })).toBe(false)
  })

  it('treats a missing lower bound as open', () => {
    expect(isWithinUsageRange(-1_000, { to: 10 })).toBe(true)
    expect(isWithinUsageRange(11, { to: 10 })).toBe(false)
  })

  it('treats a missing upper bound as open', () => {
    expect(isWithinUsageRange(1_000, { from: 5 })).toBe(true)
    expect(isWithinUsageRange(4, { from: 5 })).toBe(false)
  })

  it('treats an empty range as unbounded', () => {
    expect(isWithinUsageRange(0, {})).toBe(true)
  })
})

describe('usageRangeSelectionSchema', () => {
  it('accepts preset selections', () => {
    expect(usageRangeSelectionSchema.parse({ preset: '4h' })).toEqual({ preset: '4h' })
    expect(usageRangeSelectionSchema.parse({ preset: 'all' })).toEqual({ preset: 'all' })
  })

  it('accepts complete custom selections with nullable bounds', () => {
    expect(usageRangeSelectionSchema.parse({ preset: 'custom', from: 1, to: 2 })).toEqual({
      preset: 'custom',
      from: 1,
      to: 2,
    })
    expect(
      usageRangeSelectionSchema.parse({ preset: 'custom', from: null, to: null }),
    ).toEqual({ preset: 'custom', from: null, to: null })
  })

  it('rejects unknown presets', () => {
    expect(usageRangeSelectionSchema.safeParse({ preset: '2h' }).success).toBe(false)
    expect(usageRangeSelectionSchema.safeParse({ preset: '' }).success).toBe(false)
  })

  it('rejects custom selections without bounds', () => {
    expect(usageRangeSelectionSchema.safeParse({ preset: 'custom' }).success).toBe(false)
    expect(usageRangeSelectionSchema.safeParse({ preset: 'custom', from: 1 }).success).toBe(false)
    expect(usageRangeSelectionSchema.safeParse({ preset: 'custom', to: 2 }).success).toBe(false)
  })

  it('rejects non-numeric bounds', () => {
    expect(
      usageRangeSelectionSchema.safeParse({ preset: 'custom', from: '1', to: 2 }).success,
    ).toBe(false)
    expect(
      usageRangeSelectionSchema.safeParse({ preset: 'custom', from: 1, to: '2' }).success,
    ).toBe(false)
  })

  it('rejects corrupt stored bounds outside the supported timestamp range', () => {
    expect(usageRangeSelectionSchema.safeParse({ preset: 'custom', from: 1e20, to: 2 }).success).toBe(
      false,
    )
    expect(
      usageRangeSelectionSchema.safeParse({ preset: 'custom', from: -1, to: 2 }).success,
    ).toBe(false)
    expect(
      usageRangeSelectionSchema.safeParse({ preset: 'custom', from: 1, to: 1.5 }).success,
    ).toBe(false)
    expect(
      usageRangeSelectionSchema.safeParse({
        preset: 'custom',
        from: 1,
        to: 8_640_000_000_000_001,
      }).success,
    ).toBe(false)
    expect(
      usageRangeSelectionSchema.safeParse({
        preset: 'custom',
        from: 0,
        to: 8_640_000_000_000_000,
      }).success,
    ).toBe(true)
  })
})
