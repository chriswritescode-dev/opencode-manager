import { z } from 'zod'
import { OPENCODE_THEMES } from './opencode-palettes'
import type { JsonValue } from '../utils/json'
import type { OpenCodeThemeDefinition } from './types'

export type { HexColor } from './types'
export { OPENCODE_THEMES } from './opencode-palettes'

export const MANAGER_COLOR_THEME_ID = 'manager' as const

type OpenCodeThemeId = (typeof OPENCODE_THEMES)[number]['id']
export type ColorThemeId = typeof MANAGER_COLOR_THEME_ID | OpenCodeThemeId

const COLOR_THEME_ID_LIST = [MANAGER_COLOR_THEME_ID, ...OPENCODE_THEMES.map((theme) => theme.id)] as const

const COLOR_THEME_IDS: ReadonlySet<string> = new Set<string>(COLOR_THEME_ID_LIST)

export function isColorThemeId(value: JsonValue | undefined): value is ColorThemeId {
  const id = z.string().safeParse(value)
  return id.success && COLOR_THEME_IDS.has(id.data)
}

export function getOpenCodeTheme(id: ColorThemeId): OpenCodeThemeDefinition | undefined {
  if (id === MANAGER_COLOR_THEME_ID) return undefined
  return OPENCODE_THEMES.find((theme) => theme.id === id)
}

export const ColorThemeIdSchema = z.enum(COLOR_THEME_ID_LIST)
