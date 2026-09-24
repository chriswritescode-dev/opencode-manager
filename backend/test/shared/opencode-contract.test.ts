import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  OPENCODE_PINNED_VERSION,
  OPENCODE_SERVER_USERNAME,
  OPENCODE_SUPPORTED_VERSION_RANGE,
  buildOpenCodeBasicAuth,
  buildOpenCodeReleaseAsset,
  compareOpenCodeVersions,
  createOpenCodeApi,
  describeUnsupportedOpenCodeVersion,
  isStableOpenCodeVersion,
  isSupportedOpenCodeVersion,
  normalizeOpenCodeVersion,
  openCodeLocation,
  parseOpenCodeVersion,
  parseOpenCodeVersionOutput,
} from '@opencode-manager/shared/opencode'

const REPO_ROOT = join(__dirname, '..', '..', '..')

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
    it('pins the client version, derives the floor from it and fixes the V2 server username', () => {
      expect(OPENCODE_PINNED_VERSION).toBe('2.0.15')
      expect(OPENCODE_SUPPORTED_VERSION_RANGE).toBe('>=2.0.15 <3.0.0')
      expect(OPENCODE_SERVER_USERNAME).toBe('opencode')
    })

    it('accepts releases of the pinned major at or above the pin and rejects everything else', () => {
      expect(isSupportedOpenCodeVersion('1.18.32')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.0')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.14')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.15')).toBe(true)
      expect(isSupportedOpenCodeVersion('2.0.16')).toBe(true)
      expect(isSupportedOpenCodeVersion('2.1.0')).toBe(true)
      expect(isSupportedOpenCodeVersion('v2.0.15')).toBe(true)
      expect(isSupportedOpenCodeVersion(' v2.0.15 ')).toBe(true)
      expect(isSupportedOpenCodeVersion('3.0.0')).toBe(false)
      expect(isSupportedOpenCodeVersion('3.1.0')).toBe(false)
      expect(isSupportedOpenCodeVersion('not-a-version')).toBe(false)
    })

    it('rejects prereleases of the pinned version', () => {
      expect(isSupportedOpenCodeVersion('2.0.15-alpha.1')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.15-alpha')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.15-rc.1+build.5')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.15-0')).toBe(false)
    })

    it('accepts prereleases of higher numeric cores within the pinned major', () => {
      expect(isSupportedOpenCodeVersion('2.1.0-beta.1')).toBe(true)
      expect(isSupportedOpenCodeVersion('2.0.16-rc.2')).toBe(true)
      expect(isSupportedOpenCodeVersion('3.0.0-beta.1')).toBe(false)
    })

    it('ignores build metadata for precedence', () => {
      expect(isSupportedOpenCodeVersion('2.0.15+build')).toBe(true)
      expect(isSupportedOpenCodeVersion('2.0.15+2.0.0')).toBe(true)
    })

    it('rejects malformed and incomplete versions', () => {
      expect(isSupportedOpenCodeVersion('2garbage')).toBe(false)
      expect(isSupportedOpenCodeVersion('2')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.15.1')).toBe(false)
      expect(isSupportedOpenCodeVersion('02.0.15')).toBe(false)
      expect(isSupportedOpenCodeVersion('2.0.15-alpha..1')).toBe(false)
      expect(isSupportedOpenCodeVersion('')).toBe(false)
    })

    it('describes the supported range for unsupported versions', () => {
      expect(describeUnsupportedOpenCodeVersion('3.0.0')).toBe(
        'OpenCode 3.0.0 is not supported; OpenCode Manager requires OpenCode >=2.0.15 <3.0.0',
      )
    })
  })

  describe('version parsing', () => {
    it('normalizes surrounding whitespace and a leading v', () => {
      expect(normalizeOpenCodeVersion(' v2.0.15\n')).toBe('2.0.15')
      expect(normalizeOpenCodeVersion('2.0.15')).toBe('2.0.15')
    })

    it('parses version components and prerelease identifiers', () => {
      expect(parseOpenCodeVersion('v2.1.3-beta.4')).toEqual({ major: 2, minor: 1, patch: 3, prerelease: ['beta', 4] })
      expect(parseOpenCodeVersion('2.1')).toBeNull()
    })

    it('identifies stable MAJOR.MINOR.PATCH versions', () => {
      expect(isStableOpenCodeVersion('v2.0.15')).toBe(true)
      expect(isStableOpenCodeVersion('2.1.0-beta.1')).toBe(false)
      expect(isStableOpenCodeVersion('2.0.15; cat /etc/passwd')).toBe(false)
    })

    it('orders versions by semver precedence', () => {
      expect(compareOpenCodeVersions('2.0.15', '2.0.14')).toBeGreaterThan(0)
      expect(compareOpenCodeVersions('v2.0.15', '2.0.15')).toBe(0)
      expect(compareOpenCodeVersions('2.0.9', '2.0.10')).toBeLessThan(0)
      expect(compareOpenCodeVersions('2.1.0-beta.1', '2.1.0')).toBeLessThan(0)
      expect(() => compareOpenCodeVersions('invalid', '2.0.15')).toThrow(/invalid/)
    })

    it('extracts the version from opencode --version output', () => {
      expect(parseOpenCodeVersionOutput('2.0.15\n')).toBe('2.0.15')
      expect(parseOpenCodeVersionOutput('opencode v2.0.15\n')).toBe('2.0.15')
      expect(parseOpenCodeVersionOutput('opencode 2.1.0-beta.1 (linux-x64)')).toBe('2.1.0-beta.1')
      expect(parseOpenCodeVersionOutput('version 2.0.15.')).toBe('2.0.15')
      expect(parseOpenCodeVersionOutput('warning: something\nopencode 2.0.15')).toBe('2.0.15')
      expect(parseOpenCodeVersionOutput('no version here')).toBeNull()
      expect(parseOpenCodeVersionOutput('')).toBeNull()
    })
  })

  describe('pinned version sources', () => {
    it('keeps the Dockerfile OPENCODE_VERSION default in sync with the pin', () => {
      const dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile'), 'utf8')
      expect(dockerfile).toMatch(new RegExp(`^ARG OPENCODE_VERSION=${OPENCODE_PINNED_VERSION.replace(/\./g, '\\.')}$`, 'm'))
      expect(dockerfile).toMatch(/^ENV OPENCODE_BUNDLED_VERSION=\$\{OPENCODE_VERSION\}$/m)
    })

    it('makes the shell scripts derive the pin from the Dockerfile or the bundled version instead of hardcoding it', () => {
      const entrypoint = readFileSync(join(REPO_ROOT, 'scripts', 'docker-entrypoint.sh'), 'utf8')
      const setupDev = readFileSync(join(REPO_ROOT, 'scripts', 'setup-dev.sh'), 'utf8')
      expect(entrypoint).toContain('OPENCODE_SUPPORTED_FLOOR="${OPENCODE_BUNDLED_VERSION:-}"')
      expect(setupDev).toContain("sed -n 's/^ARG OPENCODE_VERSION=//p' \"$REPO_ROOT/Dockerfile\"")
      for (const script of [entrypoint, setupDev]) {
        expect(script).not.toMatch(/(?<![\d.])\d+\.\d+\.\d+(?![\d.])/)
      }
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
