export function isNoUpstreamError(error: Error): boolean {
  const patterns = [
    /The current branch .+ has no upstream branch/i,
    /no upstream configured for branch/i,
    /no upstream branch/i,
  ]
  return patterns.some(pattern => pattern.test(error.message))
}

export function parseBranchNameFromError(error: Error): string | null {
  const match = error.message.match(/The current branch (.+) has no upstream branch/i)
  return match?.[1]?.trim() ?? null
}