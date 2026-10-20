import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, type NetworkInterfaceInfo } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  createOpenCodePairingNonce,
  createOpenCodePairingProof,
  decryptOpenCodePairingCredentials,
} from '@opencode-manager/shared/opencode'
import { discoverOpenCodeService, generatePairingCode, resolveDefaultBaseUrl, resolveLanIPv4, startPairingServer } from '../src/link'
import type { PairingServerOptions } from '../src/link'
import { buildOpenCodeServerLink, parseOpenCodeServerLink } from '@opencode-manager/shared/schemas'

const CODE = 'test-pairing-code-0123456789abcdef'
const CREDENTIALS = { username: 'opencode', password: 'secret-password' }

const LAN_INTERFACES: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', mac: '00:00:00:00:00:00', cidr: '127.0.0.1/8' }],
  eth0: [{ address: '192.168.1.20', family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '00:11:22:33:44:55', cidr: '192.168.1.20/24' }],
}

const INTERNAL_ONLY_INTERFACES: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  lo: [
    { address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', mac: '00:00:00:00:00:00', cidr: '127.0.0.1/8' },
    { address: '::1', family: 'IPv6', internal: true, netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', mac: '00:00:00:00:00:00', scopeid: 0, cidr: '::1/128' },
  ],
}

const PLATFORM_SERVICE_PORT = process.platform === 'win32' ? 45278 : 49374

interface ServiceHome {
  home: string
  state: string
  config: string
}

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createServiceHome(): ServiceHome {
  const home = mkdtempSync(join(tmpdir(), 'ocm-service-'))
  tempDirs.push(home)
  const state = join(home, 'state')
  const config = join(home, 'config')
  mkdirSync(join(state, 'opencode'), { recursive: true })
  mkdirSync(join(config, 'opencode'), { recursive: true })
  return { home, state, config }
}

function discover(paths: ServiceHome, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = LAN_INTERFACES) {
  return discoverOpenCodeService({
    env: { XDG_STATE_HOME: paths.state, XDG_CONFIG_HOME: paths.config },
    home: paths.home,
    interfaces,
  })
}

async function discoverOnPlatform(
  platform: NodeJS.Platform,
  paths: ServiceHome,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = LAN_INTERFACES,
) {
  const originalPlatform = process.platform
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    vi.resetModules()
    const { discoverOpenCodeService: discoverService } = await import('../src/link')
    return discoverService({
      env: { XDG_STATE_HOME: paths.state, XDG_CONFIG_HOME: paths.config },
      home: paths.home,
      interfaces,
    })
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  }
}

function writeRegistration(paths: ServiceHome, content: unknown): void {
  const file = join(paths.state, 'opencode', 'service.json')
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
}

function writeServiceConfig(paths: ServiceHome, content: unknown): void {
  const file = join(paths.config, 'opencode', 'service.json')
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
}

function startPairing(overrides: Partial<PairingServerOptions> = {}) {
  return startPairingServer({
    code: CODE,
    credentials: CREDENTIALS,
    ttlMs: 5000,
    maxAttempts: 3,
    port: 0,
    hostname: '127.0.0.1',
    ...overrides,
  })
}

function redeem(url: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { method: 'POST', body: JSON.stringify(body), ...init })
}

async function createChallenge(code = CODE): Promise<{ nonce: string; proof: string }> {
  const nonce = createOpenCodePairingNonce()
  return { nonce, proof: await createOpenCodePairingProof(code, nonce) }
}

describe('generatePairingCode', () => {
  it('returns 32 random bytes as base64url', () => {
    const first = generatePairingCode()
    const second = generatePairingCode()

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first).not.toBe(second)
  })
})

describe('resolveDefaultBaseUrl', () => {
  it('uses the first non-internal IPv4 interface on port 4096', () => {
    expect(resolveDefaultBaseUrl({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', mac: '00:00:00:00:00:00', cidr: '127.0.0.1/8' }],
      eth0: [{ address: '192.168.1.20', family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '00:11:22:33:44:55', cidr: '192.168.1.20/24' }],
    })).toBe('http://192.168.1.20:4096')
  })

  it('falls back to loopback when only internal interfaces exist', () => {
    expect(resolveDefaultBaseUrl({})).toBe('http://127.0.0.1:4096')
  })
})

