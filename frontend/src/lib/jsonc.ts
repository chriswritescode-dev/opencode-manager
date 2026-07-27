export { parseJsonc, parseJsoncErrorLine } from '@opencode-manager/shared/utils'
import { findJsoncLineForPath, parseJsoncPathSegments } from '@opencode-manager/shared/utils'

export function resolveJsoncIssueLine(content: string, path: PropertyKey[] | string): number | null {
  const segments = Array.isArray(path)
    ? path.map((segment) => (typeof segment === 'number' ? segment : String(segment)))
    : parseJsoncPathSegments(path)
  return findJsoncLineForPath(content, segments)
}

export function hasJsoncComments(content: string): boolean {
  return content.split('\n').some(line => {
    const trimmed = line.trim()
    return trimmed.startsWith('//') || trimmed.startsWith('/*')
  })
}
