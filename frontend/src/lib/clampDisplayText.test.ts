import { describe, it, expect } from 'vitest'
import { clampDisplayText } from './clampDisplayText'

const line = (index: number) => `line ${index} ${'x'.repeat(20)}`

describe('clampDisplayText', () => {
  it('returns short text unchanged', () => {
    const text = 'short output\nwith two lines'

    expect(clampDisplayText(text)).toBe(text)
  })

  it('shortens text over the display limit while keeping the head and tail', () => {
    const lines = Array.from({ length: 2000 }, (_, index) => line(index))
    const text = lines.join('\n')

    const clamped = clampDisplayText(text)

    expect(clamped.length).toBeLessThan(text.length)
    expect(clamped).toContain('omitted — use the copy button')
    expect(clamped.startsWith(lines[0])).toBe(true)
    expect(clamped.endsWith(lines[lines.length - 1])).toBe(true)
  })
})
