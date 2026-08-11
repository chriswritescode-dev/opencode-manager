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

export const SCP_STYLE_URL_PATTERN = /^([^@/:]+)@([^/:]+):(.+)$/
const SCP_STYLE_URL_WITH_PORT_PATTERN = /^([^@/:]+)@([^/:]+):(\d{1,5})\/(.+\/.+)$/

export function isScpStyleUrl(url: string): boolean {
  return SCP_STYLE_URL_PATTERN.test(url.trim())
}

export function isSSHUrl(url: string): boolean {
  return url.trim().startsWith('ssh://') || isScpStyleUrl(url)
}

export function normalizeSSHUrl(url: string): string {
  if (url.startsWith('ssh://')) {
    return url
  }

  const match = url.match(SCP_STYLE_URL_WITH_PORT_PATTERN)
  if (match) {
    const [, user, host, port, path] = match
    const portNumber = Number(port)
    if (portNumber > 0 && portNumber <= 65535) {
      return `ssh://${user}@${host}:${port}/${path}`
    }
  }

  return url
}

export function extractHostFromSSHUrl(url: string): string | null {
  const scpMatch = url.match(SCP_STYLE_URL_PATTERN)
  if (scpMatch) {
    return scpMatch[2] || null
  }

  if (url.startsWith('ssh://')) {
    try {
      const parsed = new URL(url)
      return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname || null
    } catch {
      return null
    }
  }

  return null
}

export function getRepoNameFromUrl(url: string): string {
  const cleaned = trimTrailingChar(url.trim().replace(/\.git$/, ''), '/')
  const scpMatch = cleaned.match(SCP_STYLE_URL_PATTERN)

  if (scpMatch) {
    const parts = scpMatch[3]?.split('/') ?? []
    return parts[parts.length - 1] || ''
  }

  const parts = cleaned.split('/')
  return parts[parts.length - 1] || ''
}

function getPathBaseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

export function getRepoDisplayName(repo: {
  name?: string | null
  repoUrl?: string | null
  localPath?: string | null
  sourcePath?: string | null
}): string {
  if (repo.name && repo.name.trim()) return repo.name.trim()
  const fromLocalPath = repo.localPath ? getPathBaseName(repo.localPath) : ''
  if (repo.repoUrl) return getRepoNameFromUrl(repo.repoUrl) || fromLocalPath || 'Repository'
  if (repo.sourcePath) return getPathBaseName(repo.sourcePath) || fromLocalPath || 'Repository'
  return fromLocalPath || 'Repository'
}

export function normalizeRepoUrlForCompare(url: string): string {
  const normalized = trimTrailingChar(normalizeSSHUrl(url.trim()).replace(/\.git$/, ''), '/')
  const scpMatch = normalized.match(SCP_STYLE_URL_PATTERN)

  if (scpMatch) {
    return `https://${scpMatch[2]}/${scpMatch[3]}`.toLowerCase()
  }

  const shorthandMatch = normalized.match(/^([^/]+)\/([^/]+)$/)

  if (shorthandMatch && !normalized.includes('://')) {
    return `https://github.com/${normalized}`.toLowerCase()
  }

  if (/^(?:ssh|https?):\/\//.test(normalized)) {
    try {
      const parsed = new URL(normalized)
      const path = parsed.pathname.replace(/^\/+/, '')
      const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
      return `https://${host}/${path}`.toLowerCase()
    } catch {
      return normalized.toLowerCase()
    }
  }

  return normalized.toLowerCase()
}