describe('resolveLanIPv4', () => {
  it('returns null when no external IPv4 interface exists', () => {
    expect(resolveLanIPv4(INTERNAL_ONLY_INTERFACES)).toBeNull()
    expect(resolveLanIPv4({})).toBeNull()
  })
})

describe('discoverOpenCodeService', () => {
  it('substitutes the LAN address for a wildcard registration host and keeps the port', () => {
    const paths = createServiceHome()
    writeRegistration(paths, {
      id: 'registration-id',
      version: '2.0.32',
      url: 'http://0.0.0.0:49374',
      pid: 4242,
      password: 'service-secret',
    })

    expect(discover(paths)).toEqual({
      baseUrl: 'http://192.168.1.20:49374',
      password: 'service-secret',
      source: 'registration',
      loopbackOnly: false,
    })
  })

  it('falls back to the service config with the default hostname and port', () => {
    const paths = createServiceHome()
    writeServiceConfig(paths, { password: 'config-secret' })

    expect(discover(paths)).toEqual({
      baseUrl: `http://127.0.0.1:${PLATFORM_SERVICE_PORT}`,
      password: 'config-secret',
      source: 'config',
      loopbackOnly: true,
    })
  })

  it('uses the configured hostname and port when present', () => {
    const paths = createServiceHome()
    writeServiceConfig(paths, { hostname: '0.0.0.0', port: 5000 })

    expect(discover(paths)).toEqual({
      baseUrl: 'http://192.168.1.20:5000',
      password: null,
      source: 'config',
      loopbackOnly: false,
    })
  })

  it('brackets an IPv6 wildcard config hostname and substitutes the LAN address', () => {
    const paths = createServiceHome()
    writeServiceConfig(paths, { hostname: '::', port: 5000 })

    expect(discover(paths)).toEqual({
      baseUrl: 'http://192.168.1.20:5000',
      password: null,
      source: 'config',
      loopbackOnly: false,
    })
  })

  it('brackets an IPv6 loopback config hostname', () => {
    const paths = createServiceHome()
    writeServiceConfig(paths, { hostname: '::1' })

    expect(discover(paths)).toEqual({
      baseUrl: `http://[::1]:${PLATFORM_SERVICE_PORT}`,
      password: null,
      source: 'config',
      loopbackOnly: true,
    })
  })

  it('marks loopback registrations as loopback only', () => {
    const cases = [
      { host: '127.0.0.1', url: 'http://127.0.0.1:49374' },
      { host: 'localhost', url: 'http://localhost:49374' },
      { host: '::1', url: 'http://[::1]:49374' },
    ]

    for (const { host, url } of cases) {
      const paths = createServiceHome()
      writeRegistration(paths, { url, pid: 4242 })

      expect(discover(paths), host).toEqual({
        baseUrl: url,
        password: null,
        source: 'registration',
        loopbackOnly: true,
      })
    }
  })

  it('returns null when neither the registration nor the config exists', () => {
    expect(discover(createServiceHome())).toBeNull()
  })

  it('ignores a malformed registration and falls back to the config', () => {
    const paths = createServiceHome()
    writeRegistration(paths, '{ not json')
    writeServiceConfig(paths, { hostname: '192.168.1.50', port: 5000, password: 'config-secret' })

    expect(discover(paths)).toEqual({
      baseUrl: 'http://192.168.1.50:5000',
      password: 'config-secret',
      source: 'config',
      loopbackOnly: false,
    })
  })

  it('marks a wildcard registration as loopback when no LAN address exists', () => {
    const paths = createServiceHome()
    writeRegistration(paths, { url: 'http://0.0.0.0:49374', password: 'service-secret' })

    expect(discover(paths, INTERNAL_ONLY_INTERFACES)).toEqual({
      baseUrl: 'http://127.0.0.1:49374',
      password: 'service-secret',
      source: 'registration',
      loopbackOnly: true,
    })
  })

  it('uses the config password when the registration URL is unusable', () => {
    const paths = createServiceHome()
    writeRegistration(paths, { url: 'not-a-url', password: 'stale-secret' })
    writeServiceConfig(paths, { hostname: '192.168.1.50', port: 5000, password: 'config-secret' })

    expect(discover(paths)).toEqual({
      baseUrl: 'http://192.168.1.50:5000',
      password: 'config-secret',
      source: 'config',
      loopbackOnly: false,
    })
  })

  it('uses the platform default service port when the config omits one', async () => {
    const cases: Array<{ platform: NodeJS.Platform; port: number }> = [
      { platform: 'linux', port: 49374 },
      { platform: 'win32', port: 45278 },
    ]

    for (const { platform, port } of cases) {
      const paths = createServiceHome()
      writeServiceConfig(paths, { password: 'config-secret' })

      expect(await discoverOnPlatform(platform, paths), platform).toEqual({
        baseUrl: `http://127.0.0.1:${port}`,
        password: 'config-secret',
        source: 'config',
        loopbackOnly: true,
      })
    }
  })
})

