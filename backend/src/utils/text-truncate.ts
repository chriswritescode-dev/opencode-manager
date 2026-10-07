export interface TruncateTextResult {
  text: string
  truncated: boolean
}

export function truncateText(text: string, maxLength: number, marker: string): TruncateTextResult {
  if (text.length <= maxLength) {
    return { text, truncated: false }
  }
  return { text: `${text.slice(0, maxLength)}${marker}`, truncated: true }
}
