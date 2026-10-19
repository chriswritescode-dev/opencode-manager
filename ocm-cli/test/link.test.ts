import { describe, it, expect } from 'vitest'
import {
  createOpenCodePairingNonce,
  createOpenCodePairingProof,
  decryptOpenCodePairingCredentials,
} from '@opencode-manager/shared/opencode'
import { generatePairingCode, resolveDefaultBaseUrl, startPairingServer } from '../src/link'
import type { PairingServerOptions } from '../src/link'
import { buildOpenCodeServerLink, parseOpenCodeServerLink } from '@opencode-manager/shared/schemas'

const CODE = 'test-pairing-code-0123456789abcdef'
const CREDENTIALS = { username: 'opencode', password: 'secret-password' }

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
