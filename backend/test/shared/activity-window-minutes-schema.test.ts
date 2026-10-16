import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_WINDOW_MINUTE_OPTIONS,
  ActivityWindowMinutesSchema,
  UserPreferencesSchema,
} from '@opencode-manager/shared/schemas'

describe('ActivityWindowMinutesSchema', () => {
  it.each(ACTIVITY_WINDOW_MINUTE_OPTIONS)('accepts the configured option %s', (minutes) => {
    expect(ActivityWindowMinutesSchema.safeParse(minutes).success).toBe(true)
  })

  it.each([5, 45, 2000, 30.5])('rejects %s', (minutes) => {
    expect(ActivityWindowMinutesSchema.safeParse(minutes).success).toBe(false)
  })

  it('rejects a non-option value through UserPreferencesSchema', () => {
    expect(UserPreferencesSchema.shape.activityWindowMinutes.safeParse(45).success).toBe(false)
    expect(UserPreferencesSchema.shape.activityWindowMinutes.safeParse(60).success).toBe(true)
  })
})
