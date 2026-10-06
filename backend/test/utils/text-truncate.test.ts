import { describe, expect, it } from 'vitest'
import { truncateText } from '../../src/utils/text-truncate'

describe('truncateText', () => {
  it('returns text unchanged when it is within the limit', () => {
    expect(truncateText('hello', 10, '[cut]')).toEqual({ text: 'hello', truncated: false })
  })

  it('returns text unchanged when it is exactly at the limit', () => {
    expect(truncateText('hello', 5, '[cut]')).toEqual({ text: 'hello', truncated: false })
  })

  it('slices to the limit, appends the marker and reports truncation', () => {
    expect(truncateText('hello world', 5, '…')).toEqual({ text: 'hello…', truncated: true })
  })

  it('supports a zero limit', () => {
    expect(truncateText('hello', 0, '[cut]')).toEqual({ text: '[cut]', truncated: true })
  })

  it('leaves empty text untouched', () => {
    expect(truncateText('', 5, '[cut]')).toEqual({ text: '', truncated: false })
  })
})
