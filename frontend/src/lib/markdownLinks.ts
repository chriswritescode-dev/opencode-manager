const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i

/**
 * Extracts the local file path a markdown link points at, decoded and without query or fragment.
 * Returns null for anchors, protocol-relative URLs, links with a URL scheme, and malformed encodings.
 */
export function getLocalLinkPath(href: string | undefined): string | null {
  if (!href || href.startsWith('#') || href.startsWith('//') || URL_SCHEME.test(href)) {
    return null
  }

  try {
    const linkPath = decodeURIComponent(href.split(/[?#]/)[0]).replace(/(.)\/+$/, '$1')
    return linkPath || null
  } catch {
    return null
  }
}

/**
 * Resolves a local link path against the workspace path of the file that contains it.
 * Absolute paths are returned unchanged for the files API to validate; leading parent segments are kept.
 */
export function resolvePathFromFile(fromFilePath: string, linkPath: string): string | null {
  if (linkPath.startsWith('/')) {
    return linkPath
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

/**
 * Maps a file path referenced from a working directory to the path the file browser opens.
 * Relative paths resolve against the directory, and paths inside the repo root become repo-local workspace paths.
 */
export function getWorkspaceFilePath(
  filePath: string,
  workspace: { directory?: string; repoFullPath?: string; repoLocalPath?: string },
): string {
  const { directory, repoFullPath, repoLocalPath } = workspace
  const baseDirectory = directory?.replace(/\/+$/, '')
  const absolutePath = filePath.startsWith('/') || !directory
    ? filePath
    : `${baseDirectory}/${filePath.replace(/^\.\//, '')}`
  return repoFullPath && repoLocalPath && absolutePath.startsWith(`${repoFullPath}/`)
    ? `${repoLocalPath}/${absolutePath.slice(repoFullPath.length + 1)}`
    : absolutePath
}

/** Returns whether a link targets an external http(s) page. */
export function isExternalLink(href: string | undefined): boolean {
  return !!href && /^https?:\/\//i.test(href)
}
