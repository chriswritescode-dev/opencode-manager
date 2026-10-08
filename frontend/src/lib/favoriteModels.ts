import { isSameModelSelection } from '@opencode-manager/shared/opencode'
import type { ModelSelection } from '@/api/providers'

export function getNextFavoriteModel(
  favorites: readonly ModelSelection[],
  current: ModelSelection | null,
): ModelSelection | undefined {
  if (favorites.length === 0) return undefined
  if (!current) return favorites[0]

  const index = favorites.findIndex((favorite) => isSameModelSelection(favorite, current))
  if (index === -1) return favorites[0]

  return favorites[(index + 1) % favorites.length]
}
