import { describe, expect, it } from 'vitest'
import { DEFAULT_DESTRUCTIVE_BASH_PATTERNS, buildSchedulePermissionRuleset } from '@opencode-manager/shared/schemas'

describe('buildSchedulePermissionRuleset', () => {
  it('returns default deny rules when given null', () => {
    const result = buildSchedulePermissionRuleset(null)

    expect(result[0]).toEqual({ permission: '*', pattern: '*', action: 'allow' })
    expect(result).toContainEqual({ permission: 'external_directory', pattern: '*', action: 'deny' })
    for (const pattern of DEFAULT_DESTRUCTIVE_BASH_PATTERNS) {
      expect(result).toContainEqual({ permission: 'bash', pattern, action: 'deny' })
    }
  })

  it('returns only the allow-all rule when all permissions are granted', () => {
    const result = buildSchedulePermissionRuleset({ allowExternalDirectory: true, bashDenyPatterns: [] })

    expect(result).toEqual([{ permission: '*', pattern: '*', action: 'allow' }])
  })

  it('includes a single custom bash deny pattern alongside external_directory deny', () => {
    const result = buildSchedulePermissionRuleset({ allowExternalDirectory: false, bashDenyPatterns: ['rm -rf *'] })

    expect(result).toEqual([
      { permission: '*', pattern: '*', action: 'allow' },
      { permission: 'external_directory', pattern: '*', action: 'deny' },
      { permission: 'bash', pattern: 'rm -rf *', action: 'deny' },
    ])
  })
})
