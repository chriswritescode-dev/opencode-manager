import type { ITheme } from '@xterm/xterm'

const BASE_TOKENS = {
  background: 'background',
  foreground: 'foreground',
  cursor: 'primary',
  selectionBackground: 'accent',
} as const

const ANSI_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
] as const satisfies readonly (keyof ITheme)[]

type AnsiName = (typeof ANSI_NAMES)[number]

const ANSI_TOKENS = {
  black: 'muted',
  red: 'destructive',
  green: 'success',
  yellow: 'warning',
  blue: 'info',
  magenta: 'highlight',
  cyan: 'syntax-property',
  white: 'foreground',
} as const satisfies Record<AnsiName, string>

const ANSI_BRIGHT_KEYS = {
  black: 'brightBlack',
  red: 'brightRed',
  green: 'brightGreen',
  yellow: 'brightYellow',
  blue: 'brightBlue',
  magenta: 'brightMagenta',
  cyan: 'brightCyan',
  white: 'brightWhite',
} as const satisfies Record<AnsiName, keyof ITheme>

function collectTokenColors(root: HTMLElement): Map<string, string> {
  const tokens = new Set<string>([
    ...Object.values(BASE_TOKENS),
    ...Object.values(ANSI_TOKENS),
  ])

  const probes = new Map<string, HTMLSpanElement>()
  for (const token of tokens) {
    const probe = document.createElement('span')
    probe.style.color = `var(--color-${token})`
    probe.style.position = 'absolute'
    probe.style.width = '0'
    probe.style.height = '0'
    probe.style.overflow = 'hidden'
    probe.style.opacity = '0'
    probe.style.pointerEvents = 'none'
    root.appendChild(probe)
    probes.set(token, probe)
  }

  const colors = new Map<string, string>()
  for (const [token, probe] of probes) {
    colors.set(token, getComputedStyle(probe).color)
    root.removeChild(probe)
  }
  return colors
}

function ansiTheme(colors: Map<string, string>): Partial<ITheme> {
  const theme: Partial<ITheme> = {}
  for (const name of ANSI_NAMES) {
    const color = colors.get(ANSI_TOKENS[name])
    theme[name] = color
    theme[ANSI_BRIGHT_KEYS[name]] = color
  }
  return theme
}

export function resolveTerminalTheme(root: HTMLElement): ITheme {
  const colors = collectTokenColors(root)
  return {
    background: colors.get(BASE_TOKENS.background),
    foreground: colors.get(BASE_TOKENS.foreground),
    cursor: colors.get(BASE_TOKENS.cursor),
    selectionBackground: colors.get(BASE_TOKENS.selectionBackground),
    ...ansiTheme(colors),
  }
}
