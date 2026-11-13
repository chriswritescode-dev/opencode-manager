import { DEFAULT_DIRECT_SHORTCUTS, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_LEADER_KEY } from '@/api/types/settings'

const isMac = 'navigator' in globalThis && globalThis.navigator.platform.toUpperCase().includes('MAC')

const CMD_KEY = isMac ? 'Cmd' : 'Ctrl'

const MODIFIER_ORDER = ['Ctrl', 'Cmd', 'Alt', 'Shift']

const MODIFIER_EVENT_KEYS = ['Control', 'Meta', 'Alt', 'Shift']

const KEY_ALIASES = new Map<string, string>([
  [' ', 'Space'],
  ['ArrowUp', 'Up'],
  ['ArrowDown', 'Down'],
  ['ArrowLeft', 'Left'],
  ['ArrowRight', 'Right'],
  ['Enter', 'Return'],
  ['Escape', 'Esc'],
])

interface ShortcutPreferences {
  leaderKey?: string
  directShortcuts?: string[]
  keyboardShortcuts?: Record<string, string>
}

export interface ShortcutBindings {
  leaderKey: string
  shortcuts: Record<string, string>
  directShortcuts: string[]
}

function canonicalKey(key: string): string {
  return KEY_ALIASES.get(key) ?? (key.length === 1 ? key.toUpperCase() : key)
}

function eventModifiers(e: KeyboardEvent): string[] {
  return [e.ctrlKey && 'Ctrl', e.metaKey && 'Cmd', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter((key): key is string => Boolean(key))
}

function eventMainKey(e: KeyboardEvent): string {
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3)
  if (e.altKey && /^Digit\d$/.test(e.code)) return e.code.slice(5)
  return canonicalKey(e.key)
}

export function isModifierOnlyEvent(e: KeyboardEvent): boolean {
  return MODIFIER_EVENT_KEYS.includes(e.key)
}

export function formatEventModifiers(e: KeyboardEvent): string {
  return eventModifiers(e).join('+')
}

export function formatShortcutEvent(e: KeyboardEvent): string | null {
  if (!e.key || isModifierOnlyEvent(e)) return null
  return [...eventModifiers(e), eventMainKey(e)].join('+')
}

export function normalizeShortcut(shortcut: string): string {
  if (!shortcut) return ''
  const separator = shortcut.length < 2 ? -1 : shortcut.lastIndexOf('+', shortcut.length - 2)
  const mainKey = canonicalKey(shortcut.slice(separator + 1))
  const modifiers = separator < 0 ? [] : shortcut.slice(0, separator).split('+').map((modifier) => (modifier === 'Cmd' ? CMD_KEY : modifier))
  const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier))
  return [...orderedModifiers, mainKey].join('+')
}

export function formatShortcutLabel(keys: string, isDirect: boolean, leaderKey: string): string {
  if (!keys) return ''
  if (isDirect) return normalizeShortcut(keys)
  return `${normalizeShortcut(leaderKey)} → ${normalizeShortcut(keys)}`
}

export function hasCommandModifier(shortcut: string): boolean {
  return /(^|\+)(Ctrl|Cmd|Alt)\+./.test(shortcut)
}

export function getDefaultKeyboardShortcuts() {
  return {
    ...DEFAULT_KEYBOARD_SHORTCUTS,
    clearPrompt: isMac ? 'Ctrl+C' : '',
  }
}

export function resolveDirectShortcuts(directShortcuts: string[] | undefined, storedShortcuts?: Record<string, string>): string[] {
  if (!directShortcuts) return DEFAULT_DIRECT_SHORTCUTS
  if (!storedShortcuts) return directShortcuts
  const additions = DEFAULT_DIRECT_SHORTCUTS.filter(
    (action) => !(action in storedShortcuts) && !directShortcuts.includes(action),
  )
  return additions.length > 0 ? [...directShortcuts, ...additions] : directShortcuts
}

function bindingSignature(action: string, keys: string, directShortcuts: string[]): string {
  const kind = directShortcuts.includes(action) ? 'direct' : 'leader'
  return `${kind}:${normalizeShortcut(keys)}`
}

function resolveShortcutMap(stored: Record<string, string>, directShortcuts: string[]) {
  const resolved = { ...stored }
  const storedBindings = new Set(
    Object.entries(stored)
      .filter(([, keys]) => Boolean(keys))
      .map(([action, keys]) => bindingSignature(action, keys, directShortcuts)),
  )
  for (const [action, defaultKeys] of Object.entries(getDefaultKeyboardShortcuts())) {
    if (action in stored) continue
    const collides = Boolean(defaultKeys) && storedBindings.has(bindingSignature(action, defaultKeys, directShortcuts))
    resolved[action] = collides ? '' : defaultKeys
  }
  return resolved
}

export function resolveShortcutBindings(preferences: ShortcutPreferences | undefined): ShortcutBindings {
  const directShortcuts = resolveDirectShortcuts(preferences?.directShortcuts, preferences?.keyboardShortcuts)
  return {
    leaderKey: normalizeShortcut(preferences?.leaderKey || DEFAULT_LEADER_KEY),
    shortcuts: resolveShortcutMap(preferences?.keyboardShortcuts ?? {}, directShortcuts),
    directShortcuts,
  }
}

export function findShortcutAction(bindings: ShortcutBindings, shortcut: string, direct: boolean): string | undefined {
  return Object.entries(bindings.shortcuts).find(([action, keys]) => (
    Boolean(keys) && bindings.directShortcuts.includes(action) === direct && normalizeShortcut(keys) === shortcut
  ))?.[0]
}
