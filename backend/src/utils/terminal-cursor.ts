export function parseTerminalCursor(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined
  if (!/^-?\d+$/.test(raw)) return null
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < -1) return null
  return parsed
}
