import rawThemes from './opencode-themes.json'

type ThemeMode = 'light' | 'dark'

type ThemeValue = string | { dark: string; light: string }

interface OpenCodeThemeDefinition {
  defs?: Record<string, string>
  theme: Record<string, ThemeValue>
}

type ResolvedThemeTokens = Record<string, string>

const OPENCODE_THEME_MAP = rawThemes as Record<string, OpenCodeThemeDefinition>

export const DEFAULT_THEME_PRESET = 'opencode'

export const OPENCODE_THEME_OPTIONS = [
  { id: 'opencode', label: 'OpenCode' },
  { id: 'github', label: 'GitHub' },
  { id: 'tokyonight', label: 'Tokyo Night' },
  { id: 'vesper', label: 'Vesper' },
  { id: 'carbonfox', label: 'Carbonfox' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'nightowl', label: 'Night Owl' },
  { id: 'everforest', label: 'Everforest' },
  { id: 'flexoki', label: 'Flexoki' },
  { id: 'gruvbox', label: 'Gruvbox' },
  { id: 'kanagawa', label: 'Kanagawa' },
  { id: 'catppuccin', label: 'Catppuccin' },
  { id: 'catppuccin-frappe', label: 'Catppuccin Frappe' },
  { id: 'catppuccin-macchiato', label: 'Catppuccin Macchiato' },
  { id: 'ayu', label: 'Ayu' },
  { id: 'one-dark', label: 'One Dark' },
  { id: 'material', label: 'Material' },
  { id: 'monokai', label: 'Monokai' },
  { id: 'palenight', label: 'Palenight' },
  { id: 'rosepine', label: 'Rose Pine' },
  { id: 'solarized', label: 'Solarized' },
  { id: 'aura', label: 'Aura' },
  { id: 'cobalt2', label: 'Cobalt2' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'mercury', label: 'Mercury' },
  { id: 'nord', label: 'Nord' },
  { id: 'orng', label: 'Orng' },
  { id: 'lucent-orng', label: 'Lucent Orng' },
  { id: 'osaka-jade', label: 'Osaka Jade' },
  { id: 'synthwave84', label: 'Synthwave 84' },
  { id: 'vercel', label: 'Vercel' },
  { id: 'zenburn', label: 'Zenburn' },
] as const

export type OpenCodeThemePreset = (typeof OPENCODE_THEME_OPTIONS)[number]['id']

function resolveThemeValue(
  definition: OpenCodeThemeDefinition,
  value: ThemeValue,
  mode: ThemeMode,
  trail = new Set<string>(),
): string {
  if (typeof value !== 'string') {
    return resolveThemeValue(definition, value[mode], mode, trail)
  }

  if (value === 'none' || value === 'transparent') {
    return 'transparent'
  }

  if (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl')) {
    return value
  }

  if (trail.has(value)) {
    return value
  }

  trail.add(value)

  const definitionValue = definition.defs?.[value]
  if (definitionValue) {
    return resolveThemeValue(definition, definitionValue, mode, trail)
  }

  const themeToken = definition.theme[value]
  if (themeToken) {
    return resolveThemeValue(definition, themeToken, mode, trail)
  }

  return value
}

function contrastForeground(color: string, darkValue = '#0f0f10', lightValue = '#fcfcfc') {
  const normalized = color.trim()
  if (!normalized.startsWith('#')) {
    return lightValue
  }

  const hex = normalized.slice(1)
  const channelLength = hex.length === 3 ? 1 : 2
  const expand = (start: number) => {
    const chunk = hex.slice(start, start + channelLength)
    return channelLength === 1 ? chunk + chunk : chunk
  }

  const red = Number.parseInt(expand(0), 16)
  const green = Number.parseInt(expand(channelLength), 16)
  const blue = Number.parseInt(expand(channelLength * 2), 16)

  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  return luminance > 0.62 ? darkValue : lightValue
}

export function resolveOpenCodeTheme(themeId: string, mode: ThemeMode): ResolvedThemeTokens {
  const definition = OPENCODE_THEME_MAP[themeId] ?? OPENCODE_THEME_MAP[DEFAULT_THEME_PRESET]

  return Object.fromEntries(
    Object.entries(definition.theme).map(([key, value]) => [key, resolveThemeValue(definition, value, mode)])
  )
}

export function getThemeLabel(themeId: string) {
  return OPENCODE_THEME_OPTIONS.find((theme) => theme.id === themeId)?.label ?? themeId
}

