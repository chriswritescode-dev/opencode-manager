import { describe, expect, it, vi } from 'vitest'
import { OUTPUT_LIMITS } from '@opencode-manager/shared/schemas'
import { clampFrameHeight, parseFrameMessage, readOutputThemeTokens } from './outputBridge'

const THEME_TOKEN_VALUES: Record<string, string> = {
  '--color-background': '#ffffff',
  '--color-foreground': '#111827',
  '--color-muted': '#f3f4f6',
  '--color-muted-foreground': '#6b7280',
  '--color-border': '#e5e7eb',
  '--color-primary': '#2563eb',
  '--color-primary-foreground': '#ffffff',
  '--color-accent': '#dbeafe',
  '--color-diff-add': '#dcfce7',
  '--color-diff-delete': '#fee2e2',
}

function createMessageEvent(data: unknown, source: unknown): MessageEvent {
  return new MessageEvent('message', { data, source: source as MessageEventSource })
}

describe('readOutputThemeTokens', () => {
  it('reads and trims all output theme tokens', () => {
    const getPropertyValue = vi.fn((name: string) => ` ${THEME_TOKEN_VALUES[name] ?? ''} `)
    vi.stubGlobal('getComputedStyle', vi.fn(() => ({ getPropertyValue })))

    expect(readOutputThemeTokens()).toEqual(THEME_TOKEN_VALUES)
    expect(getPropertyValue).toHaveBeenCalledTimes(10)
    expect(getPropertyValue).toHaveBeenCalledWith('--color-background')
    expect(getPropertyValue).toHaveBeenCalledWith('--color-diff-delete')

    vi.unstubAllGlobals()
  })
})

describe('parseFrameMessage', () => {
  const frameWindow = {} as Window
  const otherWindow = {} as Window

  it('returns the message for a matching source and valid payload', () => {
    expect(
      parseFrameMessage(createMessageEvent({ type: 'ui/size', height: 320 }, frameWindow), frameWindow),
    ).toEqual({ type: 'ui/size', height: 320 })

    expect(
      parseFrameMessage(
        createMessageEvent({ type: 'ui/open-file', path: 'src/a.ts', line: 3 }, frameWindow),
        frameWindow,
      ),
    ).toEqual({ type: 'ui/open-file', path: 'src/a.ts', line: 3 })

    expect(
      parseFrameMessage(
        createMessageEvent({ type: 'ui/refine', text: 'Tighten the summary' }, frameWindow),
        frameWindow,
      ),
    ).toEqual({ type: 'ui/refine', text: 'Tighten the summary' })
  })

  it('returns null when the source window does not match', () => {
    expect(
      parseFrameMessage(createMessageEvent({ type: 'ui/size', height: 320 }, otherWindow), frameWindow),
    ).toBeNull()
  })

  it('returns null when the frame window is unknown', () => {
    expect(
      parseFrameMessage(createMessageEvent({ type: 'ui/size', height: 320 }, frameWindow), null),
    ).toBeNull()
  })

  it('returns null for an unknown message type', () => {
    expect(
      parseFrameMessage(createMessageEvent({ type: 'ui/unknown', height: 320 }, frameWindow), frameWindow),
    ).toBeNull()
  })

  it('returns null for a malformed payload', () => {
    expect(
      parseFrameMessage(createMessageEvent({ type: 'ui/size', height: 'tall' }, frameWindow), frameWindow),
    ).toBeNull()
    expect(
      parseFrameMessage(createMessageEvent({ type: 'ui/open-file', path: '' }, frameWindow), frameWindow),
    ).toBeNull()
    expect(parseFrameMessage(createMessageEvent('not-a-message', frameWindow), frameWindow)).toBeNull()
  })
})

describe('clampFrameHeight', () => {
  it('clamps heights below the minimum', () => {
    expect(clampFrameHeight(50)).toBe(OUTPUT_LIMITS.FRAME_MIN_HEIGHT)
  })

  it('clamps heights above the maximum', () => {
    expect(clampFrameHeight(99999)).toBe(OUTPUT_LIMITS.FRAME_MAX_HEIGHT)
  })

  it('rounds fractional heights inside the range', () => {
    expect(clampFrameHeight(320.4)).toBe(320)
    expect(clampFrameHeight(320.6)).toBe(321)
  })
})
