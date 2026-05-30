export function sanitizeRepoDirectoryName(input: string): string {
  const sanitized = input
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')

  return sanitized || 'repo'
}

export function getRepoDirectoryNameError(input: string): string | null {
  const trimmed = input.trim()

  if (!trimmed) {
    return 'Directory name is required'
  }

  if (trimmed === '.' || trimmed.includes('..')) {
    return 'Directory name cannot contain dot-dot path segments'
  }

  if (/^(?:[a-zA-Z]:)?[\\/]/.test(trimmed)) {
    return 'Directory name must be relative'
  }

  if (/[\\/]/.test(trimmed)) {
    return 'Directory name cannot contain path separators'
  }

  if (sanitizeRepoDirectoryName(trimmed) !== trimmed) {
    return 'Directory name can only contain letters, numbers, dots, underscores, and hyphens'
  }

  return null
}

export function normalizeRepoDirectoryName(input: string): string {
  const error = getRepoDirectoryNameError(input)

  if (error) {
    throw new Error(error)
  }

  return input.trim()
}

export function getRepoNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const scpMatch = cleaned.match(/^git@[^:]+:(.+)$/)

  if (scpMatch) {
    const parts = scpMatch[1]?.split('/') ?? []
    return parts[parts.length - 1] || ''
  }

  const parts = cleaned.split('/')
  return parts[parts.length - 1] || ''
}

export function normalizeRepoUrlForCompare(url: string): string {
  let normalized = url.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const shorthandMatch = normalized.match(/^([^/]+)\/([^/]+)$/)

  if (shorthandMatch && !normalized.includes('://') && !normalized.startsWith('git@')) {
    return `https://github.com/${normalized}`.toLowerCase()
  }

  const scpMatch = normalized.match(/^git@([^:]+):(.+)$/)
  if (scpMatch) {
    return `https://${scpMatch[1]}/${scpMatch[2]}`.toLowerCase()
  }

  if (normalized.startsWith('ssh://')) {
    try {
      const parsed = new URL(normalized)
      const path = parsed.pathname.replace(/^\/+/, '')
      const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
      return `https://${host}/${path}`.toLowerCase()
    } catch {
      return normalized.toLowerCase()
    }
  }

  if (normalized.startsWith('http://')) {
    normalized = `https://${normalized.slice(7)}`
  }

  return normalized.toLowerCase()
}
