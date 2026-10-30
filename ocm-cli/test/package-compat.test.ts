import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSemver } from '@opencode-manager/shared/utils'
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
 * Derives the minor-line peer range for a plugin's exact dependency pin.
 *
 * A `0.x.y` pin is constrained to its minor line; a pin at major `1` or above
 * is constrained to its major line.
 */
function deriveMinorLineRange(pin: string): string {
  const parsed = parseSemver(pin)
  if (!parsed || parsed.prerelease.length > 0) {
    throw new Error(`Cannot derive a peer range from pin "${pin}"`)
  }
  const { major, minor } = parsed
  if (major === 0) {
    return `>=0.${minor}.0 <0.${minor + 1}.0`
  }
  return `>=${pin} <${major + 1}.0.0`
}

const ocmManifest = readManifest(join(__dirname, '..', 'package.json'))
const pluginManifest = readManifest(
  join(__dirname, '..', 'node_modules', '@opencode', 'plugin', 'package.json'),
)

describe('ocm-cli package compatibility with the installed @opencode/plugin', () => {
  for (const name of PINNED_PACKAGES) {
    it(`${name} matches the plugin peer pin`, () => {
      const pluginPin = pluginManifest.peerDependencies[name]
      expect(ocmManifest.devDependencies[name]).toBe(pluginPin)
      expect(ocmManifest.peerDependencies[name]).toBe(deriveMinorLineRange(pluginPin))
      expect(ocmManifest.peerDependenciesMeta[name]?.optional).toBe(true)
    })
  }

  it('@opencode/plugin devDependency matches the installed plugin version', () => {
    expect(ocmManifest.devDependencies['@opencode/plugin']).toBe(pluginManifest.version)
  })
})
