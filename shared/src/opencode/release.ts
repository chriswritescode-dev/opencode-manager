import { compareParsedSemver, compareSemver, normalizeSemver, parseSemver, type Semver } from '../utils/semver'

/** The OpenCode release Manager is built against and bundles; matches the `@opencode/*` pnpm catalog entries. */
export const OPENCODE_PINNED_VERSION = '2.2.5'

/** The oldest OpenCode release Manager supports; any later release of the same major is accepted. */
export const OPENCODE_MIN_VERSION = '2.2.5'

const OPENCODE_RELEASE_BASE_URL = 'https://opencode.ai/files/bin'

const OPENCODE_ARCH_ALIASES: Record<string, string> = {
  x64: 'x64',
  amd64: 'x64',
  x86_64: 'x64',
  arm64: 'arm64',
  aarch64: 'arm64',
}

const OPENCODE_PLATFORM_ARCHIVES: Partial<Record<NodeJS.Platform, 'tar.gz' | 'zip'>> = {
  linux: 'tar.gz',
  darwin: 'zip',
}

export type OpenCodeVersion = Semver

const OPENCODE_STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

const OPENCODE_VERSION_OUTPUT_PATTERN = /(?<![\d.])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/g

export function normalizeOpenCodeVersion(version: string): string {
  return normalizeSemver(version)
}

export function parseOpenCodeVersion(version: string): OpenCodeVersion | null {
  return parseSemver(version)
}

export function isStableOpenCodeVersion(version: string): boolean {
  return OPENCODE_STABLE_VERSION_PATTERN.test(normalizeOpenCodeVersion(version))
}

export function parseOpenCodeVersionOutput(output: string): string | null {
  for (const match of output.matchAll(OPENCODE_VERSION_OUTPUT_PATTERN)) {
    const candidate = (match[1] ?? '').replace(/[.+-]+$/, '')
    if (parseOpenCodeVersion(candidate)) return candidate
  }
  return null
}

export function compareOpenCodeVersions(left: string, right: string): number {
  return compareSemver(left, right)
}

function parseMinOpenCodeVersion(): OpenCodeVersion {
  const min = parseOpenCodeVersion(OPENCODE_MIN_VERSION)
  if (!min) throw new Error(`OPENCODE_MIN_VERSION is not a valid version: ${OPENCODE_MIN_VERSION}`)
  return min
}

const OPENCODE_MIN = parseMinOpenCodeVersion()

export const OPENCODE_SUPPORTED_VERSION_RANGE = `>=${OPENCODE_MIN_VERSION} <${OPENCODE_MIN.major + 1}.0.0`

export function isSupportedOpenCodeVersion(version: string): boolean {
  const parsed = parseOpenCodeVersion(version)
  if (!parsed) return false
  return parsed.major === OPENCODE_MIN.major && compareParsedSemver(parsed, OPENCODE_MIN) >= 0
}

export function describeUnsupportedOpenCodeVersion(version: string): string {
  return `OpenCode ${version} is not supported; OpenCode Manager requires OpenCode ${OPENCODE_SUPPORTED_VERSION_RANGE}`
}

export function buildOpenCodeReleaseAsset(
  version: string,
  target: { platform: NodeJS.Platform; arch: string; musl: boolean },
): { url: string; archive: 'tar.gz' | 'zip' } {
  const archive = OPENCODE_PLATFORM_ARCHIVES[target.platform]
  if (!archive) throw new Error(`Unsupported OpenCode platform: ${target.platform}`)

  const arch = OPENCODE_ARCH_ALIASES[target.arch]
  if (!arch) throw new Error(`Unsupported OpenCode architecture: ${target.arch}`)

  const muslSuffix = target.musl ? '-musl' : ''
  return {
    url: `${OPENCODE_RELEASE_BASE_URL}/${version}/opencode-${target.platform}-${arch}${muslSuffix}.${archive}`,
    archive,
  }
}
