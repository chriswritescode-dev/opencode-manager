export const OPENCODE_CONFIG_FILENAMES = ['opencode.json', 'opencode.jsonc'] as const

export const OPENCODE_CANONICAL_CONFIG_FILENAME = 'opencode.json'

export const EXCLUDED_OPENCODE_CONFIG_UPLOAD_SEGMENTS = ['node_modules', '.git'] as const

export const EXCLUDED_OPENCODE_CONFIG_UPLOAD_FILENAMES = ['.DS_Store'] as const

export function isOpenCodeConfigUploadPath(relativePath: string): boolean {
  if (relativePath.includes('/')) return false
  return OPENCODE_CONFIG_FILENAMES.some((filename) => filename === relativePath)
}

export function isExcludedOpenCodeConfigUploadPath(relativePath: string): boolean {
  const segments = relativePath.split('/')
  const excludedSegments = EXCLUDED_OPENCODE_CONFIG_UPLOAD_SEGMENTS as readonly string[]
  if (segments.some((segment) => excludedSegments.includes(segment))) return true
  const lastSegment = segments[segments.length - 1]
  return lastSegment !== undefined && (EXCLUDED_OPENCODE_CONFIG_UPLOAD_FILENAMES as readonly string[]).includes(lastSegment)
}

export function getCommonUploadRootDirectory(relativePaths: string[]): string | null {
  if (relativePaths.length === 0) return null
  const firstSegments = relativePaths.map((relativePath) => relativePath.split('/')[0])
  const root = firstSegments[0]
  if (root === undefined) return null
  if (!firstSegments.every((segment) => segment === root)) return null
  if (!relativePaths.some((relativePath) => relativePath.includes('/'))) return null
  return root
}
