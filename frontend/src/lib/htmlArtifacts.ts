export interface HtmlArtifact {
  id: string
  title: string
  source: 'inline' | 'file' | 'devserver'
  html?: string
  path?: string
  previewUrl?: string
}

export interface OpenHtmlArtifactInput {
  title?: string
  source: 'inline' | 'file' | 'devserver'
  html?: string
  path?: string
  previewUrl?: string
}

const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const HTML_PREVIEW_STYLE_ID = 'opencode-html-preview-sizing'
const HTML_PREVIEW_VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
const HTML_PREVIEW_SIZING_STYLE = `<style id="${HTML_PREVIEW_STYLE_ID}">html,body{width:100%;max-width:100%;min-width:0;min-height:100%;height:auto!important;margin:0;overflow-x:hidden!important;overflow-y:auto!important;}#root,#__next{min-height:100%;height:auto!important;max-width:100%;overflow-x:hidden;}*,*::before,*::after{box-sizing:border-box;}img,svg,video,canvas{max-width:100%;}</style>`
const VIEWPORT_META_PATTERN = /<meta\s+[^>]*name=["']viewport["'][^>]*>/i
const HEAD_OPEN_PATTERN = /<head([^>]*)>/i
const HEAD_CLOSE_PATTERN = /<\/head>/i

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
  if (input.source === 'devserver' && !input.previewUrl) {
    throw new Error('previewUrl is required for devserver artifacts')
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const defaultTitle = input.source === 'devserver' ? 'App preview' : undefined
  const title = input.title ?? defaultTitle ?? getArtifactTitle(input.source === 'file' ? input.path : undefined)
  return { id, title, source: input.source, html: input.html, path: input.path, previewUrl: input.previewUrl }
}

export function normalizeHtmlPreviewDocument(html: string): string {
  const viewportMeta = VIEWPORT_META_PATTERN.test(html) ? '' : HTML_PREVIEW_VIEWPORT_META
  const sizingStyle = html.includes(HTML_PREVIEW_STYLE_ID) ? '' : HTML_PREVIEW_SIZING_STYLE
  const headContent = `${viewportMeta}${sizingStyle}`

  if (!headContent) return html

  if (HEAD_CLOSE_PATTERN.test(html)) {
    return html.replace(HEAD_CLOSE_PATTERN, `${headContent}</head>`)
  }

  if (HEAD_OPEN_PATTERN.test(html)) {
    return html.replace(HEAD_OPEN_PATTERN, `<head$1>${headContent}`)
  }

  return `<head>${headContent}</head>${html}`
}

export function normalizeWorkspaceFilePath(filePath: string, repoFullPath?: string): string {
  if (!filePath.startsWith('/') || !repoFullPath) return filePath
  const workspaceReposPath = repoFullPath.substring(0, repoFullPath.lastIndexOf('/'))
  if (filePath.startsWith(`${workspaceReposPath}/`)) {
    return filePath.substring(workspaceReposPath.length + 1)
  }
  return filePath
}