describe('startPairingServer', () => {
  it('redeems a valid proof and returns credentials that decrypt with the code and nonce', async () => {
    const pairing = await startPairing()
    const challenge = await createChallenge()

    const response = await redeem(pairing.url, challenge)
    const raw = await response.text()

    expect(response.status).toBe(200)
    expect(raw).not.toContain(CREDENTIALS.password)
    expect(raw).not.toContain(CODE)

    const payload = JSON.parse(raw) as { iv: string; ciphertext: string }
    await expect(decryptOpenCodePairingCredentials({
      code: CODE,
      nonce: challenge.nonce,
      iv: payload.iv,
      ciphertext: payload.ciphertext,
    })).resolves.toEqual(CREDENTIALS)
    await expect(pairing.done).resolves.toBe('linked')
    await pairing.close()
  })

  it('rejects a wrong proof with 401 and rejects after three failures', async () => {
    const pairing = await startPairing({ maxAttempts: 3 })

    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await redeem(pairing.url, await createChallenge(`${CODE}-wrong`))
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: 'invalid pairing proof' })
    }

    await expect(pairing.done).resolves.toBe('rejected')
    await pairing.close()
  })

  it('rejects a malformed body with 400 and counts it as a failure', async () => {
    const pairing = await startPairing({ maxAttempts: 1 })

    const response = await redeem(pairing.url, { nonce: 'not-a-nonce', proof: 'not-a-proof' })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid pairing request' })
    await expect(pairing.done).resolves.toBe('rejected')
    await pairing.close()
  })

  it('treats a missing challenge as a failed attempt', async () => {
    const pairing = await startPairing({ maxAttempts: 1 })

    const response = await redeem(pairing.url, { notA: 'challenge' })

    expect(response.status).toBe(400)
    await expect(pairing.done).resolves.toBe('rejected')
    await pairing.close()
  })

  it('resolves expired after the ttl and stops listening', async () => {
    const pairing = await startPairing({ ttlMs: 50 })

    await expect(pairing.done).resolves.toBe('expired')
    await expect(redeem(pairing.url, await createChallenge())).rejects.toThrow()
    await pairing.close()
  })

  it('answers 404 for non-redeem paths and methods', async () => {
    const pairing = await startPairing()

    const otherPath = await fetch(new URL('/status', pairing.url))
    expect(otherPath.status).toBe(404)
    await expect(otherPath.json()).resolves.toEqual({ error: 'not found' })

    const wrongMethod = await fetch(pairing.url)
    expect(wrongMethod.status).toBe(404)

    await pairing.close()
  })

  it('produces a link that parses back with the shared parser', async () => {
    const pairing = await startPairing()

    const link = buildOpenCodeServerLink({
      kind: 'opencode',
      name: 'build-host',
      baseUrl: 'http://192.168.1.20:4096',
      pairing: { pairUrl: pairing.url, code: CODE },
    })

    expect(link).toContain('v=2')
    expect(parseOpenCodeServerLink(link)).toEqual({
      kind: 'opencode',
      name: 'build-host',
      baseUrl: 'http://192.168.1.20:4096',
      pairing: { pairUrl: `http://127.0.0.1:${pairing.port}/redeem`, code: CODE },
    })

    await pairing.close()
  })

  it('encrypts credentials under a key derived from the pairing code', async () => {
    const pairing = await startPairing()
    const challenge = await createChallenge()

    const payload = await redeem(pairing.url, challenge).then((response) => response.json()) as { iv: string; ciphertext: string }

    await expect(decryptOpenCodePairingCredentials({
      code: `${CODE}-other`,
      nonce: challenge.nonce,
      iv: payload.iv,
      ciphertext: payload.ciphertext,
    })).rejects.toThrow()
    await pairing.close()
  })
})
