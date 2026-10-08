import { describe, expect, it } from 'vitest'
import { DEFAULT_DIRECT_SHORTCUTS, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_LEADER_KEY } from '@/api/types/settings'
import { formatShortcutEvent, getDefaultKeyboardShortcuts, normalizeShortcut, resolveDirectShortcuts, resolveShortcutBindings } from './keyboardShortcuts'

describe('keyboardShortcuts', () => {
  it('normalizes key aliases, modifier order and bare symbol keys', () => {
    expect(normalizeShortcut('Ctrl+Enter')).toBe('Ctrl+Return')
    expect(normalizeShortcut('Escape')).toBe('Esc')
    expect(normalizeShortcut('Shift+Ctrl+z')).toBe('Ctrl+Shift+Z')
    expect(normalizeShortcut('Ctrl++')).toBe('Ctrl++')
    expect(normalizeShortcut('+')).toBe('+')
  })

  it('reads letters from the physical key when Alt rewrites the character', () => {
    expect(formatShortcutEvent(new KeyboardEvent('keydown', { key: '†', code: 'KeyT', altKey: true }))).toBe('Alt+T')
    expect(formatShortcutEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }))).toBeNull()
  })

  it('returns the shared defaults with the key set', () => {
    expect(Object.keys(getDefaultKeyboardShortcuts())).toEqual(Object.keys(DEFAULT_KEYBOARD_SHORTCUTS))
  })

  it('never rewrites a stored direct-shortcut list', () => {
    expect(resolveDirectShortcuts(['abort', 'submit'])).toEqual(['abort', 'submit'])
    expect(resolveDirectShortcuts(undefined)).toBe(DEFAULT_DIRECT_SHORTCUTS)
  })

  it('adds default direct actions the stored shortcut map does not know about', () => {
    expect(resolveDirectShortcuts(['submit'], { submit: 'Return' })).toEqual(DEFAULT_DIRECT_SHORTCUTS)
    expect(resolveDirectShortcuts(['submit'], { submit: 'Return', abort: 'Escape' })).toEqual(
      DEFAULT_DIRECT_SHORTCUTS.filter((action) => action !== 'abort'),
    )
    expect(resolveDirectShortcuts(['abort', 'submit'], { abort: 'Escape', submit: 'Return' })).toEqual([
      'abort',
      'submit',
      ...DEFAULT_DIRECT_SHORTCUTS.filter((action) => action !== 'abort' && action !== 'submit'),
    ])
  })

  it('resolves the built-in bindings for a user with no stored preferences', () => {
    const bindings = resolveShortcutBindings(undefined)
    expect(bindings.leaderKey).toBe(DEFAULT_LEADER_KEY)
    expect(bindings.shortcuts.submit).toBe(DEFAULT_KEYBOARD_SHORTCUTS.submit)
    expect(bindings.shortcuts.toggleMode).toBe('Shift+Tab')
    expect(bindings.shortcuts.toggleTerminal).toBe('T')
    expect(bindings.shortcuts.halfPageDown).toBe('Ctrl+D')
    expect(bindings.directShortcuts).toBe(DEFAULT_DIRECT_SHORTCUTS)
  })

  it('keeps stored bindings and fills the rest from the defaults', () => {
    const bindings = resolveShortcutBindings({
      keyboardShortcuts: { submit: 'Return', newSession: 'K' },
      directShortcuts: ['submit'],
    })
    expect(bindings.shortcuts.submit).toBe('Return')
    expect(bindings.shortcuts.newSession).toBe('K')
    expect(bindings.shortcuts.toggleMode).toBe('Shift+Tab')
  })

  it('drops a new default that would collide with a stored binding of the same kind', () => {
    const bindings = resolveShortcutBindings({
      keyboardShortcuts: { toggleMode: 'T' },
      directShortcuts: ['submit', 'abort'],
    })
    expect(bindings.shortcuts.toggleMode).toBe('T')
    expect(bindings.shortcuts.toggleTerminal).toBe('')
  })

  it('keeps a new default whose kind differs from the stored binding on the same key', () => {
    const bindings = resolveShortcutBindings({
      keyboardShortcuts: { toggleMode: 'T' },
      directShortcuts: ['submit', 'abort', 'toggleMode'],
    })
    expect(bindings.shortcuts.toggleMode).toBe('T')
    expect(bindings.shortcuts.toggleTerminal).toBe('T')
  })
})
