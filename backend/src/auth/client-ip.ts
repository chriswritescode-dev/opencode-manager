import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'

export const AUTH_SOCKET_IP_HEADER = 'x-ocm-auth-socket-ip'

export function resolveSocketIp(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address ?? undefined
  } catch {
    return undefined
  }
}

export function applyClientIpHeaders(headers: Headers, socketIp: string | undefined): Headers {
  headers.delete(AUTH_SOCKET_IP_HEADER)
  if (socketIp) {
    headers.set(AUTH_SOCKET_IP_HEADER, socketIp)
  }

  return headers
}
