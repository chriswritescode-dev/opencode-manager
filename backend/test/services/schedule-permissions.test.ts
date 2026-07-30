import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESTRUCTIVE_BASH_PATTERNS,
  buildSchedulePermissionRuleset,
  evaluateSchedulePermission,
} from '@opencode-manager/shared/schemas'

describe('buildSchedulePermissionRuleset', () => {
  it('returns the allow-all baseline with default deny rules when given null', () => {
    const result = buildSchedulePermissionRuleset(null)

    expect(result[0]).toEqual({ permission: '*', pattern: '*', action: 'allow' })
    expect(result).toContainEqual({ permission: 'external_directory', pattern: '*', action: 'deny' })
    for (const pattern of DEFAULT_DESTRUCTIVE_BASH_PATTERNS) {
      expect(result).toContainEqual({ permission: 'bash', pattern, action: 'deny' })
    }
  })

  it('returns only the allow-all baseline when all permissions are granted', () => {
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

describe('evaluateSchedulePermission', () => {
  it('denies bash sudo commands with the default ruleset', () => {
    const ruleset = buildSchedulePermissionRuleset(null)
    expect(evaluateSchedulePermission(ruleset, 'bash', ['sudo rm -rf /'])).toBe('deny')
  })

  it('allows benign bash commands with the default ruleset', () => {
    const ruleset = buildSchedulePermissionRuleset(null)
    expect(evaluateSchedulePermission(ruleset, 'bash', ['git status'])).toBe('allow')
  })

  it('denies external_directory access with the default ruleset', () => {
    const ruleset = buildSchedulePermissionRuleset(null)
    expect(evaluateSchedulePermission(ruleset, 'external_directory', ['/etc'])).toBe('deny')
  })

  it('allows external_directory when allowExternalDirectory is true', () => {
    const ruleset = buildSchedulePermissionRuleset({ allowExternalDirectory: true, bashDenyPatterns: [] })
    expect(evaluateSchedulePermission(ruleset, 'external_directory', ['/some/path'])).toBe('allow')
  })

  it('denies when at least one resource matches a deny pattern', () => {
    const ruleset = buildSchedulePermissionRuleset(null)
    expect(evaluateSchedulePermission(ruleset, 'bash', ['git status', 'sudo rm -rf /'])).toBe('deny')
  })

  it('asks for an unmatched action with an empty ruleset', () => {
    expect(evaluateSchedulePermission([], 'bash', ['git status'])).toBe('ask')
  })
})
