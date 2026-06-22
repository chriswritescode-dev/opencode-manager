import { ENV } from '@opencode-manager/shared/config/env'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'upgrade',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'host',
])

const FRAME_BLOCKING_HEADERS = new Set(['x-frame-options', 'content-security-policy'])

export function buildUpstreamUrl(port: number, path: string, search: string): string {
  return `http://127.0.0.1:${port}${path}${search}`
}

export function filterProxyHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      result[key] = value
    }
  })
  return result
}

export function sanitizeUpstreamResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (!HOP_BY_HOP_HEADERS.has(lower) && !FRAME_BLOCKING_HEADERS.has(lower)) {
      result[key] = value
    }
  })
  result['referrer-policy'] = 'no-referrer'
  return result
}

export function resolveDevPreviewUrl(requestHost: string | undefined, forwardedProto: string | undefined): string {
  const publicUrl = ENV.DEV_PREVIEW.PUBLIC_URL.trim()
  if (publicUrl) {
    return publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`
  }

  const hostname = stripPort(requestHost) || 'localhost'
  const protocol = normalizeProtocol(forwardedProto)
  return `${protocol}://${hostname}:${ENV.DEV_PREVIEW.PORT}/`
}

function stripPort(host: string | undefined): string {
  if (!host) return ''
  const trimmed = host.trim()
  if (trimmed.startsWith('[')) {
    const closing = trimmed.indexOf(']')
    return closing === -1 ? trimmed : trimmed.slice(0, closing + 1)
  }
  return trimmed.replace(/:\d+$/, '')
}

function normalizeProtocol(forwardedProto: string | undefined): string {
  const proto = forwardedProto?.split(',')[0]?.trim().toLowerCase()
  return proto === 'https' ? 'https' : 'http'
}
