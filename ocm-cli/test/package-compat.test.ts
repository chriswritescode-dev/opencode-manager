import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compareSemver, parseSemver, parseJsonText } from '@opencode-manager/shared/utils'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const PackageManifestSchema = z.object({
  version: z.string(),
  devDependencies: z.record(z.string(), z.string()).default({}),
  peerDependencies: z.record(z.string(), z.string()).default({}),
  peerDependenciesMeta: z.record(z.string(), z.object({ optional: z.boolean().optional() })).default({}),
})

const PINNED_PACKAGES = ['@opentui/core', '@opentui/solid', '@opencode/theme'] as const

function readManifest(path: string): z.infer<typeof PackageManifestSchema> {
  return PackageManifestSchema.parse(parseJsonText(readFileSync(path, 'utf8')))
}

function installedVersion(name: string): string {
  return readManifest(join(__dirname, '..', 'node_modules', name, 'package.json')).version
}

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

function expectVersionSatisfiesPeer(version: string, peer: string): void {
  const comparators = peer.trim().split(/\s+/)
  if (!comparators.every((comparator) => comparator.startsWith('>=') || comparator.startsWith('<'))) {
    expect(version).toBe(peer)
    return
  }
  for (const comparator of comparators) {
    if (comparator.startsWith('>=')) {
      expect(compareSemver(version, comparator.slice(2))).toBeGreaterThanOrEqual(0)
    } else if (comparator.startsWith('<=')) {
      expect(compareSemver(version, comparator.slice(2))).toBeLessThanOrEqual(0)
    } else {
      expect(compareSemver(version, comparator.slice(1))).toBeLessThan(0)
    }
  }
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
