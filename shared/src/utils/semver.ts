export type SemverPrereleaseIdentifier = number | string

export interface Semver {
  major: number
  minor: number
  patch: number
  prerelease: SemverPrereleaseIdentifier[]
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

export function normalizeSemver(version: string): string {
  return version.trim().replace(/^v/, '')
}

export function parseSemver(version: string): Semver | null {
  const match = SEMVER_PATTERN.exec(normalizeSemver(version))
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

function comparePrereleaseIdentifiers(
  left: SemverPrereleaseIdentifier[],
  right: SemverPrereleaseIdentifier[],
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

export function compareParsedSemver(left: Semver, right: Semver): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  return comparePrereleaseIdentifiers(left.prerelease, right.prerelease)
}

export function compareSemver(left: string, right: string): number {
  const parsedLeft = parseSemver(left)
  const parsedRight = parseSemver(right)
  if (!parsedLeft || !parsedRight) {
    throw new Error(`Cannot compare invalid semver versions: ${left} and ${right}`)
  }
  return compareParsedSemver(parsedLeft, parsedRight)
}
