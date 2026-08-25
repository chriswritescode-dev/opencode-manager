const OPENCODE_CONFIG_FILENAMES = ['opencode.json', 'opencode.jsonc'] as const

export const OPENCODE_CANONICAL_CONFIG_FILENAME = 'opencode.json'

export const MAX_OPENCODE_CONFIG_DIRECTORY_FILES = 5000

export const EXCLUDED_OPENCODE_CONFIG_UPLOAD_SEGMENTS = ['node_modules', '.git'] as const

export const EXCLUDED_OPENCODE_CONFIG_UPLOAD_FILENAMES = ['.DS_Store'] as const

export const PRESERVED_OPENCODE_CONFIG_ENTRIES = ['node_modules'] as const

export const OPENCODE_CONFIG_STAGING_PREFIX = '.opencode-config-staging-'

export const OPENCODE_CONFIG_BACKUP_PREFIX = '.opencode-config-backup-'

export const OPENCODE_CONFIG_UPLOAD_ERRORS = {
  NO_FILES_PROVIDED: 'No files were provided for the OpenCode config directory replace',
  TOO_MANY_FILES: `Uploaded config directory contains too many files (max ${MAX_OPENCODE_CONFIG_DIRECTORY_FILES})`,
  EXCEEDS_MAX_UPLOAD_SIZE: 'Uploaded config directory files exceed maximum upload size',
  MISSING_ROOT_CONFIG: 'Uploaded directory must contain opencode.json or opencode.jsonc at its root',
} as const

export function isOpenCodeConfigUploadPath(relativePath: string): boolean {
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

export function stripUploadRootDirectory(relativePath: string, commonRoot: string | null): string {
  return commonRoot ? relativePath.slice(commonRoot.length + 1) : relativePath
}
