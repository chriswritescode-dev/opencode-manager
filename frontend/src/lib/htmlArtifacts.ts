export interface HtmlArtifact {
  id: string
  title: string
  source: 'inline' | 'file'
  html?: string
  path?: string
}

export interface OpenHtmlArtifactInput {
  title?: string
  source: 'inline' | 'file'
  html?: string
  path?: string
}

const HTML_EXTENSIONS = new Set(['.html', '.htm'])

export function isHtmlPath(path: string | undefined): boolean {
  if (!path) return false
  const clean = path.split(/[?#]/)[0].toLowerCase()
  return HTML_EXTENSIONS.has(clean.slice(clean.lastIndexOf('.')))
}

export function getArtifactTitle(pathOrTitle: string | undefined): string {
  if (!pathOrTitle) return 'Untitled Artifact'
  const lastSegment = pathOrTitle.split('/').pop() || pathOrTitle
  if (isHtmlPath(lastSegment)) {
    return lastSegment.slice(0, lastSegment.lastIndexOf('.'))
  }
  return lastSegment
}

export function createHtmlArtifact(input: OpenHtmlArtifactInput): HtmlArtifact {
  if (input.source === 'file' && !input.path) {
    throw new Error('path is required for file artifacts')
  }
  if (input.source === 'inline' && !input.html) {
    throw new Error('html is required for inline artifacts')
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const title = input.title ?? getArtifactTitle(input.source === 'file' ? input.path : undefined)
  return { id, title, source: input.source, html: input.html, path: input.path }
}

export function normalizeWorkspaceFilePath(filePath: string, repoFullPath?: string): string {
  if (!filePath.startsWith('/') || !repoFullPath) return filePath
  const workspaceReposPath = repoFullPath.substring(0, repoFullPath.lastIndexOf('/'))
  if (filePath.startsWith(`${workspaceReposPath}/`)) {
    return filePath.substring(workspaceReposPath.length + 1)
  }
  return filePath
}
