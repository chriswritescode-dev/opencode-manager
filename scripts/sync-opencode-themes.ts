import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { OPENCODE_PINNED_VERSION } from '../shared/src/opencode/release'
import { OPENCODE_SYNTAX_TOKENS } from '../shared/src/themes/types'
import { JsonValueSchema, type JsonObject, type JsonValue } from '../shared/src/utils/json'
import type {
  HexColor,
  OpenCodeSyntaxPalette,
  OpenCodeThemeDefinition,
  OpenCodeThemePalette,
} from '../shared/src/themes/types'

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

const HexColorSchema = z.string().regex(HEX_COLOR_PATTERN)

const RawVariantSchema = z.looseObject({
  palette: z.record(z.string(), JsonValueSchema).optional(),
  overrides: z.record(z.string(), JsonValueSchema).optional(),
})

const RawThemeSchema = z.looseObject({
  id: JsonValueSchema.optional(),
  name: JsonValueSchema.optional(),
  light: RawVariantSchema.optional(),
  dark: RawVariantSchema.optional(),
})

type RawVariant = z.infer<typeof RawVariantSchema>

type RawTheme = z.infer<typeof RawThemeSchema>

function isHexColor(value: JsonValue | undefined): value is HexColor {
  return HexColorSchema.safeParse(value).success
}

function readHex(value: JsonValue | undefined, field: string): HexColor {
  if (!isHexColor(value)) {
    throw new Error(`Invalid hex color for ${field}: ${JSON.stringify(value)}`)
  }
  return value
}

function readOptionalHex(value: JsonValue | undefined, field: string): HexColor | undefined {
  return value === undefined ? undefined : readHex(value, field)
}

function readSyntax(overrides: JsonObject | undefined): OpenCodeSyntaxPalette | undefined {
  if (!overrides) return undefined
  const syntax: OpenCodeSyntaxPalette = {}
  for (const token of OPENCODE_SYNTAX_TOKENS) {
    const value = overrides[`syntax-${token}`]
    if (isHexColor(value)) syntax[token] = value
  }
  return Object.keys(syntax).length === 0 ? undefined : syntax
}

function readPalette(raw: RawVariant | undefined, field: string): OpenCodeThemePalette {
  const palette = raw?.palette
  if (!palette) {
    throw new Error(`Missing palette for ${field}`)
  }
  const accent = readOptionalHex(palette.accent, `${field}.accent`)
  const diffAdd = readOptionalHex(palette.diffAdd, `${field}.diffAdd`)
  const diffDelete = readOptionalHex(palette.diffDelete, `${field}.diffDelete`)
  const textWeakValue = raw?.overrides?.['text-weak']
  const textWeak = isHexColor(textWeakValue) ? textWeakValue : undefined
  const syntax = readSyntax(raw?.overrides)
  const themePalette: OpenCodeThemePalette = {
    neutral: readHex(palette.neutral, `${field}.neutral`),
    ink: readHex(palette.ink, `${field}.ink`),
    primary: readHex(palette.primary, `${field}.primary`),
    success: readHex(palette.success, `${field}.success`),
    warning: readHex(palette.warning, `${field}.warning`),
    error: readHex(palette.error, `${field}.error`),
    info: readHex(palette.info, `${field}.info`),
  }
  if (accent !== undefined) themePalette.accent = accent
  if (diffAdd !== undefined) themePalette.diffAdd = diffAdd
  if (diffDelete !== undefined) themePalette.diffDelete = diffDelete
  if (textWeak !== undefined) themePalette.textWeak = textWeak
  if (syntax !== undefined) themePalette.syntax = syntax
  return themePalette
}

async function fetchTheme(file: string): Promise<RawTheme> {
  const response = await fetch(`${THEME_BASE_URL}/${file}.json`)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${file}.json: ${response.status} ${response.statusText}`)
  }
  return RawThemeSchema.parse(await response.json())
}

function buildTheme(raw: RawTheme, file: string): OpenCodeThemeDefinition {
  const id = z.string().min(1).safeParse(raw.id)
  if (!id.success) {
    throw new Error(`Missing id for ${file}`)
  }
  const name = z.string().min(1).safeParse(raw.name)
  if (!name.success) {
    throw new Error(`Missing name for ${file}`)
  }
  return {
    id: id.data,
    name: name.data,
    light: readPalette(raw.light, `${file}.light`),
    dark: readPalette(raw.dark, `${file}.dark`),
  }
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

const PALETTE_FIELD_ORDER: Exclude<keyof OpenCodeThemePalette, 'syntax'>[] = [
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
  if (palette.syntax !== undefined) {
    lines.push(`${indent}  syntax: {`)
    for (const token of OPENCODE_SYNTAX_TOKENS) {
      const value = palette.syntax[token]
      if (value !== undefined) lines.push(`${indent}    ${token}: ${quote(value)},`)
    }
    lines.push(`${indent}  },`)
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
