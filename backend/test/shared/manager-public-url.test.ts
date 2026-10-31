import { describe, it, expect, vi, afterEach } from 'vitest'

const originalEnv = {
  MANAGER_PUBLIC_URL: process.env.MANAGER_PUBLIC_URL,
  AUTH_TRUSTED_ORIGINS: process.env.AUTH_TRUSTED_ORIGINS,
  PASSKEY_ORIGIN: process.env.PASSKEY_ORIGIN,
  PASSKEY_RP_ID: process.env.PASSKEY_RP_ID,
}

type EnvName = keyof typeof originalEnv

const ENV_NAMES = Object.keys(originalEnv) as EnvName[]

function setEnv(name: EnvName, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

afterEach(() => {
  for (const name of ENV_NAMES) {
    setEnv(name, originalEnv[name])
  }
  vi.resetModules()
})

async function loadEnv(overrides: Partial<Record<EnvName, string>> = {}) {
  for (const name of ENV_NAMES) {
    setEnv(name, overrides[name])
  }
  vi.resetModules()
  return import('@opencode-manager/shared/config/env')
}

describe('parseManagerPublicUrl', () => {
  it('accepts an origin without a trailing slash', async () => {
    const { parseManagerPublicUrl } = await loadEnv()

    expect(parseManagerPublicUrl('https://m.example.com')).toEqual({ origin: 'https://m.example.com', error: null })
  })

  it('accepts an origin with a root trailing slash', async () => {
    const { parseManagerPublicUrl } = await loadEnv()

    expect(parseManagerPublicUrl('https://m.example.com/')).toEqual({ origin: 'https://m.example.com', error: null })
  })

  it.each([
    'm.example.com',
    'ftp://x',
    'https://m.example.com/app',
    'https://m.example.com?x=1',
    'https://u:p@m.example.com',
  ])('rejects %s', async (value) => {
    const { parseManagerPublicUrl } = await loadEnv()
    const result = parseManagerPublicUrl(value)

    expect(result.origin).toBeNull()
    expect(result.error).toContain('MANAGER_PUBLIC_URL')
  })

  it('treats an unset value as unconfigured', async () => {
    const { parseManagerPublicUrl } = await loadEnv()

    expect(parseManagerPublicUrl(undefined)).toEqual({ origin: null, error: null })
  })

  it('treats a whitespace-only value as unconfigured', async () => {
    const { parseManagerPublicUrl } = await loadEnv()

    expect(parseManagerPublicUrl('   ')).toEqual({ origin: null, error: null })
  })
})

describe('getTrustedOrigins with MANAGER_PUBLIC_URL', () => {
  it('prepends the public origin to the default trusted origins', async () => {
    const { getTrustedOrigins } = await loadEnv({ MANAGER_PUBLIC_URL: 'https://m.example.com' })

    expect(getTrustedOrigins()).toEqual([
      'https://m.example.com',
      'http://localhost:5173',
      'http://localhost:5003',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5003',
    ])
  })

  it('deduplicates the public origin against configured origins while keeping it first', async () => {
    const { getTrustedOrigins } = await loadEnv({
      MANAGER_PUBLIC_URL: 'https://m.example.com',
      AUTH_TRUSTED_ORIGINS: 'http://localhost:5173,https://m.example.com',
    })

    expect(getTrustedOrigins()).toEqual(['https://m.example.com', 'http://localhost:5173'])
  })

  it('keeps the local development origins when MANAGER_PUBLIC_URL is unset', async () => {
    const { getTrustedOrigins } = await loadEnv()

    expect(getTrustedOrigins()).toEqual([
      'http://localhost:5173',
      'http://localhost:5003',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5003',
    ])
  })
})

describe('passkey config derived from MANAGER_PUBLIC_URL', () => {
  it('derives the passkey origin and relying party id from the public origin', async () => {
    const { ENV, getPasskeyDefaultsWarning } = await loadEnv({ MANAGER_PUBLIC_URL: 'https://m.example.com' })

    expect(ENV.AUTH.PASSKEY_ORIGIN).toBe('https://m.example.com')
    expect(ENV.AUTH.PASSKEY_RP_ID).toBe('m.example.com')
    expect(getPasskeyDefaultsWarning()).toBeNull()
  })

  it('keeps the localhost passkey defaults for an IPv4 public address', async () => {
    const { ENV, getPasskeyDefaultsWarning } = await loadEnv({ MANAGER_PUBLIC_URL: 'http://192.168.1.20:5003' })

    expect(ENV.AUTH.PASSKEY_RP_ID).toBe('localhost')
    expect(ENV.AUTH.PASSKEY_ORIGIN).toBe('http://localhost:5003')
    const warning = getPasskeyDefaultsWarning()
    expect(warning).toEqual(expect.any(String))
    expect(warning).toContain('PASSKEY_RP_ID')
  })

  it('keeps the localhost passkey defaults for an IPv6 public address', async () => {
    const { ENV, getPasskeyDefaultsWarning } = await loadEnv({ MANAGER_PUBLIC_URL: 'http://[fd00::1]:5003' })

    expect(ENV.AUTH.PASSKEY_RP_ID).toBe('localhost')
    expect(ENV.AUTH.PASSKEY_ORIGIN).toBe('http://localhost:5003')
    expect(getPasskeyDefaultsWarning()).toContain('PASSKEY_RP_ID')
  })

  it('keeps an explicit relying party id for an IPv4 public address without warning', async () => {
    const { ENV, getPasskeyDefaultsWarning } = await loadEnv({
      MANAGER_PUBLIC_URL: 'http://192.168.1.20:5003',
      PASSKEY_RP_ID: 'example.test',
    })

    expect(ENV.AUTH.PASSKEY_RP_ID).toBe('example.test')
    expect(getPasskeyDefaultsWarning()).toBeNull()
  })

  it('keeps explicit passkey settings when both are provided', async () => {
    const { ENV } = await loadEnv({
      MANAGER_PUBLIC_URL: 'https://m.example.com',
      PASSKEY_ORIGIN: 'https://explicit.test',
      PASSKEY_RP_ID: 'explicit.test',
    })

    expect(ENV.AUTH.PASSKEY_ORIGIN).toBe('https://explicit.test')
    expect(ENV.AUTH.PASSKEY_RP_ID).toBe('explicit.test')
  })

  it('falls back to the public origin when PASSKEY_ORIGIN is empty', async () => {
    const { ENV } = await loadEnv({ MANAGER_PUBLIC_URL: 'https://m.example.com', PASSKEY_ORIGIN: '' })

    expect(ENV.AUTH.PASSKEY_ORIGIN).toBe('https://m.example.com')
  })

  it('keeps the local development passkey defaults when MANAGER_PUBLIC_URL is unset', async () => {
    const { ENV } = await loadEnv()

    expect(ENV.AUTH.PASSKEY_ORIGIN).toBe('http://localhost:5003')
    expect(ENV.AUTH.PASSKEY_RP_ID).toBe('localhost')
  })
})
