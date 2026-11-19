import indexHtml from '../../../index.html?raw'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  APPEARANCE_STORAGE_KEY,
  AppearanceSnapshotSchema,
  applyColorTheme,
  readableTextColor,
  resolveColorThemeTokens,
} from './colorTheme'

function themeColorMeta(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null
}

function appearanceSnapshot() {
  const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY)
  if (!raw) throw new Error('appearance snapshot missing')
  return AppearanceSnapshotSchema.parse(JSON.parse(raw))
}

describe('applyColorTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = '<meta name="theme-color" content="#0a0a0a" />'
    window.localStorage.clear()
  })

  it('applies the Dracula dark palette and browser theme color', () => {
    applyColorTheme(document.documentElement, 'dracula', true)

    const root = document.documentElement
    expect(root.style.getPropertyValue('--color-background')).toBe('#1d1e28')
    expect(root.style.getPropertyValue('--color-foreground')).toBe('#f8f8f2')
    expect(root.style.getPropertyValue('--color-primary')).toBe('#bd93f9')
    expect(root.style.getPropertyValue('--color-destructive')).toBe('#ff5555')
    expect(themeColorMeta()).toBe('#1d1e28')
  })

  it('applies the Dracula light palette when the mode is light', () => {
    applyColorTheme(document.documentElement, 'dracula', false)

    const root = document.documentElement
    expect(root.style.getPropertyValue('--color-background')).toBe('#f8f8f2')
    expect(root.style.getPropertyValue('--color-foreground')).toBe('#1f1f2f')
  })

  it('sets a readable primary foreground from the primary contrast', () => {
    applyColorTheme(document.documentElement, 'dracula', true)

    expect(document.documentElement.style.getPropertyValue('--color-primary-foreground')).toBe('#000000')
    expect(readableTextColor('#1d4ed8')).toBe('#ffffff')
  })

  it('removes palette overrides and restores the manager browser color', () => {
    applyColorTheme(document.documentElement, 'dracula', true)
    applyColorTheme(document.documentElement, 'manager', true)

    expect(document.documentElement.style.length).toBe(0)
    expect(themeColorMeta()).toBe('#0a0a0a')
  })

  it('uses the textWeak override for muted foreground when present and a mix when absent', () => {
    expect(resolveColorThemeTokens('oc-2', true)?.['muted-foreground']).toBe('#707070')
    expect(resolveColorThemeTokens('dracula', true)?.['muted-foreground']).toBe('color-mix(in oklab, #f8f8f2 62%, #1d1e28)')
  })

  it('resolves the extended semantic tokens from the palette', () => {
    const dark = resolveColorThemeTokens('dracula', true)

    expect(dark?.success).toBe('#50fa7b')
    expect(dark?.warning).toBe('#ffb86c')
    expect(dark?.info).toBe('#8be9fd')
    expect(dark?.highlight).toBe('#ff79c6')
    expect(dark?.['diff-add']).toBe('#2fb27d')
    expect(dark?.['diff-delete']).toBe('#ff6b81')
    expect(dark?.['agent-plan']).toBe('#8be9fd')
    expect(dark?.['agent-build']).toBe('#bd93f9')
    expect(dark?.['agent-docs']).toBe('#ffb86c')
    expect(dark?.['agent-ask']).toBe('#8be9fd')
    expect(dark?.['success-foreground']).toBe(readableTextColor('#50fa7b'))
    expect(dark?.['warning-foreground']).toBe(readableTextColor('#ffb86c'))
    expect(dark?.['info-foreground']).toBe(readableTextColor('#8be9fd'))
    expect(dark?.['highlight-foreground']).toBe(readableTextColor('#ff79c6'))
    expect(dark?.['destructive-foreground']).toBe(readableTextColor('#ff5555'))
  })

  it('resolves syntax tokens from upstream overrides and palette fallbacks', () => {
    const dark = resolveColorThemeTokens('dracula', true)

    expect(dark?.['syntax-keyword']).toBe('#ff79c6')
    expect(dark?.['syntax-string']).toBe('#f1fa8c')
    expect(dark?.['syntax-comment']).toBe('#6272a4')
    expect(dark?.['syntax-primitive']).toBe('#50fa7b')
    expect(dark?.['syntax-property']).toBe('#8be9fd')
    expect(dark?.['syntax-constant']).toBe('#bd93f9')
    expect(dark?.['syntax-variable']).toBe('#f8f8f2')
    expect(dark?.['syntax-type']).toBe('#ffb86c')
    expect(dark?.['syntax-operator']).toBe(dark?.['muted-foreground'])
    expect(dark?.['syntax-punctuation']).toBe(dark?.['muted-foreground'])
  })

  it('resolves light syntax tokens and falls back to ink for operator and punctuation', () => {
    const light = resolveColorThemeTokens('dracula', false)

    expect(light?.['syntax-keyword']).toBe('#d16090')
    expect(light?.['syntax-punctuation']).toBe('#1f1f2f')
  })

  it('applies syntax tokens to the root element', () => {
    applyColorTheme(document.documentElement, 'dracula', true)

    expect(document.documentElement.style.getPropertyValue('--color-syntax-keyword')).toBe('#ff79c6')
  })

  it('falls back to primary for highlight when the palette has no accent', () => {
    const dark = resolveColorThemeTokens('oc-2', true)

    expect(dark?.highlight).toBe('#fab283')
    expect(dark?.['highlight-foreground']).toBe(readableTextColor('#fab283'))
  })

  it('falls back to success and error for diff colors when the palette omits them', () => {
    const dark = resolveColorThemeTokens('catppuccin-frappe', true)

    expect(dark?.['diff-add']).toBe('#a6d189')
    expect(dark?.['diff-delete']).toBe('#e78284')
  })

  it('persists an appearance snapshot for boot replay', () => {
    applyColorTheme(document.documentElement, 'dracula', true)

    const snapshot = appearanceSnapshot()
    expect(snapshot.dark).toBe(true)
    expect(snapshot.themeColor).toBe('#1d1e28')
    expect(snapshot.tokens?.background).toBe('#1d1e28')
  })

  it('persists a null token map for the manager theme', () => {
    applyColorTheme(document.documentElement, 'manager', false)

    const snapshot = appearanceSnapshot()
    expect(snapshot.dark).toBe(false)
    expect(snapshot.tokens).toBeNull()
    expect(snapshot.themeColor).toBe('#ffffff')
  })

  it('keeps the boot replay storage key in sync with index.html', () => {
    expect(indexHtml).toContain(APPEARANCE_STORAGE_KEY)
  })
})
