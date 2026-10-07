export type MatchRange = [start: number, end: number]

export interface TextMatch {
  tier: number
  ranges: MatchRange[]
}

export interface RankedMatch<T> {
  item: T
  tier: number
  ranges: MatchRange[]
}

interface RankOptions<T> {
  getName: (item: T) => string
  getDescription?: (item: T) => string | undefined
  recent?: string[]
}

const SEGMENT_SEPARATOR = /[-_./\s]/
const MIN_DESCRIPTION_QUERY_LENGTH = 3

/**
 * Matches a query against a name, falling back to the description for queries of three or more characters.
 * Lower tiers are better: exact, prefix, segment acronym, substring, subsequence, description.
 */
export function matchText(query: string, name: string, description?: string): TextMatch | null {
  const needle = query.toLowerCase()
  const haystack = name.toLowerCase()
  if (!needle) return { tier: 0, ranges: [] }
  if (haystack === needle) return { tier: 0, ranges: [[0, haystack.length]] }
  if (haystack.startsWith(needle)) return { tier: 1, ranges: [[0, needle.length]] }

  const acronym = matchPositions(needle, haystack, segmentStarts(haystack))
  if (acronym) return { tier: 2, ranges: toRanges(acronym) }

  const index = haystack.indexOf(needle)
  if (index !== -1) return { tier: 3, ranges: [[index, index + needle.length]] }

  const subsequence = matchPositions(needle, haystack, haystack.split('').map((_, position) => position))
  if (subsequence) return { tier: 4, ranges: toRanges(subsequence) }

  if (needle.length >= MIN_DESCRIPTION_QUERY_LENGTH && description?.toLowerCase().includes(needle)) return { tier: 5, ranges: [] }
  return null
}

/**
 * Filters and orders items by match tier, then by position in `recent`, then alphabetically.
 * An empty query lists recent items first, followed by the rest alphabetically.
 */
export function rankByMatch<T>(items: T[], query: string, options: RankOptions<T>): RankedMatch<T>[] {
  const recent = options.recent ?? []
  const recentIndex = (item: T) => {
    const index = recent.indexOf(options.getName(item))
    return index === -1 ? recent.length : index
  }

  return items
    .flatMap((item) => {
      const match = matchText(query, options.getName(item), options.getDescription?.(item))
      return match ? [{ item, match }] : []
    })
    .sort((a, b) =>
      a.match.tier - b.match.tier
      || recentIndex(a.item) - recentIndex(b.item)
      || options.getName(a.item).localeCompare(options.getName(b.item)),
    )
    .map(({ item, match }) => ({ item, tier: match.tier, ranges: match.ranges }))
}

function segmentStarts(text: string): number[] {
  return text.split('').flatMap((char, index) =>
    !SEGMENT_SEPARATOR.test(char) && (index === 0 || SEGMENT_SEPARATOR.test(text[index - 1])) ? [index] : [],
  )
}

function matchPositions(needle: string, haystack: string, candidates: number[]): number[] | null {
  const positions: number[] = []
  let cursor = 0
  for (const char of needle) {
    while (cursor < candidates.length && haystack[candidates[cursor]] !== char) cursor++
    if (cursor === candidates.length) return null
    positions.push(candidates[cursor])
    cursor++
  }
  return positions
}

function toRanges(positions: number[]): MatchRange[] {
  return positions.reduce<MatchRange[]>((ranges, position) => {
    const last = ranges[ranges.length - 1]
    if (last && last[1] === position) {
      last[1] = position + 1
      return ranges
    }
    ranges.push([position, position + 1])
    return ranges
  }, [])
}
