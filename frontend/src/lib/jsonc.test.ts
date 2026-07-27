import { describe, it, expect } from 'vitest'
import { parseJsonc, parseJsoncErrorLine, resolveJsoncIssueLine } from './jsonc'

const CONFIG = `{
  "$schema": "https://opencode.ai/config.json",
  "theme": "system",
  "model": "anthropic/claude-sonnet-4",
  "provider": {
    "anthropic": {
      "options": {
        "apiKey": "sk-test"
      }
    }
  }
}`

describe('parseJsoncErrorLine', () => {
  it('extracts the line from a parseJsonc SyntaxError', () => {
    let line: number | null = null
    try {
      parseJsonc('{\n  "a": 1,\n  "b" 2\n}')
    } catch (error) {
      line = parseJsoncErrorLine(error)
    }
    expect(line).toBe(3)
  })

  it('returns null for a non-syntax error', () => {
    expect(parseJsoncErrorLine(new Error('network down'))).toBeNull()
  })

  it('returns null for a syntax error with no location', () => {
    expect(parseJsoncErrorLine(new SyntaxError('Invalid JSONC'))).toBeNull()
  })
})

describe('resolveJsoncIssueLine', () => {
  it('resolves a top-level property to its line', () => {
    expect(resolveJsoncIssueLine(CONFIG, 'theme')).toBe(3)
  })

  it('resolves a nested property path', () => {
    expect(resolveJsoncIssueLine(CONFIG, 'provider.anthropic.options.apiKey')).toBe(8)
  })

  it('resolves a structured property path containing a dotted object key', () => {
    const dotted = `{
  "provider": {
    "api.example.com": {
      "key": "x"
    }
  }
}`
    expect(resolveJsoncIssueLine(dotted, ['provider', 'api.example.com', 'key'])).toBe(4)
  })

  it('resolves a structured array index path', () => {
    expect(resolveJsoncIssueLine('{\n  "tools": [\n    "a",\n    "b"\n  ]\n}', ['tools', 1])).toBe(4)
  })

  it('returns null for an unknown structured path', () => {
    expect(resolveJsoncIssueLine(CONFIG, ['provider', 'anthropic', 'missing'])).toBeNull()
  })

  it('resolves an array index segment', () => {
    expect(resolveJsoncIssueLine('{\n  "tools": [\n    "a",\n    "b"\n  ]\n}', 'tools.1')).toBe(4)
  })

  it('returns null for an unknown path', () => {
    expect(resolveJsoncIssueLine(CONFIG, 'nope.missing')).toBeNull()
  })

  it('returns null for the synthetic root path', () => {
    expect(resolveJsoncIssueLine(CONFIG, 'root')).toBeNull()
  })

  it('returns null when the content cannot be parsed into a tree', () => {
    expect(resolveJsoncIssueLine('', 'theme')).toBeNull()
  })
})
