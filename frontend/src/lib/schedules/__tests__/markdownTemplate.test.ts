import { describe, it, expect } from 'vitest'
import { parseMarkdownTemplate } from '../markdownTemplate'

describe('parseMarkdownTemplate', () => {
  describe('frontmatter', () => {
    it('parses all keys from frontmatter', () => {
      const raw = `---
title: My Template
category: Health
cadenceHint: Weekly
suggestedName: My Suggested Name
suggestedDescription: A suggested description
description: A short description
---
This is the prompt body`

      const result = parseMarkdownTemplate(raw)

      expect(result).toEqual({
        title: 'My Template',
        category: 'Health',
        cadenceHint: 'Weekly',
        suggestedName: 'My Suggested Name',
        suggestedDescription: 'A suggested description',
        description: 'A short description',
        prompt: 'This is the prompt body',
      })
    })

    it('strips surrounding double quotes from values', () => {
      const raw = '---\ntitle: "My Template"\ncategory: \'Health\'\n---\nBody'

      const result = parseMarkdownTemplate(raw)

      expect(result.title).toBe('My Template')
      expect(result.category).toBe('Health')
    })

    it('maps cadence alias to cadenceHint', () => {
      const raw = '---\ncadence: Daily\n---\nBody'

      const result = parseMarkdownTemplate(raw)

      expect(result.cadenceHint).toBe('Daily')
    })

    it('ignores unknown frontmatter keys', () => {
      const raw = '---\ntitle: Known\nunknownKey: should be ignored\nfoo: bar\n---\nBody'

      const result = parseMarkdownTemplate(raw)

      expect(result.title).toBe('Known')
      expect(result).not.toHaveProperty('unknownKey')
      expect(result).not.toHaveProperty('foo')
    })

    it('does not throw on malformed frontmatter (no closing ---)', () => {
      const raw = '---\ntitle: broken\nno closing delimiter\n\nBody text'

      const result = parseMarkdownTemplate(raw)

      expect(result.title).toBe('Imported template')
      expect(result.prompt).toBe(raw.trim())
    })

    it('does not throw on empty frontmatter block', () => {
      const raw = '---\n---\n# Title from H1\n\nBody'

      const result = parseMarkdownTemplate(raw)

      expect(result.title).toBe('Title from H1')
      expect(result.prompt).toBe('# Title from H1\n\nBody')
    })

    it('handles frontmatter with only some keys present', () => {
      const raw = '---\ntitle: Partial\ncategory: Test\n---\nBody'

      const result = parseMarkdownTemplate(raw)

      expect(result.title).toBe('Partial')
      expect(result.category).toBe('Test')
      expect(result.cadenceHint).toBeUndefined()
      expect(result.suggestedName).toBe('Partial')
      expect(result.prompt).toBe('Body')
    })
  })

  describe('title derivation', () => {
    it('derives title from first H1 when no frontmatter title', () => {
      const raw = '# My Heading\n\nSome prompt body'

      const result = parseMarkdownTemplate(raw)

      expect(result.title).toBe('My Heading')
      expect(result.prompt).toBe(raw.trim())
    })

    it('derives title from fileName when no frontmatter title and no H1', () => {
      const raw = 'Just some prompt text'

      const result = parseMarkdownTemplate(raw, 'weekly-report.md')

      expect(result.title).toBe('weekly-report')
      expect(result.prompt).toBe(raw.trim())
    })

    it('derives title from fileName stripping .markdown extension', () => {
      const raw = 'Body'

      const result = parseMarkdownTemplate(raw, 'My Template.markdown')

      expect(result.title).toBe('My Template')
    })

    it('uses default title when no frontmatter title, no H1, and no fileName', () => {
      const raw = 'Some prompt'

      const result = parseMarkdownTemplate(raw)

      expect(result.title).toBe('Imported template')
    })

    it('uses default title for empty prompt with no fileName', () => {
      const result = parseMarkdownTemplate('')

      expect(result.title).toBe('Imported template')
      expect(result.prompt).toBe('')
    })
  })

  describe('suggestedName default', () => {
    it('defaults suggestedName to title when not provided', () => {
      const raw = '---\ntitle: My Title\n---\nBody'

      const result = parseMarkdownTemplate(raw)

      expect(result.suggestedName).toBe('My Title')
    })

    it('keeps explicit suggestedName when provided', () => {
      const raw = '---\ntitle: My Title\nsuggestedName: Explicit Name\n---\nBody'

      const result = parseMarkdownTemplate(raw)

      expect(result.suggestedName).toBe('Explicit Name')
    })
  })

  describe('empty and edge cases', () => {
    it('returns empty prompt for empty input', () => {
      const result = parseMarkdownTemplate('')

      expect(result.prompt).toBe('')
      expect(result.title).toBe('Imported template')
    })

    it('handles input with only whitespace', () => {
      const result = parseMarkdownTemplate('   \n  \n  ')

      expect(result.prompt).toBe('')
      expect(result.title).toBe('Imported template')
    })

    it('handles CRLF line endings in frontmatter', () => {
      const raw = '---\r\ntitle: CRLF Test\r\ncategory: Test\r\n---\r\nBody text'

      const result = parseMarkdownTemplate(raw)

      expect(result.title).toBe('CRLF Test')
      expect(result.category).toBe('Test')
      expect(result.prompt).toBe('Body text')
    })
  })

  describe('prompt handling', () => {
    it('returns entire content as prompt when no frontmatter', () => {
      const raw = '# Title\n\nSome **markdown** content\n\n- list item'

      const result = parseMarkdownTemplate(raw)

      expect(result.prompt).toBe(raw.trim())
      expect(result.title).toBe('Title')
    })

    it('trims prompt body', () => {
      const raw = '---\ntitle: Test\n---\n  \n  Body with spaces around  \n  '

      const result = parseMarkdownTemplate(raw)

      expect(result.prompt).toBe('Body with spaces around')
    })

    it('prompt is empty string for frontmatter-only input', () => {
      const raw = '---\ntitle: Test\n---'

      const result = parseMarkdownTemplate(raw)

      expect(result.prompt).toBe('')
    })
  })

  describe('no frontmatter at all', () => {
    it('parses simple markdown without frontmatter', () => {
      const raw = '# Document Title\n\nSome content here'

      const result = parseMarkdownTemplate(raw)

      expect(result.title).toBe('Document Title')
      expect(result.prompt).toBe(raw.trim())
    })

    it('handles text without any markdown headings', () => {
      const raw = 'Just plain text with no heading'

      const result = parseMarkdownTemplate(raw, 'my-file.md')

      expect(result.title).toBe('my-file')
      expect(result.prompt).toBe(raw.trim())
    })
  })
})
