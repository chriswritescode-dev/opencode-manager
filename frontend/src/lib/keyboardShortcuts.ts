import { DEFAULT_DIRECT_SHORTCUTS, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_LEADER_KEY } from '@/api/types/settings'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

const CMD_KEY = isMac ? 'Cmd' : 'Ctrl'

const MODIFIER_ORDER = ['Ctrl', 'Cmd', 'Alt', 'Shift']

const MODIFIER_EVENT_KEYS = ['Control', 'Meta', 'Alt', 'Shift']

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Return',
  Escape: 'Esc',
}

const LEGACY_DEFAULT_DIRECT_SHORTCUTS = ['submit', 'abort']

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
  return KEY_ALIASES[key] ?? (key.length === 1 ? key.toUpperCase() : key)
}

function eventModifiers(e: KeyboardEvent): string[] {
  return [e.ctrlKey && 'Ctrl', e.metaKey && 'Cmd', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter((key): key is string => Boolean(key))
}

/**
 * The main key of an event; with Alt held, letters and digits come from the physical key because macOS Option rewrites `key`.
 */
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

/**
 * Formats a keydown event as a canonical shortcut string such as `Cmd+Shift+Z`, or null for a lone modifier key.
 */
export function formatShortcutEvent(e: KeyboardEvent): string | null {
  if (isModifierOnlyEvent(e)) return null
  return [...eventModifiers(e), eventMainKey(e)].join('+')
}

/**
 * Canonicalizes a stored shortcut: `Cmd` becomes `Ctrl` off macOS, key aliases such as `Enter`/`Return` collapse, and modifiers are ordered.
 */
export function normalizeShortcut(shortcut: string): string {
  if (!shortcut) return ''
  const separator = shortcut.length < 2 ? -1 : shortcut.lastIndexOf('+', shortcut.length - 2)
  const mainKey = canonicalKey(shortcut.slice(separator + 1))
  const modifiers = separator < 0 ? [] : shortcut.slice(0, separator).split('+').map((modifier) => (modifier === 'Cmd' ? CMD_KEY : modifier))
  const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier))
  return [...orderedModifiers, mainKey].join('+')
}

export function hasCommandModifier(shortcut: string): boolean {
  return /(^|\+)(Ctrl|Cmd|Alt)\+./.test(shortcut)
}

/**
 * The direct-shortcut list, upgrading the untouched legacy default and adding any default direct action that the stored
 * shortcut map does not yet know about, so newly added direct defaults reach users who customized their list. When
 * `storedShortcuts` is omitted the list is returned unchanged apart from the legacy upgrade.
 */
export function resolveDirectShortcuts(directShortcuts: string[] | undefined, storedShortcuts?: Record<string, string>): string[] {
  if (!directShortcuts) return DEFAULT_DIRECT_SHORTCUTS
  const isLegacyDefault = directShortcuts.length === LEGACY_DEFAULT_DIRECT_SHORTCUTS.length
    && LEGACY_DEFAULT_DIRECT_SHORTCUTS.every((action) => directShortcuts.includes(action))
  const resolved = isLegacyDefault ? DEFAULT_DIRECT_SHORTCUTS : directShortcuts
  if (!storedShortcuts) return resolved
  const additions = DEFAULT_DIRECT_SHORTCUTS.filter(
    (action) => !(action in storedShortcuts) && !resolved.includes(action),
  )
  return additions.length > 0 ? [...resolved, ...additions] : resolved
}

export function resolveShortcutBindings(preferences: ShortcutPreferences | undefined): ShortcutBindings {
  return {
    leaderKey: normalizeShortcut(preferences?.leaderKey || DEFAULT_LEADER_KEY),
    shortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS, ...preferences?.keyboardShortcuts },
    directShortcuts: resolveDirectShortcuts(preferences?.directShortcuts, preferences?.keyboardShortcuts),
  }
}

export function findShortcutAction(bindings: ShortcutBindings, shortcut: string, direct: boolean): string | undefined {
  return Object.entries(bindings.shortcuts).find(([action, keys]) => (
    Boolean(keys) && bindings.directShortcuts.includes(action) === direct && normalizeShortcut(keys) === shortcut
  ))?.[0]
}
