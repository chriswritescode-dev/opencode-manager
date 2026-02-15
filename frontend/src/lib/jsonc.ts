import stripJsonComments from 'strip-json-comments'

export function parseJsonc<T = unknown>(content: string): T {
  try {
    return JSON.parse(stripJsonComments(content)) as T
  } catch (e) {
    throw new Error(`Failed to parse JSONC: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export function hasJsoncComments(content: string): boolean {
  return content.split('\n').some(line => {
    const trimmed = line.trim()
    return trimmed.startsWith('//') || trimmed.startsWith('/*')
  })
}
