export const ASSISTANT_REPO_ID = 0
export const ASSISTANT_REPO_NAME = 'Assistant'
export const ASSISTANT_REPO_PATH = 'assistant'

function trimTrailingChar(value: string, char: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === char) end--
  return value.slice(0, end)
}

export function sanitizeRepoDirectoryName(input: string): string {
  const collapsed = input.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+/, '')
  const sanitized = trimTrailingChar(collapsed, '-')

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

export function sanitizeBranchForDirectory(branch: string): string {
  return branch.replace(/[\\/]/g, '-')
}

export function getRepoBaseDirectoryName(repo: { localPath: string; branch?: string; isWorktree?: boolean }): string {
  if (repo.isWorktree && repo.branch) {
    const suffix = `-${sanitizeBranchForDirectory(repo.branch)}`
    if (repo.localPath.endsWith(suffix)) {
      return repo.localPath.slice(0, -suffix.length)
    }
  }

  return repo.localPath
}

export function getRepoNameFromUrl(url: string): string {
  const cleaned = trimTrailingChar(url.trim().replace(/\.git$/, ''), '/')
  const scpMatch = cleaned.match(/^git@[^:]+:(.+)$/)

  if (scpMatch) {
    const parts = scpMatch[1]?.split('/') ?? []
    return parts[parts.length - 1] || ''
  }

  const parts = cleaned.split('/')
  return parts[parts.length - 1] || ''
}

export function normalizeRepoUrlForCompare(url: string): string {
  let normalized = trimTrailingChar(url.trim().replace(/\.git$/, ''), '/')
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
