/** Trims a URL and removes its trailing slashes. */
export function trimUrlTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Parses a value into a URL, or returns null when it is not an absolute http(s) URL. */
export function parseHttpUrl(value: string): URL | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url
}

/** Reports whether two URLs share the same origin; false when either URL is invalid. */
export function haveSameUrlOrigin(first: string, second: string): boolean {
  const origin = readUrlOrigin(first)
  return origin !== null && origin === readUrlOrigin(second)
}

/** Reports whether a hostname refers to the local machine. */
export function isLoopbackHost(hostname: string): boolean {
  const host = normalizeHostname(hostname)
  if (host === 'localhost' || host === '::1') return true
  const octets = parseIpv4Octets(host)
  return octets !== null && octets[0] === 127
}

/** Reports whether a hostname is an RFC 1918, link-local, or CGNAT address. */
export function isPrivateNetworkHost(hostname: string): boolean {
  const host = normalizeHostname(hostname)
  const octets = parseIpv4Octets(host)
  if (octets !== null) {
    const [first, second] = octets
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254) ||
      (first === 100 && second >= 64 && second <= 127)
    )
  }
  if (!host.includes(':')) return false
  const firstHextet = Number.parseInt(host.split(':')[0] ?? '', 16)
  return firstHextet >= 0xfc00 && firstHextet <= 0xfdff
}

/** Reports whether a URL uses plain HTTP on a host other than loopback or a private network. */
export function isPublicPlainHttpUrl(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    !isLoopbackHost(url.hostname) &&
    !isPrivateNetworkHost(url.hostname)
  )
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
}

function parseIpv4Octets(host: string): [number, number, number, number] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const octets: [number, number, number, number] = [0, 0, 0, 0]
  for (const [index, part] of parts.entries()) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets[index] = value
  }
  return octets
}

function readUrlOrigin(value: string): string | null {
  return parseHttpUrl(value)?.origin ?? null
}
