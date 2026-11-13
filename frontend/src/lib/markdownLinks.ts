const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i

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

export function resolvePathFromFile(fromFilePath: string, linkPath: string): string | null {
  if (linkPath.startsWith('/')) {
    return linkPath
  }

  const isAbsolute = fromFilePath.startsWith('/')
  const segments = fromFilePath.split('/').filter(Boolean).slice(0, -1)
  for (const segment of linkPath.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment !== '..') {
      segments.push(segment)
    } else if (segments.length === 0) {
      if (!isAbsolute) segments.push(segment)
    } else if (isAbsolute || segments[segments.length - 1] !== '..') {
      segments.pop()
    } else {
      segments.push(segment)
    }
  }

  const resolved = segments.join('/')
  return isAbsolute ? `/${resolved}` : resolved || null
}

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

export function isExternalLink(href: string | undefined): boolean {
  return !!href && /^https?:\/\//i.test(href)
}
