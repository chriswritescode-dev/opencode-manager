import { describe, expect, it } from 'vitest'
import {
  OPENCODE_MIN_VERSION,
  OPENCODE_PINNED_VERSION,
  OPENCODE_SERVER_USERNAME,
  buildOpenCodeBasicAuth,
  buildOpenCodeReleaseAsset,
  createOpenCodeApi,
  isSupportedOpenCodeVersion,
  openCodeLocation,
} from '@opencode-manager/shared/opencode'

interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
}

function createFetchSpy() {
  const calls: CapturedRequest[] = []
  const fetchSpy = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    })
    return new Response(JSON.stringify({ location: { directory: '/repo' }, data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  return { calls, fetchSpy }
}

describe('OpenCode v2 contract', () => {
  describe('version policy', () => {
    it('pins the client version and the fixed V2 server username', () => {
      expect(OPENCODE_MIN_VERSION).toBe('2.0.0')
      expect(OPENCODE_PINNED_VERSION).toBe('2.0.15')
      expect(OPENCODE_SERVER_USERNAME).toBe('opencode')
    })

    it('accepts v2 releases at or above the minimum and rejects other majors', () => {
      expect(isSupportedOpenCodeVersion('1.18.32')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.0')).toBe(true)
      expect(isSupportedOpenCodeVersion('2.0.15')).toBe(true)
      expect(isSupportedOpenCodeVersion('2.1.0')).toBe(true)
      expect(isSupportedOpenCodeVersion('v2.0.0')).toBe(true)
      expect(isSupportedOpenCodeVersion('3.0.0')).toBe(false)
      expect(isSupportedOpenCodeVersion('not-a-version')).toBe(false)
    })

    it('rejects prereleases of the minimum version', () => {
      expect(isSupportedOpenCodeVersion('2.0.0-alpha.1')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.0-alpha')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.0-rc.1+build.5')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.0-0')).toBe(false)
    })

    it('accepts prereleases of higher numeric cores', () => {
      expect(isSupportedOpenCodeVersion('2.1.0-beta.1')).toBe(true)
      expect(isSupportedOpenCodeVersion('2.0.1-rc.2')).toBe(true)
    })

    it('ignores build metadata for precedence', () => {
      expect(isSupportedOpenCodeVersion('2.0.0+build')).toBe(true)
      expect(isSupportedOpenCodeVersion('2.0.0+2.0.0')).toBe(true)
    })

    it('rejects malformed and incomplete versions', () => {
      expect(isSupportedOpenCodeVersion('2garbage')).toBe(false)
      expect(isSupportedOpenCodeVersion('2')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.0.1')).toBe(false)
      expect(isSupportedOpenCodeVersion('02.0.0')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.0-alpha..1')).toBe(false)
      expect(isSupportedOpenCodeVersion('')).toBe(false)
    })
  })

  describe('buildOpenCodeBasicAuth', () => {
    it('encodes the fixed V2 username with the server password', () => {
      expect(buildOpenCodeBasicAuth('pw')).toBe('Basic b3BlbmNvZGU6cHc=')
    })

    it('encodes non-ASCII passwords as UTF-8 bytes', () => {
      expect(buildOpenCodeBasicAuth('pä')).toBe(
        `Basic ${Buffer.from('opencode:pä', 'utf8').toString('base64')}`,
      )
    })
  })

  describe('openCodeLocation', () => {
    it('wraps a directory into the V2 location input', () => {
      expect(openCodeLocation('/repo')).toEqual({ location: { directory: '/repo' } })
    })
  })

  describe('createOpenCodeApi', () => {
    it('sends Basic auth and the location encoding of the official client', async () => {
      const { calls, fetchSpy } = createFetchSpy()
      const api = createOpenCodeApi({ baseUrl: 'http://127.0.0.1:1/prefix', password: 'pw', fetch: fetchSpy })

      await api.agent.list(openCodeLocation('/repo'))

      expect(calls).toEqual([
        {
          url: 'http://127.0.0.1:1/prefix/api/agent?location%5Bdirectory%5D=%2Frepo',
          method: 'GET',
          headers: { authorization: 'Basic b3BlbmNvZGU6cHc=' },
        },
      ])
    })

    it('omits the auth header without a password and keeps caller headers', async () => {
      const { calls, fetchSpy } = createFetchSpy()
      const api = createOpenCodeApi({
        baseUrl: 'http://127.0.0.1:1/prefix',
        fetch: fetchSpy,
        headers: { 'x-manager-request': 'abc' },
      })

      await api.agent.list()

      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe('http://127.0.0.1:1/prefix/api/agent')
      expect(calls[0]?.headers).toEqual({ 'x-manager-request': 'abc' })
    })
  })

  describe('buildOpenCodeReleaseAsset', () => {
    it('builds tar.gz assets for linux x64, arm64 and musl', () => {
      expect(buildOpenCodeReleaseAsset('2.0.15', { platform: 'linux', arch: 'x86_64', musl: false })).toEqual({
        url: 'https://opencode.ai/files/bin/2.0.15/opencode-linux-x64.tar.gz',
        archive: 'tar.gz',
      })
      expect(buildOpenCodeReleaseAsset('2.0.15', { platform: 'linux', arch: 'amd64', musl: false }).url).toBe(
        'https://opencode.ai/files/bin/2.0.15/opencode-linux-x64.tar.gz',
      )
      expect(buildOpenCodeReleaseAsset('2.0.15', { platform: 'linux', arch: 'aarch64', musl: false }).url).toBe(
        'https://opencode.ai/files/bin/2.0.15/opencode-linux-arm64.tar.gz',
      )
      expect(buildOpenCodeReleaseAsset('2.0.15', { platform: 'linux', arch: 'arm64', musl: false }).url).toBe(
        'https://opencode.ai/files/bin/2.0.15/opencode-linux-arm64.tar.gz',
      )
      expect(buildOpenCodeReleaseAsset('2.0.15', { platform: 'linux', arch: 'x64', musl: true })).toEqual({
        url: 'https://opencode.ai/files/bin/2.0.15/opencode-linux-x64-musl.tar.gz',
        archive: 'tar.gz',
      })
    })

    it('builds zip assets for darwin arm64', () => {
      expect(buildOpenCodeReleaseAsset('2.0.15', { platform: 'darwin', arch: 'arm64', musl: false })).toEqual({
        url: 'https://opencode.ai/files/bin/2.0.15/opencode-darwin-arm64.zip',
        archive: 'zip',
      })
    })

    it('rejects unsupported platforms and architectures', () => {
      expect(() => buildOpenCodeReleaseAsset('2.0.15', { platform: 'win32', arch: 'x64', musl: false })).toThrow()
      expect(() => buildOpenCodeReleaseAsset('2.0.15', { platform: 'linux', arch: 'ia32', musl: false })).toThrow()
    })
  })
})
