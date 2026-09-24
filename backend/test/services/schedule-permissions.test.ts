import { describe, expect, it } from 'vitest'
import { DEFAULT_DESTRUCTIVE_BASH_PATTERNS, buildSchedulePermissionRuleset } from '@opencode-manager/shared/schemas'

describe('buildSchedulePermissionRuleset', () => {
  it('returns the allow-all baseline with default deny rules when given null', () => {
    const result = buildSchedulePermissionRuleset(null)

    expect(result[0]).toEqual({ action: '*', resource: '*', effect: 'allow' })
    expect(result).toContainEqual({ action: 'external_directory', resource: '*', effect: 'deny' })
    expect(result).toContainEqual({ action: 'question', resource: '*', effect: 'deny' })
    for (const pattern of DEFAULT_DESTRUCTIVE_BASH_PATTERNS) {
      expect(result).toContainEqual({ action: 'shell', resource: pattern, effect: 'deny' })
    }
  })

  it('denies the question tool when questions are not allowed so unattended runs cannot stall', () => {
    const result = buildSchedulePermissionRuleset({
      allowExternalDirectory: true,
      allowQuestions: false,
      bashDenyPatterns: [],
    })

    expect(result).toEqual([
      { action: '*', resource: '*', effect: 'allow' },
      { action: 'question', resource: '*', effect: 'deny' },
    ])
  })

  it('returns only the allow-all baseline when all permissions are granted', () => {
    const result = buildSchedulePermissionRuleset({
      allowExternalDirectory: true,
      allowQuestions: true,
      bashDenyPatterns: [],
    })

    expect(result).toEqual([{ action: '*', resource: '*', effect: 'allow' }])
  })

  it('includes a single custom shell deny pattern alongside external_directory and question denies', () => {
    const result = buildSchedulePermissionRuleset({
      allowExternalDirectory: false,
      allowQuestions: false,
      bashDenyPatterns: ['rm -rf *'],
    })

    expect(result).toEqual([
      { action: '*', resource: '*', effect: 'allow' },
      { action: 'external_directory', resource: '*', effect: 'deny' },
      { action: 'question', resource: '*', effect: 'deny' },
      { action: 'shell', resource: 'rm -rf *', effect: 'deny' },
    ])
  })
})
