export const OPENCODE_MIN_VERSION = '2.0.0'
export const OPENCODE_PINNED_VERSION = '2.0.15'

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

type OpenCodePrereleaseIdentifier = number | string

interface OpenCodeVersion {
  major: number
  minor: number
  patch: number
  prerelease: OpenCodePrereleaseIdentifier[]
}

const OPENCODE_VERSION_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

function parseOpenCodeVersion(version: string): OpenCodeVersion | null {
  const match = OPENCODE_VERSION_PATTERN.exec(version.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
      ? match[4].split('.').map((identifier) => (/^\d+$/.test(identifier) ? Number(identifier) : identifier))
      : [],
  }
}

function compareOpenCodePrereleaseIdentifiers(
  left: OpenCodePrereleaseIdentifier[],
  right: OpenCodePrereleaseIdentifier[],
): number {
  if (left.length === 0 || right.length === 0) return right.length - left.length

  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const leftIdentifier = left[index]
    const rightIdentifier = right[index]

    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = typeof leftIdentifier === 'number'
    const rightNumeric = typeof rightIdentifier === 'number'
    if (leftNumeric && rightNumeric) return leftIdentifier > rightIdentifier ? 1 : -1
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftIdentifier > rightIdentifier ? 1 : -1
  }

  return 0
}

function compareOpenCodeVersions(left: OpenCodeVersion, right: OpenCodeVersion): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  return compareOpenCodePrereleaseIdentifiers(left.prerelease, right.prerelease)
}

export function isSupportedOpenCodeVersion(version: string): boolean {
  const parsed = parseOpenCodeVersion(version)
  const minimum = parseOpenCodeVersion(OPENCODE_MIN_VERSION)
  if (!parsed || !minimum) return false
  return parsed.major === minimum.major && compareOpenCodeVersions(parsed, minimum) >= 0
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
