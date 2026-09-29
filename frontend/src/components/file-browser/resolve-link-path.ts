const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i

/**
 * Resolves a markdown link to the workspace path of the file or folder it points at.
 * Relative links resolve against the containing file; absolute paths are returned as-is for the files API to validate.
 * Returns null for anchors, protocol-relative URLs, and links with a URL scheme.
 */
export function resolveLinkedFilePath(fromFilePath: string, href: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('//') || URL_SCHEME.test(href)) {
    return null
  }

  let linkPath: string
  try {
    linkPath = decodeURIComponent(href.split(/[?#]/)[0])
  } catch {
    return null
  }

  if (linkPath.startsWith('/')) {
    return linkPath.replace(/\/+$/, '') || null
  }

  const segments = fromFilePath.split('/').filter(Boolean).slice(0, -1)
  for (const segment of linkPath.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..' && segments.length > 0 && segments[segments.length - 1] !== '..') {
      segments.pop()
    } else {
      segments.push(segment)
    }
  }

  return segments.join('/') || null
}
