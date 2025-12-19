import { describe, it, expect } from 'vitest'
import { sanitizeForTTS } from './utils'

describe('sanitizeForTTS', () => {
  it('should handle headers', () => {
    expect(sanitizeForTTS('# Main Header\n## Sub Header\n### Detail')).toBe('Main Header\nSub Header\nDetail')
  })

  it('should handle bullet lists', () => {
    expect(sanitizeForTTS('- Milk\n- Eggs\n* Bread')).toBe('Milk\nEggs\nBread')
  })

  it('should handle numbered lists', () => {
    expect(sanitizeForTTS('1. First\n2. Second')).toBe('First\nSecond')
  })

  it('should remove inline code but keep content', () => {
    expect(sanitizeForTTS('Use `const x = 1` here')).toBe('Use const x = 1 here')
  })

  it('should remove code blocks entirely', () => {
    expect(sanitizeForTTS('Start\n```\ncode\n```\nEnd')).toBe('Start\nEnd')
  })

  it('should handle bold formatting', () => {
    expect(sanitizeForTTS('This is **bold** text')).toBe('This is bold text')
  })

  it('should handle italic formatting', () => {
    expect(sanitizeForTTS('Simple *italic* example')).toBe('Simple italic example')
  })

  it('should remove markdown links but keep display text', () => {
    expect(sanitizeForTTS('Visit [OpenCode](https://opencode.ai)')).toBe('Visit OpenCode')
  })

  it('should handle images and tables', () => {
    expect(sanitizeForTTS('See ![diagram](url) below:\n|A|B|\n|-|-|\n|1|2|')).toBe('See diagram below:\nA B\n1 2')
  })

  it('should handle blockquotes', () => {
    expect(sanitizeForTTS('> Important\n> Note')).toBe('Important\nNote')
  })

  it('should remove citations and footnotes', () => {
    expect(sanitizeForTTS('See [1] and [^2] for more')).toBe('See and for more')
  })

  it('should handle strikethrough', () => {
    expect(sanitizeForTTS('~~removed~~')).toBe('removed')
  })

  it('should handle complex mixed content', () => {
    const input = '# Results\nFunction: `calc()`\nSee [doc](url):\n- A\n- B'
    const expected = 'Results\nFunction: calc()\nSee doc:\nA\nB'
    expect(sanitizeForTTS(input)).toBe(expected)
  })

  it('should remove horizontal rules', () => {
    expect(sanitizeForTTS('Before\n---\nAfter')).toBe('Before\nAfter')
  })

  it('should normalize whitespace', () => {
    expect(sanitizeForTTS('Line 1\n\n\nLine 2')).toBe('Line 1\nLine 2')
  })

  it('should fix punctuation spacing', () => {
    expect(sanitizeForTTS('Hello , world !')).toBe('Hello, world!')
  })

  it('should return empty string for empty input', () => {
    expect(sanitizeForTTS('')).toBe('')
    expect(sanitizeForTTS('   ')).toBe('')
    expect(sanitizeForTTS(null as any)).toBe('')
  })

  it('should handle headers and lists combined', () => {
    expect(sanitizeForTTS('## Shopping List\n- Milk\n- Eggs')).toBe('Shopping List\nMilk\nEggs')
  })

  it('should handle HTML tags', () => {
    expect(sanitizeForTTS('Text with <tag>content</tag> here')).toBe('Text with content here')
  })
})
