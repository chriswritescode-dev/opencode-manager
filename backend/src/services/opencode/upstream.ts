import { ENV } from '@opencode-manager/shared/config/env'

function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '::ffff:127.0.0.1' ||
    normalized.startsWith('127.')
  )
}

function resolveEffectiveHost(enforced: boolean, host: string): string {
  return enforced && !isLoopbackBindHost(host) ? '127.0.0.1' : host
}

export function resolveEffectiveServerHost(enforced: boolean): string {
  return resolveEffectiveHost(enforced, ENV.OPENCODE.HOST)
}

function formatOpenCodeHostForUrl(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host
  return host.includes(':') ? `[${host}]` : host
}

export function getOpenCodeUpstreamBaseUrl(enforced: boolean, hostOverride?: string | (() => string)): string {
  const configuredHost = typeof hostOverride === 'function' ? hostOverride() : (hostOverride ?? ENV.OPENCODE.HOST)
  const effectiveHost = resolveEffectiveHost(enforced, configuredHost)
  const normalizedHost = effectiveHost === '0.0.0.0' ? '127.0.0.1' : effectiveHost
  return `http://${formatOpenCodeHostForUrl(normalizedHost)}:${ENV.OPENCODE.PORT}`
}
