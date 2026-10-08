import { ENV, getWorkspacePath } from '@opencode-manager/shared/config/env'

export const OPENCODE_DIRECTORY_HEADER = 'x-opencode-directory'

function formatOpenCodeHostForUrl(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host
  return host.includes(':') ? `[${host}]` : host
}

export function getOpenCodeUpstreamBaseUrl(hostOverride?: string | (() => string)): string {
  const configuredHost = typeof hostOverride === 'function' ? hostOverride() : (hostOverride ?? ENV.OPENCODE.HOST)
  const normalizedHost = configuredHost === '0.0.0.0' ? '127.0.0.1' : configuredHost
  return `http://${formatOpenCodeHostForUrl(normalizedHost)}:${ENV.OPENCODE.PORT}`
}

export function withDefaultOpenCodeDirectory(headers: Record<string, string>): Record<string, string> {
  const hasDirectory = Object.keys(headers).some((key) => key.toLowerCase() === OPENCODE_DIRECTORY_HEADER)
  return hasDirectory ? headers : { ...headers, [OPENCODE_DIRECTORY_HEADER]: encodeURIComponent(getWorkspacePath()) }
}

/** Maps an http(s) URL to its ws(s) equivalent, leaving ws/wss URLs unchanged. */
export function toWebSocketUrl(httpUrl: string): string {
  const url = new URL(httpUrl)
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:') url.protocol = 'ws:'
  return url.toString()
}
