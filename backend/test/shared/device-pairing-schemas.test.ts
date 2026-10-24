import { describe, expect, it } from 'vitest'
import {
  AppLinkBlockedReasonSchema,
  DevicePairingAvailabilitySchema,
  REMOTE_ACCESS_HEADERS_MAX_ENCODED_LENGTH,
  REMOTE_ACCESS_HEADER_VALUE_MAX_LENGTH,
  RedeemDevicePairingCodeResponseSchema,
  RemoteAccessHeaderDraftValueSchema,
  RemoteAccessHeaderListSchema,
  ReplaceRemoteAccessHeadersRequestSchema,
  buildManagerBrowserPairingLink,
  parseManagerBrowserPairingLink,
  readPairingCodeFromHash,
} from '@opencode-manager/shared/schemas'

const CODE = 'a'.repeat(43)

function header(name: string, value = 'value') {
  return { name, value }
}

function encodedLength(headers: Array<{ name: string; value: string }>): number {
  const params = new URLSearchParams()
  for (const entry of headers) params.append('h', `${entry.name}:${entry.value}`)
  return params.toString().length
}

function headersFillingQrLimit(extraCharacters = 0): Array<{ name: string; value: string }> {
  const headers = Array.from({ length: 8 }, (_, index) => header(`X-H-${index}`, ''))
  let remaining = REMOTE_ACCESS_HEADERS_MAX_ENCODED_LENGTH - encodedLength(headers) + extraCharacters
  return headers.map((entry, index) => {
    const length = Math.min(
      Math.ceil(remaining / (headers.length - index)),
      REMOTE_ACCESS_HEADER_VALUE_MAX_LENGTH,
    )
    remaining -= length
    return { name: entry.name, value: 'a'.repeat(length) }
  })
}

describe('RemoteAccessHeaderListSchema', () => {
  it('accepts Cloudflare Access headers and values containing colons', () => {
    const result = RemoteAccessHeaderListSchema.safeParse([
      header('CF-Access-Client-Id', 'abc.access'),
      header('X-Token', 'a:b:c'),
    ])

    expect(result.success).toBe(true)
  })

  it.each([
    ['a carriage return', 'a\rb'],
    ['a line feed', 'a\nb'],
    ['a null byte', 'a\0b'],
  ])('rejects a value containing %s', (_label, value) => {
    expect(RemoteAccessHeaderListSchema.safeParse([header('X-Token', value)]).success).toBe(false)
  })

  it.each(['X Token', 'X:Token', 'X Token:'])('rejects the invalid header name %s', (name) => {
    expect(RemoteAccessHeaderListSchema.safeParse([header(name)]).success).toBe(false)
  })

  it.each([
    'Cookie',
    'set-cookie',
    'HOST',
    'Origin',
    'Content-Length',
    'Content-Type',
    'Connection',
    'Transfer-Encoding',
    'Upgrade',
    'TE',
    'Keep-Alive',
    'Proxy-Authorization',
    'X-Forwarded-For',
    'X-Forwarded-Host',
    'X-Forwarded-Proto',
    'Forwarded',
    'X-Real-IP',
    'CF-Connecting-IP',
  ])('rejects the blocked header name %s in any case', (name) => {
    expect(RemoteAccessHeaderListSchema.safeParse([header(name)]).success).toBe(false)
  })

  it('rejects more than eight headers', () => {
    const headers = Array.from({ length: 9 }, (_, index) => header(`X-Header-${index}`))
    expect(RemoteAccessHeaderListSchema.safeParse(headers).success).toBe(false)
  })

  it('accepts a typical Cloudflare Access header pair', () => {
    const headers = [
      header('CF-Access-Client-Id', `${'a'.repeat(64)}.access`),
      header('CF-Access-Client-Secret', 'b'.repeat(64)),
    ]

    expect(RemoteAccessHeaderListSchema.safeParse(headers).success).toBe(true)
    expect(encodedLength(headers)).toBeLessThan(REMOTE_ACCESS_HEADERS_MAX_ENCODED_LENGTH)
  })

  it('accepts headers that encode to exactly the QR limit', () => {
    const headers = headersFillingQrLimit()

    expect(encodedLength(headers)).toBe(REMOTE_ACCESS_HEADERS_MAX_ENCODED_LENGTH)
    expect(RemoteAccessHeaderListSchema.safeParse(headers).success).toBe(true)
  })

  it('rejects headers that encode to one character over the QR limit', () => {
    const headers = headersFillingQrLimit(1)

    expect(encodedLength(headers)).toBe(REMOTE_ACCESS_HEADERS_MAX_ENCODED_LENGTH + 1)
    expect(RemoteAccessHeaderListSchema.safeParse(headers).success).toBe(false)
  })

  it('rejects eight 512-character values because they no longer fit in the QR code', () => {
    const headers = Array.from({ length: 8 }, (_, index) => header(`X-Header-${index}`, 'a'.repeat(512)))

    expect(RemoteAccessHeaderListSchema.safeParse(headers).success).toBe(false)
  })

  it('reports the encoded limit when the list is too long for a QR code', () => {
    const result = RemoteAccessHeaderListSchema.safeParse(headersFillingQrLimit(1))

    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      `Remote access headers are too long to fit in a QR code (limit ${REMOTE_ACCESS_HEADERS_MAX_ENCODED_LENGTH} encoded characters)`,
    )
  })

  it('rejects a 513-character value', () => {
    expect(RemoteAccessHeaderListSchema.safeParse([header('X-Token', 'a'.repeat(513))]).success).toBe(false)
  })

  it('rejects duplicate names that differ only in case', () => {
    expect(
      RemoteAccessHeaderListSchema.safeParse([header('X-Token', 'one'), header('x-token', 'two')]).success,
    ).toBe(false)
  })
})