export function getAppThemeVariables(themeId: string, mode: ThemeMode) {
  const theme = resolveOpenCodeTheme(themeId, mode)
  const primaryForeground = contrastForeground(theme.primary)
  const infoForeground = contrastForeground(theme.info)
  const successForeground = contrastForeground(theme.success)
  const warningForeground = contrastForeground(theme.warning)
  const destructiveForeground = contrastForeground(theme.error)
  const surfaceTint = mode === 'dark' ? '#ffffff' : '#000000'

  return {
    '--background': theme.background,
    '--foreground': theme.text,
    '--card': theme.backgroundPanel,
    '--card-hover': `color-mix(in oklab, ${theme.backgroundElement} 92%, ${surfaceTint} 8%)`,
    '--card-foreground': theme.text,
    '--panel': theme.backgroundElement,
    '--panel-foreground': theme.text,
    '--panel-border': theme.borderSubtle,
    '--popover': theme.backgroundPanel,
    '--popover-foreground': theme.text,
    '--primary': theme.primary,
    '--primary-hover': `color-mix(in oklab, ${theme.primary} 86%, ${surfaceTint} 14%)`,
    '--primary-foreground': primaryForeground,
    '--secondary': `color-mix(in oklab, ${theme.backgroundElement} 86%, ${theme.secondary} 14%)`,
    '--secondary-foreground': theme.text,
    '--muted': `color-mix(in oklab, ${theme.backgroundPanel} 88%, ${theme.background} 12%)`,
    '--muted-foreground': theme.textMuted,
    '--accent': `color-mix(in oklab, ${theme.backgroundElement} 82%, ${theme.primary} 18%)`,
    '--accent-foreground': theme.text,
    '--destructive': theme.error,
    '--destructive-foreground': destructiveForeground,
    '--border': theme.border,
    '--input': theme.backgroundElement,
    '--ring': `color-mix(in oklab, ${theme.borderActive} 44%, transparent)`,
    '--info': theme.info,
    '--info-foreground': infoForeground,
    '--success': theme.success,
    '--success-foreground': successForeground,
    '--warning': theme.warning,
    '--warning-foreground': warningForeground,
    '--sidebar': theme.backgroundPanel,
    '--sidebar-foreground': theme.text,
    '--sidebar-primary': theme.primary,
    '--sidebar-primary-foreground': primaryForeground,
    '--sidebar-accent': theme.backgroundElement,
    '--sidebar-accent-foreground': theme.text,
    '--sidebar-border': theme.borderSubtle,
    '--sidebar-ring': `color-mix(in oklab, ${theme.borderActive} 44%, transparent)`,
    '--chart-1': theme.primary,
    '--chart-2': theme.success,
    '--chart-3': theme.warning,
    '--chart-4': theme.secondary,
    '--chart-5': theme.info,
    '--scrollbar-track': 'transparent',
    '--scrollbar-thumb': theme.border,
    '--scrollbar-thumb-hover': theme.borderActive,
    '--diff-added': theme.diffAdded,
    '--diff-added-bg': theme.diffAddedBg,
    '--diff-removed': theme.diffRemoved,
    '--diff-removed-bg': theme.diffRemovedBg,
    '--diff-context': theme.diffContext,
    '--diff-context-bg': theme.diffContextBg,
    '--diff-line-number': theme.diffLineNumber,
    '--diff-added-line-number-bg': theme.diffAddedLineNumberBg,
    '--diff-removed-line-number-bg': theme.diffRemovedLineNumberBg,
    '--markdown-text': theme.markdownText,
    '--markdown-heading': theme.markdownHeading,
    '--markdown-link': theme.markdownLink,
    '--markdown-link-text': theme.markdownLinkText,
    '--markdown-code': theme.markdownCode,
    '--markdown-block-quote': theme.markdownBlockQuote,
    '--markdown-emph': theme.markdownEmph,
    '--markdown-strong': theme.markdownStrong,
    '--markdown-rule': theme.markdownHorizontalRule,
    '--markdown-list-item': theme.markdownListItem,
    '--markdown-list-enumeration': theme.markdownListEnumeration,
    '--markdown-image': theme.markdownImage,
    '--markdown-image-text': theme.markdownImageText,
    '--markdown-code-block': theme.markdownCodeBlock,
    '--syntax-comment': theme.syntaxComment,
    '--syntax-keyword': theme.syntaxKeyword,
    '--syntax-function': theme.syntaxFunction,
    '--syntax-variable': theme.syntaxVariable,
    '--syntax-string': theme.syntaxString,
    '--syntax-number': theme.syntaxNumber,
    '--syntax-type': theme.syntaxType,
    '--syntax-operator': theme.syntaxOperator,
    '--syntax-punctuation': theme.syntaxPunctuation,
  } as const
}
