import { ENV } from '@opencode-manager/shared/config/env'

function formatOpenCodeHostForUrl(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host
  return host.includes(':') ? `[${host}]` : host
}

export function getOpenCodeUpstreamBaseUrl(hostOverride?: string | (() => string)): string {
  const configuredHost = typeof hostOverride === 'function' ? hostOverride() : (hostOverride ?? ENV.OPENCODE.HOST)
  const normalizedHost = configuredHost === '0.0.0.0' ? '127.0.0.1' : configuredHost
  return `http://${formatOpenCodeHostForUrl(normalizedHost)}:${ENV.OPENCODE.PORT}`
}
