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
 * The built-in shortcut defaults for the current platform: the shared table plus the macOS-only clear-prompt binding,
 * which shared cannot express because it must contain no platform detection.
 */
export function getDefaultKeyboardShortcuts(): Record<string, string> {
  return {
    ...DEFAULT_KEYBOARD_SHORTCUTS,
    clearPrompt: isMac ? 'Ctrl+C' : '',
  }
}

/**
 * The direct-shortcut list, adding any default direct action that the stored shortcut map does not yet know about, so
 * newly added direct defaults reach users who customized their list. A default direct action that is already a key of
 * the stored map is treated as stored, never re-added. When `storedShortcuts` is omitted the list is returned unchanged.
 */
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

/**
 * The effective shortcut map: stored bindings always win, defaults fill the actions the user never stored, and a default
 * for an action outside the stored map is dropped to unbound when its normalized key and leader/direct kind would
 * collide with a binding that is stored.
 */
function resolveShortcutMap(stored: Record<string, string>, directShortcuts: string[]): Record<string, string> {
  const resolved: Record<string, string> = { ...stored }
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
