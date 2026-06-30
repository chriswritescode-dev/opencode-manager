import { describe, expect, it } from 'vitest'
import { DEFAULT_DESTRUCTIVE_BASH_PATTERNS, buildSchedulePermissionRuleset } from '@opencode-manager/shared/schemas'

describe('buildSchedulePermissionRuleset', () => {
  it('returns the allow-all baseline with default deny rules when given null', () => {
    const result = buildSchedulePermissionRuleset(null)

    expect(result['*']).toBe('allow')
    expect(result.external_directory).toBe('deny')
    for (const pattern of DEFAULT_DESTRUCTIVE_BASH_PATTERNS) {
      expect(result.bash?.[pattern]).toBe('deny')
    }
  })

  it('returns only the allow-all baseline when all permissions are granted', () => {
    const result = buildSchedulePermissionRuleset({ allowExternalDirectory: true, bashDenyPatterns: [] })

    expect(result).toEqual({ '*': 'allow' })
  })

  it('includes a single custom bash deny pattern alongside external_directory deny', () => {
    const result = buildSchedulePermissionRuleset({ allowExternalDirectory: false, bashDenyPatterns: ['rm -rf *'] })

    expect(result).toEqual({
      '*': 'allow',
      external_directory: 'deny',
      bash: { 'rm -rf *': 'deny' },
    })
  })
})
