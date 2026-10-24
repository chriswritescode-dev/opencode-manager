import { describe, expect, it } from 'vitest'
import {
  OPENCODE_SERVER_LINK_VERSION,
  buildManagerAppLink,
  buildOpenCodeServerLink,
  parseManagerAppLink,
  parseOpenCodeServerLink,
  type ManagerAppLink,
} from '@opencode-manager/shared/schemas'

const CODE = 'a'.repeat(43)

const MANAGER_LINK: ManagerAppLink = {
  kind: 'manager',
  name: 'Home',
  baseUrl: 'https://m.example.com',
  code: CODE,
  headers: [
    { name: 'CF-Access-Client-Id', value: 'id.access' },
    { name: 'X-Secret', value: 'a:b=c&d' },
  ],
}

const OPENCODE_LINK = {
  kind: 'opencode' as const,
  name: 'build-host',
  baseUrl: 'http://192.168.1.20:4096',
  pairing: { pairUrl: 'http://127.0.0.1:4096/redeem', code: CODE },
}

function managerLink(extra: Record<string, string | string[]>): string {
  const params = new URLSearchParams({
    v: OPENCODE_SERVER_LINK_VERSION,
    kind: 'manager',
    name: 'Home',
    url: 'https://m.example.com',
    code: CODE,
  })
  for (const [key, value] of Object.entries(extra)) {
    params.delete(key)
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item)
  }
  return `ocm://link?${params.toString()}`
}

describe('buildManagerAppLink', () => {
  it('builds an ocm link carrying the version and the manager kind', () => {
    const link = buildManagerAppLink(MANAGER_LINK)
    const params = new URL(link).searchParams

    expect(link.startsWith('ocm://link?')).toBe(true)
    expect(params.get('v')).toBe(OPENCODE_SERVER_LINK_VERSION)
    expect(params.get('kind')).toBe('manager')
  })

  it('keeps the exact wire format of a manager link', () => {
    expect(buildManagerAppLink(MANAGER_LINK)).toBe(
      `ocm://link?v=2&kind=manager&name=Home&url=https%3A%2F%2Fm.example.com&code=${CODE}` +
        '&h=CF-Access-Client-Id%3Aid.access&h=X-Secret%3Aa%3Ab%3Dc%26d',
    )
  })

  it('appends one h parameter per header in order', () => {
    const params = new URL(buildManagerAppLink(MANAGER_LINK)).searchParams

    expect(params.getAll('h')).toEqual(['CF-Access-Client-Id:id.access', 'X-Secret:a:b=c&d'])
  })
})

describe('buildOpenCodeServerLink', () => {
  it('keeps the exact wire format of an opencode link', () => {
    expect(buildOpenCodeServerLink(OPENCODE_LINK)).toBe(
      `ocm://link?v=2&kind=opencode&name=build-host&url=http%3A%2F%2F192.168.1.20%3A4096` +
        `&pair=http%3A%2F%2F127.0.0.1%3A4096%2Fredeem&code=${CODE}`,
    )
  })
})

describe('parseManagerAppLink', () => {
  it('round-trips a manager link with headers in order', () => {
    expect(parseManagerAppLink(buildManagerAppLink(MANAGER_LINK))).toEqual(MANAGER_LINK)
  })

  it('round-trips a manager link without headers', () => {
    const link = { ...MANAGER_LINK, headers: [] }

    expect(parseManagerAppLink(buildManagerAppLink(link))).toEqual(link)
  })

  it.each([
    ['an opencode link', buildOpenCodeServerLink(OPENCODE_LINK)],
    ['a wrong version', managerLink({ v: '3' })],
    ['a header without a colon', managerLink({ h: 'X-Secret' })],
    ['a blocked header name', managerLink({ h: 'Cookie:session' })],
    ['a forwarding header name', managerLink({ h: 'X-Forwarded-For:1.2.3.4' })],
    ['more than eight headers', managerLink({ h: Array.from({ length: 9 }, (_, index) => `X-Header-${index}:value`) })],
    ['garbage text', 'not a link'],
  ])('returns null for %s', (_label, text) => {
    expect(parseManagerAppLink(text)).toBeNull()
  })
})

describe('manager and opencode link kinds', () => {
  it('does not parse a manager link as an opencode link', () => {
    expect(parseOpenCodeServerLink(buildManagerAppLink(MANAGER_LINK))).toBeNull()
  })

  it('keeps the opencode link round trip unchanged', () => {
    expect(parseOpenCodeServerLink(buildOpenCodeServerLink(OPENCODE_LINK))).toEqual(OPENCODE_LINK)
  })
})
