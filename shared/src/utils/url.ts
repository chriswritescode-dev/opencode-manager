/** Trims a URL and removes its trailing slashes. */
export function trimUrlTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '')
}
