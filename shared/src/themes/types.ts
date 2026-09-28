export type HexColor = `#${string}`

export interface OpenCodeThemePalette {
  neutral: HexColor
  ink: HexColor
  primary: HexColor
  accent?: HexColor
  success: HexColor
  warning: HexColor
  error: HexColor
  info: HexColor
  diffAdd?: HexColor
  diffDelete?: HexColor
  textWeak?: HexColor
}

export interface OpenCodeThemeDefinition {
  id: string
  name: string
  light: OpenCodeThemePalette
  dark: OpenCodeThemePalette
}
