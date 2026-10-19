export const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304])

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
  'authorization',
])

export function filterProxyHeaders(
  headers: Headers,
  extraExcluded: ReadonlySet<string> = new Set(),
): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || extraExcluded.has(lowerKey)) return
    result[key] = value
  })
  return result
}

export function buildProxyResponseHeaders(
  source: Headers,
  extraExcluded: ReadonlySet<string> = new Set(),
): Headers {
  const excluded = new Set(extraExcluded)
  excluded.add('set-cookie')
  const headers = new Headers(filterProxyHeaders(source, excluded))
  for (const cookie of source.getSetCookie()) {
    headers.append('set-cookie', cookie)
  }
  return headers
}
