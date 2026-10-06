import { describe, it, expect } from 'vitest'
import { extractFirstJsonObject } from '../../src/utils/json-extract'

describe('extractFirstJsonObject', () => {
  it('returns a plain JSON object', () => {
    expect(extractFirstJsonObject('{"a":1}')).toBe('{"a":1}')
  })

  it('returns the first object when several are present', () => {
    expect(extractFirstJsonObject('prefix {"a":1} middle {"b":2} suffix')).toBe('{"a":1}')
  })

  it('ignores prose before and after the object', () => {
    expect(extractFirstJsonObject('Here you go:\n{"a":1}\nThanks')).toBe('{"a":1}')
  })

  it('matches nested braces', () => {
    expect(extractFirstJsonObject('{"a":{"b":{"c":1}},"d":2}')).toBe('{"a":{"b":{"c":1}},"d":2}')
  })

  it('ignores braces inside strings', () => {
    expect(extractFirstJsonObject('{"a":"}{","b":1}')).toBe('{"a":"}{","b":1}')
  })

  it('handles escaped quotes inside strings', () => {
    expect(extractFirstJsonObject('{"a":"a \\" b","c":2}')).toBe('{"a":"a \\" b","c":2}')
  })

  it('returns null when there is no object', () => {
    expect(extractFirstJsonObject('no object here')).toBeNull()
  })

  it('returns null for an unterminated object', () => {
    expect(extractFirstJsonObject('{"a":1')).toBeNull()
  })

  it('returns null when a string is left open', () => {
    expect(extractFirstJsonObject('{"a":"unterminated}')).toBeNull()
  })
})
