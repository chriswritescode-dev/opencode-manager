import {
  buildManagerAppLink,
  buildManagerBrowserPairingLink,
  type AppLinkBlockedReason,
  type DevicePairingLinkWarning,
  type DevicePairingLinksResponse,
  type RemoteAccessHeader,
} from '@opencode-manager/shared/schemas'
import { isLoopbackHost, isPrivateNetworkHost } from '@opencode-manager/shared/utils'

type AppLinkPolicy = {
  blockedReason: AppLinkBlockedReason | null
  warnings: DevicePairingLinkWarning[]
}

/** Decides whether an origin can carry an app link and which warnings it raises. */
export function resolveAppLinkPolicy(
  origin: URL,
  options: { allowPrivateNetworkHttp: boolean; isDevelopment: boolean },
): AppLinkPolicy {
  const warnings: DevicePairingLinkWarning[] = []
  const isPlainHttp = origin.protocol === 'http:'

  if (isPlainHttp) warnings.push('plain-http')

  if (isLoopbackHost(origin.hostname)) {
    warnings.push('loopback')
    return { blockedReason: options.isDevelopment ? null : 'loopback', warnings }
  }

  if (isPlainHttp) {
    const isAllowed = options.allowPrivateNetworkHttp && isPrivateNetworkHost(origin.hostname)
    return { blockedReason: isAllowed ? null : 'insecure-origin', warnings }
  }

  return { blockedReason: null, warnings }
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
