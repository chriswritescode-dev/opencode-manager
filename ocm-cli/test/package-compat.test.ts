import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compareSemver, parseSemver } from '@opencode-manager/shared/utils'
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
 * Reads the version of a dependency installed in ocm-cli's node_modules.
 */
function installedVersion(name: string): string {
  return readManifest(join(__dirname, '..', 'node_modules', name, 'package.json')).version
}

/**
 * Derives the minor-line peer range for an exact dependency version.
 *
 * A `0.x.y` version is constrained to its minor line; a version at major `1` or above
 * is constrained to its major line.
 */
function deriveMinorLineRange(version: string): string {
  const parsed = parseSemver(version)
  if (!parsed || parsed.prerelease.length > 0) {
    throw new Error(`Cannot derive a peer range from version "${version}"`)
  }
  const { major, minor } = parsed
  if (major === 0) {
    return `>=0.${minor}.0 <0.${minor + 1}.0`
  }
  return `>=${version} <${major + 1}.0.0`
}

/**
 * Asserts that an installed version satisfies a plugin peer declaration,
 * accepting both an exact peer pin and an open `>=` floor.
 */
function expectVersionSatisfiesPeer(version: string, peer: string): void {
  if (peer.startsWith('>=')) {
    expect(compareSemver(version, peer.slice(2).trim())).toBeGreaterThanOrEqual(0)
    return
  }
  expect(version).toBe(peer)
}

const ocmManifest = readManifest(join(__dirname, '..', 'package.json'))
const pluginManifest = readManifest(
  join(__dirname, '..', 'node_modules', '@opencode', 'plugin', 'package.json'),
)

describe('ocm-cli package compatibility with the installed @opencode/plugin', () => {
  for (const name of PINNED_PACKAGES) {
    it(`${name} satisfies the plugin peer and derives the published peer range`, () => {
      const version = installedVersion(name)
      expectVersionSatisfiesPeer(version, pluginManifest.peerDependencies[name]!)
      expect(ocmManifest.devDependencies[name]).toBe('catalog:')
      expect(ocmManifest.peerDependencies[name]).toBe(deriveMinorLineRange(version))
      expect(ocmManifest.peerDependenciesMeta[name]?.optional).toBe(true)
    })
  }

  it('resolves @opencode/plugin from the workspace catalog', () => {
    expect(ocmManifest.devDependencies['@opencode/plugin']).toBe('catalog:')
  })
})
