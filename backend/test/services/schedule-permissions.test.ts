import { describe, expect, it } from 'vitest'
import { DEFAULT_DESTRUCTIVE_BASH_PATTERNS, buildSchedulePermissionRuleset } from '@opencode-manager/shared/schemas'

describe('buildSchedulePermissionRuleset', () => {
  it('returns the allow-all baseline with default deny rules when given null', () => {
    const result = buildSchedulePermissionRuleset(null)

    expect(result[0]).toEqual({ permission: '*', pattern: '*', action: 'allow' })
    expect(result).toContainEqual({ permission: 'external_directory', pattern: '*', action: 'deny' })
    expect(result).toContainEqual({ permission: 'question', pattern: '*', action: 'deny' })
    for (const pattern of DEFAULT_DESTRUCTIVE_BASH_PATTERNS) {
      expect(result).toContainEqual({ permission: 'bash', pattern, action: 'deny' })
    }
  })

  it('denies the question tool when questions are not allowed so unattended runs cannot stall', () => {
    const result = buildSchedulePermissionRuleset({
      allowExternalDirectory: true,
      allowQuestions: false,
      bashDenyPatterns: [],
    })

    expect(result).toEqual([
      { permission: '*', pattern: '*', action: 'allow' },
      { permission: 'question', pattern: '*', action: 'deny' },
    ])
  })

  it('returns only the allow-all baseline when all permissions are granted', () => {
    const result = buildSchedulePermissionRuleset({
      allowExternalDirectory: true,
      allowQuestions: true,
      bashDenyPatterns: [],
    })

    expect(result).toEqual([{ permission: '*', pattern: '*', action: 'allow' }])
  })

  it('includes a single custom bash deny pattern alongside external_directory and question denies', () => {
    const result = buildSchedulePermissionRuleset({
      allowExternalDirectory: false,
      allowQuestions: false,
      bashDenyPatterns: ['rm -rf *'],
    })

    expect(result).toEqual([
      { permission: '*', pattern: '*', action: 'allow' },
      { permission: 'external_directory', pattern: '*', action: 'deny' },
      { permission: 'question', pattern: '*', action: 'deny' },
      { permission: 'bash', pattern: 'rm -rf *', action: 'deny' },
    ])
  })
})
