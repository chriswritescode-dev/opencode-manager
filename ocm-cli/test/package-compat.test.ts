import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  compareParsedSemver,
  normalizeSemver,
  parseSemver,
  type Semver,
} from '@opencode-manager/shared/utils'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  version: string
  devDependencies: Record<string, string>
  peerDependencies: Record<string, string>
  peerDependenciesMeta: Record<string, { optional?: boolean }>
}

const PINNED_PACKAGES = ['@opentui/core', '@opentui/solid', '@opencode/theme'] as const

/**
 * Reads and parses a package manifest from an absolute path.
 */
function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

/**
 * Guards a version string as a stable semver release.
 *
 * Returns the parsed version together with its normalized `major.minor.patch`
 * form, or `null` when the input is not a stable release version.
 */
function readStableSemver(version: string): { semver: Semver; normalized: string } | null {
  const semver = parseSemver(normalizeSemver(version))
  if (!semver || semver.prerelease.length > 0) {
    return null
  }
  return { semver, normalized: `${semver.major}.${semver.minor}.${semver.patch}` }
}

/**
 * Derives the minor-line peer range for a plugin's exact dependency pin.
 *
 * A `0.x.y` pin is constrained to its minor line from the pinned patch; a pin
 * at major `1` or above is constrained to its major line.
 */
function deriveMinorLineRange(pin: string): string {
  const stable = readStableSemver(pin)
  if (!stable) {
    throw new Error(`Cannot derive a peer range from pin "${pin}"`)
  }
  const { major, minor, patch } = stable.semver
  if (major === 0) {
    return `>=0.${minor}.${patch} <0.${minor + 1}.0`
  }
  return `>=${stable.normalized} <${major + 1}.0.0`
}

/**
 * Resolves the minimum version floor from a plugin peer range.
 *
 * Accepts an exact pin or a bare `>=x.y.z` lower bound; any other range cannot
 * be reduced to a floor.
 */
function resolvePeerFloor(peer: string): string {
  const exact = readStableSemver(peer)
  if (exact) {
    return exact.normalized
  }
  const lowerBound = /^>=\s*(\S+)$/.exec(peer.trim())
  if (lowerBound) {
    const floor = readStableSemver(lowerBound[1])
    if (floor) {
      return floor.normalized
    }
  }
  throw new Error(`Cannot derive a peer floor from "${peer}"`)
}

const ocmManifest = readManifest(join(__dirname, '..', 'package.json'))
const pluginManifest = readManifest(
  join(__dirname, '..', 'node_modules', '@opencode', 'plugin', 'package.json'),
)

describe('ocm-cli package compatibility with the installed @opencode/plugin', () => {
  for (const name of PINNED_PACKAGES) {
    it(`${name} matches the plugin peer floor`, () => {
      const floor = resolvePeerFloor(pluginManifest.peerDependencies[name])
      expect(ocmManifest.devDependencies[name]).toBe(floor)
      expect(ocmManifest.peerDependencies[name]).toBe(deriveMinorLineRange(floor))
      expect(ocmManifest.peerDependenciesMeta[name]?.optional).toBe(true)
    })
  }

  it('rejects peer ranges without a derivable floor', () => {
    expect(() => resolvePeerFloor('^0.8.0')).toThrow('Cannot derive a peer floor from "^0.8.0"')
    expect(() => resolvePeerFloor('>=0.8.0 <1')).toThrow(
      'Cannot derive a peer floor from ">=0.8.0 <1"',
    )
  })

  it('normalizes version prefixes and build metadata when resolving floors', () => {
    expect(resolvePeerFloor('v0.8.0')).toBe('0.8.0')
    expect(resolvePeerFloor('>=1.9.16+build.5')).toBe('1.9.16')
  })

  it('derives a patch-level floor inside a 0.x minor line', () => {
    expect(deriveMinorLineRange('0.8.5')).toBe('>=0.8.5 <0.9.0')
    expect(deriveMinorLineRange('0.8.0')).toBe('>=0.8.0 <0.9.0')
  })

  it('solid-js peer floor matches the @opentui/solid babel preset requirement', () => {
    expect(ocmManifest.peerDependencies['solid-js']).toBe('>=1.9.16')
    expect(ocmManifest.peerDependenciesMeta['solid-js']?.optional).toBe(true)
    const devPin = parseSemver(ocmManifest.devDependencies['solid-js'])
    if (!devPin) {
      throw new Error('solid-js devDependency is not a valid semver version')
    }
    expect(
      compareParsedSemver(devPin, { major: 1, minor: 9, patch: 16, prerelease: [] }),
    ).toBeGreaterThanOrEqual(0)
  })

  it('@opencode/plugin devDependency matches the installed plugin version', () => {
    expect(ocmManifest.devDependencies['@opencode/plugin']).toBe(pluginManifest.version)
  })
})
