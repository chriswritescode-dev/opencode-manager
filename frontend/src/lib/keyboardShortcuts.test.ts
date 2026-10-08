import { describe, expect, it } from 'vitest'
import { DEFAULT_DIRECT_SHORTCUTS } from '@/api/types/settings'
import { formatShortcutEvent, normalizeShortcut, resolveDirectShortcuts } from './keyboardShortcuts'

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

  it('upgrades only the untouched legacy direct-shortcut list', () => {
    expect(resolveDirectShortcuts(['abort', 'submit'])).toBe(DEFAULT_DIRECT_SHORTCUTS)
    expect(resolveDirectShortcuts(['submit'])).toEqual(['submit'])
    expect(resolveDirectShortcuts(undefined)).toBe(DEFAULT_DIRECT_SHORTCUTS)
  })

  it('adds default direct actions the stored shortcut map does not know about', () => {
    expect(resolveDirectShortcuts(['submit'], { submit: 'Return' })).toEqual(DEFAULT_DIRECT_SHORTCUTS)
    expect(resolveDirectShortcuts(['submit'], { submit: 'Return', abort: 'Escape' })).toEqual(
      DEFAULT_DIRECT_SHORTCUTS.filter((action) => action !== 'abort'),
    )
    expect(resolveDirectShortcuts(['abort', 'submit'], { abort: 'Escape', submit: 'Return' })).toBe(DEFAULT_DIRECT_SHORTCUTS)
  })
})
