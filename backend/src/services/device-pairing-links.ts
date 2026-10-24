import { isTrustedOrigin } from '@opencode-manager/shared/config/env'
import {
  buildManagerAppLink,
  buildManagerBrowserPairingLink,
  type AppLinkBlockedReason,
  type DevicePairingLinkWarning,
  type DevicePairingLinksResponse,
  type DevicePairingUnavailableReason,
  type RemoteAccessHeader,
} from '@opencode-manager/shared/schemas'
import {
  isLoopbackHost,
  isPrivateNetworkHost,
  isPublicPlainHttpUrl,
  parseHttpUrl,
} from '@opencode-manager/shared/utils'

const MISSING_ORIGIN_MESSAGE =
  'The request had no Origin header. Open the Manager at an address listed in AUTH_TRUSTED_ORIGINS to pair a device.'
const LOOPBACK_ORIGIN_MESSAGE =
  'This page is open on localhost, which other devices cannot reach. Open the Manager at its public or LAN address to pair a device.'
const INSECURE_ORIGIN_MESSAGE =
  'Pairing needs HTTPS on a public address. Serve the Manager over HTTPS, or open it at a private network address.'

type AppLinkPolicy = {
  blockedReason: AppLinkBlockedReason | null
  warnings: DevicePairingLinkWarning[]
}

type DevicePairingAvailabilityResult =
  | { available: true; reason: null; message: null; originUrl: URL }
  | { available: false; reason: DevicePairingUnavailableReason; message: string }

type DevicePairingAvailabilityOptions = {
  trustedOrigins: string[]
  isDevelopment: boolean
}

function untrustedOriginMessage(origin: string): string {
  return `This address (${origin}) is not in AUTH_TRUSTED_ORIGINS. Add it and restart the Manager to pair a device.`
}

function unavailable(
  reason: DevicePairingUnavailableReason,
  message: string,
): DevicePairingAvailabilityResult {
  return { available: false, reason, message }
}

/** Normalises an address to its origin, or null when it is not an absolute http(s) URL. */
export function normalizeDevicePairingOrigin(value: string): string | null {
  return parseHttpUrl(value)?.origin ?? null
}

/** Reports whether an origin can mint a pairing code, and why it cannot when blocked. */
export function resolveDevicePairingAvailability(
  origin: string | undefined,
  options: DevicePairingAvailabilityOptions,
): DevicePairingAvailabilityResult {
  if (!origin) return unavailable('untrusted-origin', MISSING_ORIGIN_MESSAGE)
  if (!isTrustedOrigin(origin, { requireOrigin: true }, options.trustedOrigins)) {
    return unavailable('untrusted-origin', untrustedOriginMessage(origin))
  }

  const originUrl = parseHttpUrl(origin)
  if (!originUrl) return unavailable('untrusted-origin', untrustedOriginMessage(origin))

  const isLoopback = isLoopbackHost(originUrl.hostname)
  if (isLoopback && !options.isDevelopment) {
    return unavailable('loopback', LOOPBACK_ORIGIN_MESSAGE)
  }

  if (isPublicPlainHttpUrl(originUrl)) {
    return unavailable('insecure-origin', INSECURE_ORIGIN_MESSAGE)
  }

  return { available: true, reason: null, message: null, originUrl }
}

/** Decides whether an origin can carry an app link and which warnings it raises. */
export function resolveAppLinkPolicy(
  origin: URL,
  options: { allowPrivateNetworkHttp: boolean },
): AppLinkPolicy {
  const warnings: DevicePairingLinkWarning[] = []
  const isPlainHttp = origin.protocol === 'http:'
  const isLoopback = isLoopbackHost(origin.hostname)

  if (isPlainHttp) warnings.push('plain-http')
  if (isLoopback) warnings.push('loopback')
  if (!isPlainHttp) return { blockedReason: null, warnings }

  const isAllowed =
    isLoopback || (options.allowPrivateNetworkHttp && isPrivateNetworkHost(origin.hostname))
  return { blockedReason: isAllowed ? null : 'insecure-origin', warnings }
}

/** Builds the pairing link response, dropping the app link when its origin is blocked. */
export function buildDevicePairingLinks(input: {
  origin: URL
  name: string
  code: string
  expiresAt: Date
  headers: RemoteAccessHeader[]
  headersUnreadable: boolean
  policy: AppLinkPolicy
}): DevicePairingLinksResponse {
  const { origin, name, code, headers, policy } = input
  const baseUrl = origin.origin

  return {
    appLink:
      policy.blockedReason === null
        ? buildManagerAppLink({ kind: 'manager', name, baseUrl, code, headers })
        : null,
    appLinkBlockedReason: policy.blockedReason,
    browserLink: buildManagerBrowserPairingLink(baseUrl, code),
    expiresAt: input.expiresAt.toISOString(),
    headerNames: headers.map((header) => header.name),
    warnings: input.headersUnreadable ? [...policy.warnings, 'headers-unreadable'] : policy.warnings,
  }
}
