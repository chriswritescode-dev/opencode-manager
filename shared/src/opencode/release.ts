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

export interface OpenCodeVersion {
  major: number
  minor: number
  patch: number
  prerelease: OpenCodePrereleaseIdentifier[]
}

const OPENCODE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

const OPENCODE_STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

const OPENCODE_VERSION_OUTPUT_PATTERN = /(?<![\d.])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/g

export function normalizeOpenCodeVersion(version: string): string {
  return version.trim().replace(/^v/, '')
}

export function parseOpenCodeVersion(version: string): OpenCodeVersion | null {
  const match = OPENCODE_VERSION_PATTERN.exec(normalizeOpenCodeVersion(version))
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

function compareParsedOpenCodeVersions(left: OpenCodeVersion, right: OpenCodeVersion): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  return compareOpenCodePrereleaseIdentifiers(left.prerelease, right.prerelease)
}

export function compareOpenCodeVersions(left: string, right: string): number {
  const parsedLeft = parseOpenCodeVersion(left)
  const parsedRight = parseOpenCodeVersion(right)
  if (!parsedLeft || !parsedRight) {
    throw new Error(`Cannot compare invalid OpenCode versions: ${left} and ${right}`)
  }
  return compareParsedOpenCodeVersions(parsedLeft, parsedRight)
}

function parsePinnedOpenCodeVersion(): OpenCodeVersion {
  const pinned = parseOpenCodeVersion(OPENCODE_PINNED_VERSION)
  if (!pinned) throw new Error(`OPENCODE_PINNED_VERSION is not a valid version: ${OPENCODE_PINNED_VERSION}`)
  return pinned
}

const OPENCODE_PINNED = parsePinnedOpenCodeVersion()

export const OPENCODE_SUPPORTED_VERSION_RANGE = `>=${OPENCODE_PINNED_VERSION} <${OPENCODE_PINNED.major + 1}.0.0`

export function isSupportedOpenCodeVersion(version: string): boolean {
  const parsed = parseOpenCodeVersion(version)
  if (!parsed) return false
  return parsed.major === OPENCODE_PINNED.major && compareParsedOpenCodeVersions(parsed, OPENCODE_PINNED) >= 0
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
