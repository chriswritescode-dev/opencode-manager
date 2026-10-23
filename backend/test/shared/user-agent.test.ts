import { describe, expect, it } from 'vitest'
import { describeUserAgent } from '@opencode-manager/shared/utils'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
const MACOS_FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0'
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.80'

describe('describeUserAgent', () => {
  it('describes iPhone Safari', () => {
    expect(describeUserAgent(IPHONE_SAFARI)).toBe('Safari on iPhone')
  })

  it('describes iPhone Chrome', () => {
    expect(describeUserAgent(IPHONE_CHROME)).toBe('Chrome on iPhone')
  })

  it('describes Android Chrome without reporting Linux', () => {
    expect(describeUserAgent(ANDROID_CHROME)).toBe('Chrome on Android')
  })

  it('describes macOS Firefox', () => {
    expect(describeUserAgent(MACOS_FIREFOX)).toBe('Firefox on macOS')
  })

  it('describes Windows Edge before Chrome', () => {
    expect(describeUserAgent(WINDOWS_EDGE)).toBe('Edge on Windows')
  })

  it('falls back to Unknown device for empty input', () => {
    expect(describeUserAgent(null)).toBe('Unknown device')
    expect(describeUserAgent('')).toBe('Unknown device')
  })

  it('returns an unrecognized user agent verbatim', () => {
    expect(describeUserAgent('curl/8.4.0')).toBe('curl/8.4.0')
  })

  it('truncates a long unrecognized user agent to 80 characters', () => {
    const result = describeUserAgent('x'.repeat(120))
    expect(result).toBe('x'.repeat(80))
    expect(result.length).toBe(80)
  })
})
