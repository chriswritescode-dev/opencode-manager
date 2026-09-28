import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OPENCODE_PINNED_VERSION } from '../shared/src/opencode/release'
import type { HexColor, OpenCodeThemeDefinition, OpenCodeThemePalette } from '../shared/src/themes/types'

const OPENCODE_THEME_TAG = `v${OPENCODE_PINNED_VERSION}`

const THEME_FILES = [
  'oc-2',
  'amoled',
  'aura',
  'ayu',
  'carbonfox',
  'catppuccin',
  'catppuccin-frappe',
  'catppuccin-macchiato',
  'cobalt2',
  'cursor',
  'dracula',
  'everforest',
  'flexoki',
  'github',
  'gruvbox',
  'kanagawa',
  'lucent-orng',
  'material',
  'matrix',
  'mercury',
  'monokai',
  'nightowl',
  'nord',
  'one-dark',
  'onedarkpro',
  'orng',
  'osaka-jade',
  'palenight',
  'rosepine',
  'shadesofpurple',
  'solarized',
  'synthwave84',
  'tokyonight',
  'vercel',
  'vesper',
  'zenburn',
] as const

const THEME_BASE_URL = `https://raw.githubusercontent.com/anomalyco/opencode/${OPENCODE_THEME_TAG}/packages/ui/src/theme/themes`

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]+$/

interface RawVariant {
  palette?: Record<string, unknown>
  overrides?: Record<string, unknown>
}

interface RawTheme {
  id?: unknown
  name?: unknown
  light?: RawVariant
  dark?: RawVariant
}

function isHexColor(value: unknown): value is HexColor {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
}

function readHex(value: unknown, field: string): HexColor {
  if (!isHexColor(value)) {
    throw new Error(`Invalid hex color for ${field}: ${JSON.stringify(value)}`)
  }
  return value
}

function readOptionalHex(value: unknown, field: string): HexColor | undefined {
  return value === undefined ? undefined : readHex(value, field)
}

function readPalette(raw: RawVariant | undefined, field: string): OpenCodeThemePalette {
  if (!raw || typeof raw !== 'object' || !raw.palette || typeof raw.palette !== 'object') {
    throw new Error(`Missing palette for ${field}`)
  }
  const palette = raw.palette
  const accent = readOptionalHex(palette.accent, `${field}.accent`)
  const diffAdd = readOptionalHex(palette.diffAdd, `${field}.diffAdd`)
  const diffDelete = readOptionalHex(palette.diffDelete, `${field}.diffDelete`)
  const textWeakValue = raw.overrides?.['text-weak']
  const textWeak = isHexColor(textWeakValue) ? textWeakValue : undefined
  return {
    neutral: readHex(palette.neutral, `${field}.neutral`),
    ink: readHex(palette.ink, `${field}.ink`),
    primary: readHex(palette.primary, `${field}.primary`),
    success: readHex(palette.success, `${field}.success`),
    warning: readHex(palette.warning, `${field}.warning`),
    error: readHex(palette.error, `${field}.error`),
    info: readHex(palette.info, `${field}.info`),
    ...(accent === undefined ? {} : { accent }),
    ...(diffAdd === undefined ? {} : { diffAdd }),
    ...(diffDelete === undefined ? {} : { diffDelete }),
    ...(textWeak === undefined ? {} : { textWeak }),
  }
}

async function fetchTheme(file: string): Promise<RawTheme> {
  const response = await fetch(`${THEME_BASE_URL}/${file}.json`)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${file}.json: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as RawTheme
}

function buildTheme(raw: RawTheme, file: string): OpenCodeThemeDefinition {
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new Error(`Missing id for ${file}`)
  }
  if (typeof raw.name !== 'string' || raw.name.length === 0) {
    throw new Error(`Missing name for ${file}`)
  }
  return {
    id: raw.id,
    name: raw.name,
    light: readPalette(raw.light, `${file}.light`),
    dark: readPalette(raw.dark, `${file}.dark`),
  }
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

const PALETTE_FIELD_ORDER: (keyof OpenCodeThemePalette)[] = [
  'neutral',
  'ink',
  'primary',
  'accent',
  'success',
  'warning',
  'error',
  'info',
  'diffAdd',
  'diffDelete',
  'textWeak',
]

function serializePalette(palette: OpenCodeThemePalette, indent: string): string {
  const lines = ['{']
  for (const field of PALETTE_FIELD_ORDER) {
    const value = palette[field]
    if (value !== undefined) lines.push(`${indent}  ${field}: ${quote(value)},`)
  }
  lines.push(`${indent}}`)
  return lines.join('\n')
}

function serializeTheme(theme: OpenCodeThemeDefinition): string {
  return [
    '  {',
    `    id: ${quote(theme.id)},`,
    `    name: ${quote(theme.name)},`,
    `    light: ${serializePalette(theme.light, '    ')},`,
    `    dark: ${serializePalette(theme.dark, '    ')},`,
    '  },',
  ].join('\n')
}

function serializeThemes(themes: readonly OpenCodeThemeDefinition[]): string {
  const header = "import type { OpenCodeThemeDefinition } from './types'"
  const body = themes.map(serializeTheme).join('\n')
  return `${header}\n\nexport const OPENCODE_THEMES = [\n${body}\n] as const satisfies readonly OpenCodeThemeDefinition[]\n`
}

async function main(): Promise<void> {
  const themes: OpenCodeThemeDefinition[] = []
  const seenIds = new Set<string>()
  for (const file of THEME_FILES) {
    const theme = buildTheme(await fetchTheme(file), file)
    if (seenIds.has(theme.id)) {
      throw new Error(`Duplicate theme id: ${theme.id}`)
    }
    seenIds.add(theme.id)
    themes.push(theme)
  }
  const outputPath = join(import.meta.dir, '..', 'shared', 'src', 'themes', 'opencode-palettes.ts')
  await writeFile(outputPath, serializeThemes(themes), 'utf8')
  console.log(`Wrote ${themes.length} OpenCode themes to ${outputPath}`)
}

await main()
