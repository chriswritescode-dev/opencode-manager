import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { ENV } from '@opencode-manager/shared/config/env'

export const AUTH_SOCKET_IP_HEADER = 'x-ocm-auth-socket-ip'

const DEFAULT_PROXY_HEADERS = ['x-forwarded-for']
const HEADER_NAME_PATTERN = /^[a-z0-9!#$%&'*+.^_`|~-]+$/

export function getTrustedProxyHeaders(): string[] {
  return ENV.AUTH.TRUSTED_PROXY_HEADERS
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter((header) => HEADER_NAME_PATTERN.test(header))
}

export function getClientIpHeaders(): string[] {
  return [...getTrustedProxyHeaders(), AUTH_SOCKET_IP_HEADER]
}

export function resolveSocketIp(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address ?? undefined
  } catch {
    return undefined
  }
}

export function applyClientIpHeaders(headers: Headers, socketIp: string | undefined): Headers {
  const trustedProxyHeaders = getTrustedProxyHeaders()

  for (const header of DEFAULT_PROXY_HEADERS) {
    if (!trustedProxyHeaders.includes(header)) {
      headers.delete(header)
    }
  }

  headers.delete(AUTH_SOCKET_IP_HEADER)
  if (socketIp) {
    headers.set(AUTH_SOCKET_IP_HEADER, socketIp)
  }

  return headers
}
