const DISPLAY_LIMIT = 30_000
const DISPLAY_HEAD_LENGTH = 20_000
const DISPLAY_TAIL_LENGTH = 10_000

function formatOmittedSize(size: number): string {
  return size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function clampDisplayText(text: string): string {
  if (text.length <= DISPLAY_LIMIT) return text
  const headCut = text.lastIndexOf('\n', DISPLAY_HEAD_LENGTH)
  const head = headCut === -1 ? text.slice(0, DISPLAY_HEAD_LENGTH) : text.slice(0, headCut)
  const tailFrom = text.length - DISPLAY_TAIL_LENGTH
  const tailCut = text.indexOf('\n', tailFrom)
  const tail = tailCut === -1 ? text.slice(tailFrom) : text.slice(tailCut + 1)
  const omitted = formatOmittedSize(text.length - head.length - tail.length)
  const marker = `\n[… ${omitted} omitted — use the copy button for the full output …]\n`
  return head + marker + tail
}
