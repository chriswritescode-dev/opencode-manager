import { describe, expect, it } from 'vitest'
import { compareSemver, normalizeSemver, parseSemver } from '@opencode-manager/shared/utils'

describe('semver', () => {
  describe('normalizeSemver', () => {
    it('trims surrounding whitespace and a leading v', () => {
      expect(normalizeSemver(' v2.0.15\n')).toBe('2.0.15')
      expect(normalizeSemver('2.0.15')).toBe('2.0.15')
    })
  })

  describe('parseSemver', () => {
    it('parses version components and prerelease identifiers', () => {
      expect(parseSemver('v2.1.3-beta.4')).toEqual({ major: 2, minor: 1, patch: 3, prerelease: ['beta', 4] })
      expect(parseSemver('2.0.15+build.5')).toEqual({ major: 2, minor: 0, patch: 15, prerelease: [] })
    })

    it('rejects incomplete and malformed versions', () => {
      expect(parseSemver('2.1')).toBeNull()
      expect(parseSemver('2garbage')).toBeNull()
      expect(parseSemver('02.0.15')).toBeNull()
      expect(parseSemver('')).toBeNull()
    })
  })

  describe('compareSemver', () => {
    it('orders versions by semver precedence', () => {
      expect(compareSemver('2.0.15', '2.0.14')).toBeGreaterThan(0)
      expect(compareSemver('v2.0.15', '2.0.15')).toBe(0)
      expect(compareSemver('2.0.9', '2.0.10')).toBeLessThan(0)
      expect(compareSemver('2.1.0-beta.1', '2.1.0')).toBeLessThan(0)
      expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0)
    })

    it('throws on invalid versions', () => {
      expect(() => compareSemver('invalid', '2.0.15')).toThrow(/invalid/)
      expect(() => compareSemver('2.0.15', 'not-a-version')).toThrow(/invalid/)
    })
  })
})
