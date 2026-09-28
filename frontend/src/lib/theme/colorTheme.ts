import { getOpenCodeTheme, MANAGER_COLOR_THEME_ID } from '@opencode-manager/shared/themes'
import type { ColorThemeId, HexColor } from '@opencode-manager/shared/themes'

const MANAGER_THEME_TOKENS = [
  'background',
  'background-gradient',
  'foreground',
  'card',
  'card-hover',
  'border',
  'primary',
  'primary-hover',
  'primary-foreground',
  'muted-foreground',
  'accent',
  'input',
  'muted',
  'popover',
  'destructive',
  'destructive-foreground',
  'secondary',
  'secondary-foreground',
  'accent-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'info',
  'info-foreground',
  'highlight',
  'highlight-foreground',
  'diff-add',
  'diff-delete',
  'agent-plan',
  'agent-build',
  'agent-docs',
  'agent-ask',
] as const

type ManagerThemeToken = (typeof MANAGER_THEME_TOKENS)[number]

export type ThemeMode = 'light' | 'dark'

export const APPEARANCE_STORAGE_KEY = 'ocm-appearance'

interface AppearanceSnapshot {
  dark: boolean
  tokens: Record<string, string> | null
  themeColor: string
}

const MANAGER_BROWSER_THEME_COLOR = {
  dark: '#0a0a0a',
  light: '#ffffff',
} as const

function relativeLuminance(hex: HexColor): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(first: number, second: number): number {
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

export function readableTextColor(fill: HexColor): '#ffffff' | '#000000' {
  const luminance = relativeLuminance(fill)
  const whiteContrast = contrastRatio(1, luminance)
  const blackContrast = contrastRatio(0, luminance)
  return whiteContrast >= blackContrast ? '#ffffff' : '#000000'
}

export function getDocumentThemeMode(): ThemeMode {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function resolveColorThemeTokens(
  colorTheme: ColorThemeId,
  isDark: boolean,
): Record<ManagerThemeToken, string> | null {
  const theme = getOpenCodeTheme(colorTheme)
  if (!theme) return null

  const {
    neutral,
    ink,
    primary,
    accent: paletteAccent,
    success,
    warning,
    error,
    info,
    diffAdd,
    diffDelete,
    textWeak,
  } = isDark ? theme.dark : theme.light
  const mix = (percent: number) => `color-mix(in oklab, ${ink} ${percent}%, ${neutral})`
  const highlight = paletteAccent ?? primary

  return {
    background: neutral,
    'background-gradient': mix(3),
    foreground: ink,
    card: mix(4),
    'card-hover': mix(7),
    popover: mix(5),
    muted: mix(6),
    accent: mix(10),
    secondary: mix(10),
    border: mix(14),
    input: mix(16),
    'muted-foreground': textWeak ?? mix(62),
    primary,
    'primary-hover': `color-mix(in oklab, ${primary} 85%, ${ink})`,
    'primary-foreground': readableTextColor(primary),
    destructive: error,
    'destructive-foreground': readableTextColor(error),
    'secondary-foreground': ink,
    'accent-foreground': ink,
    success,
    'success-foreground': readableTextColor(success),
    warning,
    'warning-foreground': readableTextColor(warning),
    info,
    'info-foreground': readableTextColor(info),
    highlight,
    'highlight-foreground': readableTextColor(highlight),
    'diff-add': diffAdd ?? success,
    'diff-delete': diffDelete ?? error,
    'agent-plan': info,
    'agent-build': primary,
    'agent-docs': warning,
    'agent-ask': info,
  }
}

function persistAppearance(snapshot: AppearanceSnapshot): void {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    return
  }
}

export function applyColorTheme(
  root: HTMLElement,
  colorTheme: ColorThemeId | undefined,
  isDark: boolean,
): void {
  const resolved = resolveColorThemeTokens(colorTheme ?? MANAGER_COLOR_THEME_ID, isDark)

  for (const token of MANAGER_THEME_TOKENS) {
    if (resolved) {
      root.style.setProperty(`--color-${token}`, resolved[token])
    } else {
      root.style.removeProperty(`--color-${token}`)
    }
  }

  const themeColor = resolved ? resolved.background : MANAGER_BROWSER_THEME_COLOR[isDark ? 'dark' : 'light']

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', themeColor)

  persistAppearance({ dark: isDark, tokens: resolved, themeColor })
}
