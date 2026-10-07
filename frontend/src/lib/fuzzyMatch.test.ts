import { describe, expect, it } from 'vitest'
import { matchText, rankByMatch } from './fuzzyMatch'

describe('matchText', () => {
  it.each([
    ['review', 'review', 0, [[0, 6]]],
    ['rev', 'review', 1, [[0, 3]]],
    ['pr', 'plan-review', 2, [[0, 1], [5, 6]]],
    ['view', 'review', 3, [[2, 6]]],
    ['rvw', 'review', 4, [[0, 1], [2, 3], [5, 6]]],
  ])('matches %j against %j at tier %i', (query, name, tier, ranges) => {
    expect(matchText(query, name)).toEqual({ tier, ranges })
  })

  it('falls back to the description without highlighting the name', () => {
    expect(matchText('deploy', 'ship', 'Deploy a preview')).toEqual({ tier: 5, ranges: [] })
  })

  it('returns null when nothing matches', () => {
    expect(matchText('xyz', 'review', 'Review changes')).toBeNull()
  })
})

describe('rankByMatch', () => {
  const items = ['fix-tests', 'format-code', 'fetch', 'test']

  it('orders by tier, then recency, then name', () => {
    const ranked = rankByMatch(items, 'ft', { getName: (item) => item, recent: ['format-code'] })

    expect(ranked.map(({ item }) => item)).toEqual(['fix-tests', 'format-code', 'fetch'])
    expect(rankByMatch(items, 'f', { getName: (item) => item, recent: ['format-code'] }).map(({ item }) => item))
      .toEqual(['format-code', 'fetch', 'fix-tests'])
  })
})
