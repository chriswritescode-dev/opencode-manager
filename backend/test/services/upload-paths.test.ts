import { describe, expect, it } from 'vitest'
import { getCommonUploadRootDirectory, isExcludedOpenCodeConfigUploadPath, isOpenCodeConfigUploadPath } from '@opencode-manager/shared/utils'

describe('getCommonUploadRootDirectory', () => {
  it('returns the shared first segment when every path has the same root and at least one is nested', () => {
    expect(getCommonUploadRootDirectory(['opencode/opencode.jsonc', 'opencode/agents/a.md'])).toBe('opencode')
  })

  it('returns null for a single loose file', () => {
    expect(getCommonUploadRootDirectory(['opencode.json'])).toBeNull()
  })

  it('returns null when paths have mixed roots', () => {
    expect(getCommonUploadRootDirectory(['a/x.md', 'b/y.md'])).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(getCommonUploadRootDirectory([])).toBeNull()
  })

  it('returns null when no path is nested', () => {
    expect(getCommonUploadRootDirectory(['opencode', 'opencode'])).toBeNull()
  })
})

describe('isOpenCodeConfigUploadPath', () => {
  it('accepts both config filenames at the root', () => {
    expect(isOpenCodeConfigUploadPath('opencode.json')).toBe(true)
    expect(isOpenCodeConfigUploadPath('opencode.jsonc')).toBe(true)
  })

  it('rejects nested config files', () => {
    expect(isOpenCodeConfigUploadPath('opencode/opencode.json')).toBe(false)
    expect(isOpenCodeConfigUploadPath('forge/opencode.json')).toBe(false)
  })

  it('rejects renamed or non-config files', () => {
    expect(isOpenCodeConfigUploadPath('opencode.json.bak')).toBe(false)
    expect(isOpenCodeConfigUploadPath('opencode.jsonc.bak')).toBe(false)
  })
})

describe('isExcludedOpenCodeConfigUploadPath', () => {
  it('excludes node_modules at any depth', () => {
    expect(isExcludedOpenCodeConfigUploadPath('node_modules/x/package.json')).toBe(true)
    expect(isExcludedOpenCodeConfigUploadPath('plugin/opencode-forge/node_modules/y.js')).toBe(true)
  })

  it('excludes .git segments', () => {
    expect(isExcludedOpenCodeConfigUploadPath('opencode/.git/config')).toBe(true)
  })

  it('excludes .DS_Store files', () => {
    expect(isExcludedOpenCodeConfigUploadPath('plugin/.DS_Store')).toBe(true)
  })

  it('keeps normal config directory files', () => {
    expect(isExcludedOpenCodeConfigUploadPath('skills/quo-api/scripts/quo-spec.sh')).toBe(false)
    expect(isExcludedOpenCodeConfigUploadPath('agents/planner.md')).toBe(false)
    expect(isExcludedOpenCodeConfigUploadPath('opencode.jsonc')).toBe(false)
  })
})
