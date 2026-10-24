const UNKNOWN_DEVICE = 'Unknown device'
const RAW_USER_AGENT_MAX_LENGTH = 80

/** Describes a user agent as "browser on platform", falling back to the raw string. */
export function describeUserAgent(userAgent: string | null | undefined): string {
  const value = userAgent?.trim()
  if (!value) return UNKNOWN_DEVICE

  const platform = detectPlatform(value)
  const browser = detectBrowser(value)
  if (browser && platform) return `${browser} on ${platform}`
  return browser ?? platform ?? value.slice(0, RAW_USER_AGENT_MAX_LENGTH)
}

function detectPlatform(userAgent: string): string | null {
  if (userAgent.includes('iPhone')) return 'iPhone'
  if (userAgent.includes('iPad')) return 'iPad'
  if (userAgent.includes('Android')) return 'Android'
  if (userAgent.includes('Macintosh')) return 'macOS'
  if (userAgent.includes('Windows')) return 'Windows'
  if (userAgent.includes('Linux')) return 'Linux'
  return null
}

function detectBrowser(userAgent: string): string | null {
  if (userAgent.includes('Edg/')) return 'Edge'
  if (userAgent.includes('OPR/')) return 'Opera'
  if (userAgent.includes('Firefox/') || userAgent.includes('FxiOS/')) return 'Firefox'
  if (userAgent.includes('CriOS/') || userAgent.includes('Chrome/')) return 'Chrome'
  if (userAgent.includes('Safari/') && userAgent.includes('Version/')) return 'Safari'
  return null
}
