import stripJsonComments from 'strip-json-comments'

export function parseJsonc<T = unknown>(content: string): T {
  return JSON.parse(stripJsonComments(content)) as T
}

export function hasJsoncComments(content: string): boolean {
  return content.split('\n').some(line => {
    const trimmed = line.trim()
    return trimmed.startsWith('//') || trimmed.startsWith('/*')
  })
}