describe('RemoteAccessHeaderDraftValueSchema', () => {
  it('accepts a blank value, meaning the stored value is kept', () => {
    expect(RemoteAccessHeaderDraftValueSchema.safeParse('   ')).toEqual({ success: true, data: '' })
  })

  it('trims a provided value', () => {
    const result = RemoteAccessHeaderDraftValueSchema.safeParse('  secret  ')

    expect(result.success && result.data).toBe('secret')
  })

  it.each([
    ['a carriage return', 'a\rb'],
    ['a line feed', 'a\nb'],
    ['a null byte', 'a\0b'],
  ])('rejects a value containing %s', (_label, value) => {
    expect(RemoteAccessHeaderDraftValueSchema.safeParse(value).success).toBe(false)
  })

  it('accepts a draft entry without a value in the replace request', () => {
    const result = ReplaceRemoteAccessHeadersRequestSchema.safeParse({
      headers: [{ name: 'CF-Access-Client-Id' }, { name: 'CF-Access-Client-Secret', value: 'secret' }],
    })

    expect(result.success).toBe(true)
  })

  it('rejects a draft entry whose value contains a line break', () => {
    const result = ReplaceRemoteAccessHeadersRequestSchema.safeParse({
      headers: [{ name: 'CF-Access-Client-Secret', value: 'sec\r\nret' }],
    })

    expect(result.success).toBe(false)
  })
})

describe('DevicePairingAvailabilitySchema', () => {
  it('accepts an available origin', () => {
    expect(
      DevicePairingAvailabilitySchema.parse({ available: true, reason: null, message: null }),
    ).toEqual({ available: true, reason: null, message: null })
  })

  it.each(['untrusted-origin', 'loopback', 'insecure-origin'])(
    'accepts the unavailable reason %s',
    (reason) => {
      expect(
        DevicePairingAvailabilitySchema.parse({ available: false, reason, message: 'blocked' }),
      ).toEqual({ available: false, reason, message: 'blocked' })
    },
  )

  it('rejects an unknown reason', () => {
    expect(
      DevicePairingAvailabilitySchema.safeParse({ available: false, reason: 'no-origin', message: 'x' })
        .success,
    ).toBe(false)
  })
})

describe('AppLinkBlockedReasonSchema', () => {
  it('accepts an insecure origin', () => {
    expect(AppLinkBlockedReasonSchema.parse('insecure-origin')).toBe('insecure-origin')
  })

  it('no longer accepts loopback, which now blocks pairing entirely', () => {
    expect(AppLinkBlockedReasonSchema.safeParse('loopback').success).toBe(false)
  })
})

describe('RedeemDevicePairingCodeResponseSchema', () => {
  it('parses the user returned by the redeem endpoint', () => {
    const response = { user: { id: 'user_1', name: 'Chris', email: 'chris@example.com' } }

    expect(RedeemDevicePairingCodeResponseSchema.parse(response)).toEqual(response)
  })

  it('rejects a response without a user email', () => {
    expect(RedeemDevicePairingCodeResponseSchema.safeParse({ user: { id: 'user_1', name: 'Chris' } }).success).toBe(
      false,
    )
  })
})

describe('buildManagerBrowserPairingLink', () => {
  it('builds a browser pairing link with the code in the fragment', () => {
    expect(buildManagerBrowserPairingLink('https://m.example.com', CODE)).toBe(
      `https://m.example.com/pair#c=${CODE}`,
    )
  })

  it('trims trailing slashes and whitespace from the origin', () => {
    expect(buildManagerBrowserPairingLink(' https://m.example.com/ ', CODE)).toBe(
      `https://m.example.com/pair#c=${CODE}`,
    )
  })
})

describe('parseManagerBrowserPairingLink', () => {
  it('parses a browser pairing link built by the shared builder', () => {
    expect(parseManagerBrowserPairingLink(buildManagerBrowserPairingLink('https://m.example.com', CODE))).toEqual({
      origin: 'https://m.example.com',
      code: CODE,
    })
  })

  it.each([
    ['a wrong path', `https://m.example.com/other#c=${CODE}`],
    ['a missing code', 'https://m.example.com/pair'],
    ['an empty code', 'https://m.example.com/pair#c='],
    ['a non-http scheme', `ocm://link?v=2&kind=manager#c=${CODE}`],
    ['garbage text', 'not a pairing link'],
  ])('returns null for %s', (_label, text) => {
    expect(parseManagerBrowserPairingLink(text)).toBeNull()
  })
})

describe('readPairingCodeFromHash', () => {
  it('reads a valid code from the fragment', () => {
    expect(readPairingCodeFromHash(`#c=${CODE}`)).toBe(CODE)
  })

  it('returns null for a missing or invalid code', () => {
    expect(readPairingCodeFromHash('')).toBeNull()
    expect(readPairingCodeFromHash('#c=short')).toBeNull()
  })
})
