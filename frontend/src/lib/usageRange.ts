import { z } from 'zod'

export const USAGE_RANGE_PRESETS = [
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
] as const

export type UsageRangePreset = (typeof USAGE_RANGE_PRESETS)[number]

type RelativeUsageRangePreset = Exclude<UsageRangePreset, 'all' | 'custom'>
type BoundedUsageRangePreset = Exclude<UsageRangePreset, 'custom'>

export const USAGE_RANGE_LABELS: Record<UsageRangePreset, string> = {
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
}

export type UsageRangeSelection =
  | { preset: Exclude<UsageRangePreset, 'custom'> }
  | { preset: 'custom'; from: number | null; to: number | null }

const RELATIVE_USAGE_RANGE_DURATIONS: Record<RelativeUsageRangePreset, number> = {
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '8h': 28_800_000,
  '24h': 86_400_000,
  '48h': 172_800_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
  '90d': 7_776_000_000,
}

const DAILY_ACTIVITY_PRESETS: ReadonlySet<UsageRangePreset> = new Set([
  '7d',
  '30d',
  '90d',
  'all',
])

const MIN_DAILY_ACTIVITY_SPAN_MS = 172_800_000

const BOUNDED_USAGE_RANGE_PRESETS = USAGE_RANGE_PRESETS.filter(
  (preset): preset is BoundedUsageRangePreset => preset !== 'custom',
)

const USAGE_RANGE_MAX_TIMESTAMP = 8_640_000_000_000_000

const CustomUsageRangeSelectionSchema = z.object({
  preset: z.literal('custom'),
  from: z.number().int().min(0).max(USAGE_RANGE_MAX_TIMESTAMP).nullable(),
  to: z.number().int().min(0).max(USAGE_RANGE_MAX_TIMESTAMP).nullable(),
})

export const usageRangeSelectionSchema: z.ZodType<UsageRangeSelection> = z.discriminatedUnion(
  'preset',
  [
    z.object({ preset: z.enum(BOUNDED_USAGE_RANGE_PRESETS) }),
    CustomUsageRangeSelectionSchema,
  ],
)

export const DEFAULT_GLOBAL_USAGE_RANGE: UsageRangeSelection = { preset: '4h' }

export const DEFAULT_SESSION_USAGE_RANGE: UsageRangeSelection = { preset: 'all' }

export type ResolvedUsageRange = { from?: number; to?: number }

export function resolveUsageRange(
  selection: UsageRangeSelection,
  now: number,
): ResolvedUsageRange | null {
  if (selection.preset === 'custom') {
    if (selection.from === null || selection.to === null) return null
    if (selection.from >= selection.to) return null
    return { from: selection.from, to: selection.to }
  }

  if (selection.preset === 'all') return {}

  return { from: now - RELATIVE_USAGE_RANGE_DURATIONS[selection.preset], to: now }
}

export function describeUnresolvedUsageRange(selection: UsageRangeSelection): string {
  if (selection.preset === 'custom') {
    if (selection.from !== null && selection.to !== null && selection.from >= selection.to) {
      return 'End must be after start.'
    }
  }
  return 'Choose a start and end time to see usage for a custom range.'
}

export function rangeHasDailyActivity(selection: UsageRangeSelection, now: number): boolean {
  if (selection.preset !== 'custom') return DAILY_ACTIVITY_PRESETS.has(selection.preset)

  const range = resolveUsageRange(selection, now)
  if (range?.from === undefined || range.to === undefined) return false
  return range.to - range.from >= MIN_DAILY_ACTIVITY_SPAN_MS
}

export function isWithinUsageRange(time: number, range: ResolvedUsageRange): boolean {
  if (range.from !== undefined && time < range.from) return false
  if (range.to !== undefined && time > range.to) return false
  return true
}
