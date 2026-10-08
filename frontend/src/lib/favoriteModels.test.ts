import { describe, expect, it } from 'vitest'
import { getNextFavoriteModel } from './favoriteModels'
import type { ModelSelection } from '@/api/providers'

const model = (providerID: string, modelID: string): ModelSelection => ({ providerID, modelID })

describe('getNextFavoriteModel', () => {
  it('returns undefined when there are no favorites', () => {
    expect(getNextFavoriteModel([], model('anthropic', 'claude-sonnet-4'))).toBeUndefined()
  })

  it('returns the first favorite when nothing is selected', () => {
    const favorites = [model('anthropic', 'claude-sonnet-4'), model('openai', 'gpt-5')]
    expect(getNextFavoriteModel(favorites, null)).toEqual(favorites[0])
  })

  it('returns the first favorite when the current model is not a favorite', () => {
    const favorites = [model('anthropic', 'claude-sonnet-4'), model('openai', 'gpt-5')]
    expect(getNextFavoriteModel(favorites, model('opencode-go', 'go-1'))).toEqual(favorites[0])
  })

  it('returns the next favorite in the middle of the list', () => {
    const favorites = [model('a', 'x'), model('b', 'y'), model('c', 'z')]
    expect(getNextFavoriteModel(favorites, favorites[0])).toEqual(favorites[1])
    expect(getNextFavoriteModel(favorites, favorites[1])).toEqual(favorites[2])
  })

  it('wraps around from the last favorite to the first', () => {
    const favorites = [model('a', 'x'), model('b', 'y'), model('c', 'z')]
    expect(getNextFavoriteModel(favorites, favorites[2])).toEqual(favorites[0])
  })
})
