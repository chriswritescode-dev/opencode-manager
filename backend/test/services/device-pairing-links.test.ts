import { describe, expect, it } from 'vitest'
import { resolveAppLinkPolicy, resolveDevicePairingAvailability } from '../../src/services/device-pairing-links'

const TRUSTED_ORIGINS = [
  'https://m.example.com',
  'http://192.168.1.20:5003',
  'http://203.0.113.5:5003',
  'http://localhost:5173',
]

const production = { trustedOrigins: TRUSTED_ORIGINS, isDevelopment: false }
const development = { trustedOrigins: TRUSTED_ORIGINS, isDevelopment: true }

describe('resolveDevicePairingAvailability', () => {
  it('allows a trusted https origin', () => {
    expect(resolveDevicePairingAvailability('https://m.example.com', production)).toEqual({
      available: true,
      reason: null,
      message: null,
      originUrl: new URL('https://m.example.com'),
    })
  })

  it('rejects a missing origin', () => {
    expect(resolveDevicePairingAvailability(undefined, production)).toEqual({
      available: false,
      reason: 'untrusted-origin',
      message:
        'The request had no Origin header. Open the Manager at an address listed in AUTH_TRUSTED_ORIGINS to pair a device.',
    })
  })

  it('rejects the null origin', () => {
    expect(resolveDevicePairingAvailability('null', production)).toEqual({
      available: false,
      reason: 'untrusted-origin',
      message:
        'This address (null) is not in AUTH_TRUSTED_ORIGINS. Add it and restart the Manager to pair a device.',
    })
  })

  it('rejects a loopback origin outside development', () => {
    expect(resolveDevicePairingAvailability('http://localhost:5173', production)).toEqual({
      available: false,
      reason: 'loopback',
      message:
        'This page is open on localhost, which other devices cannot reach. Open the Manager at its public or LAN address to pair a device.',
    })
  })

  it('allows a loopback origin in development', () => {
    expect(resolveDevicePairingAvailability('http://localhost:5173', development).available).toBe(true)
  })

  it('rejects public plain http', () => {
    expect(resolveDevicePairingAvailability('http://203.0.113.5:5003', production)).toEqual({
      available: false,
      reason: 'insecure-origin',
      message:
        'Pairing needs HTTPS on a public address. Serve the Manager over HTTPS, or open it at a private network address.',
    })
  })

  it('allows private network plain http', () => {
    expect(resolveDevicePairingAvailability('http://192.168.1.20:5003', production).available).toBe(true)
  })

  it('rejects a trusted origin that is not an http url', () => {
    const options = { trustedOrigins: ['ocm://link'], isDevelopment: false }

    expect(resolveDevicePairingAvailability('ocm://link', options)).toEqual({
      available: false,
      reason: 'untrusted-origin',
      message:
        'This address (ocm://link) is not in AUTH_TRUSTED_ORIGINS. Add it and restart the Manager to pair a device.',
    })
  })
})

describe('resolveAppLinkPolicy', () => {
  it('allows an https origin without warnings', () => {
    expect(resolveAppLinkPolicy(new URL('https://m.example.com'), { allowPrivateNetworkHttp: false })).toEqual({
      blockedReason: null,
      warnings: [],
    })
  })

  it('blocks a private network http app link without the toggle', () => {
    expect(
      resolveAppLinkPolicy(new URL('http://192.168.1.20:5003'), { allowPrivateNetworkHttp: false }),
    ).toEqual({
      blockedReason: 'insecure-origin',
      warnings: ['plain-http'],
    })
  })

  it('allows a private network http app link with the toggle', () => {
    expect(
      resolveAppLinkPolicy(new URL('http://192.168.1.20:5003'), { allowPrivateNetworkHttp: true }),
    ).toEqual({
      blockedReason: null,
      warnings: ['plain-http'],
    })
  })

  it('warns about loopback without blocking the app link itself', () => {
    expect(
      resolveAppLinkPolicy(new URL('http://localhost:5173'), { allowPrivateNetworkHttp: true }),
    ).toEqual({
      blockedReason: null,
      warnings: ['plain-http', 'loopback'],
    })
  })
})
