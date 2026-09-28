import { z } from 'zod'
import { OPENCODE_THEMES } from './opencode-palettes'
import type { OpenCodeThemeDefinition } from './types'

export type { HexColor } from './types'
export { OPENCODE_THEMES } from './opencode-palettes'

export const MANAGER_COLOR_THEME_ID = 'manager' as const

type OpenCodeThemeId = (typeof OPENCODE_THEMES)[number]['id']
export type ColorThemeId = typeof MANAGER_COLOR_THEME_ID | OpenCodeThemeId

export function isColorThemeId(value: unknown): value is ColorThemeId {
  return value === MANAGER_COLOR_THEME_ID || OPENCODE_THEMES.some((theme) => theme.id === value)
}

export function getOpenCodeTheme(id: ColorThemeId): OpenCodeThemeDefinition | undefined {
  if (id === MANAGER_COLOR_THEME_ID) return undefined
  return OPENCODE_THEMES.find((theme) => theme.id === id)
}

export const ColorThemeIdSchema: z.ZodType<ColorThemeId> = z.custom<ColorThemeId>(isColorThemeId, {
  message: 'Unknown color theme',
})
