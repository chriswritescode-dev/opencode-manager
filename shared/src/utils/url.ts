/** Trims a URL and removes its trailing slashes. */
export function trimUrlTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Reports whether two URLs share the same origin; false when either URL is invalid. */
export function haveSameUrlOrigin(first: string, second: string): boolean {
  const origin = readUrlOrigin(first)
  return origin !== null && origin === readUrlOrigin(second)
}

function readUrlOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}
