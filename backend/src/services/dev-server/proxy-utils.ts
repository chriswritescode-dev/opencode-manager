export const DEV_PROXY_PREFIX = '/api/dev-proxy'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'upgrade',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'host',
])

export function parseDevProxyPath(pathname: string): { repoId: number; rest: string } | null {
  const match = pathname.match(/^\/api\/dev-proxy\/(\d+)(\/.*)?$/)
  if (!match) return null
  return { repoId: parseInt(match[1]!, 10), rest: match[2] ?? '/' }
}

export function buildUpstreamUrl(port: number, rest: string, search: string): string {
  return `http://127.0.0.1:${port}${rest}${search}`
}

export function filterProxyHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      result[key] = value
    }
  })
  return result
}

export function sanitizeUpstreamResponseHeaders(headers: Headers): Record<string, string> {
  const blocked = new Set(['x-frame-options', 'content-security-policy'])
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (!HOP_BY_HOP_HEADERS.has(lower) && !blocked.has(lower)) {
      result[key] = value
    }
  })
  result['referrer-policy'] = 'no-referrer'
  return result
}

export function prepareTransformedResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const result = { ...headers }
  delete result.etag
  delete result.ETag
  delete result['last-modified']
  delete result['Last-Modified']
  result['cache-control'] = 'no-store'
  return result
}

export function isWebSocketUpgrade(headerGet: (k: string) => string | undefined): boolean {
  const connection = headerGet('connection')?.toLowerCase() ?? ''
  const upgrade = headerGet('upgrade')?.toLowerCase() ?? ''
  return connection.includes('upgrade') && upgrade === 'websocket'
}

export function injectBaseTag(html: string, basePath: string): string {
  const htmlWithRewrittenPaths = rewriteDevProxyHtmlPaths(html, basePath)
  if (/<base\s/i.test(htmlWithRewrittenPaths)) return htmlWithRewrittenPaths

  const match = htmlWithRewrittenPaths.match(/<head[^>]*>/i)
  if (!match) return htmlWithRewrittenPaths

  const idx = match.index! + match[0].length
  return htmlWithRewrittenPaths.slice(0, idx) + `<base href="${basePath}">` + htmlWithRewrittenPaths.slice(idx)
}

export function rewriteDevProxyHtmlPaths(html: string, basePath: string): string {
  const rewrittenAttributes = html.replace(
    /\b(src|href|action|poster)=(['"])(\/[^/][^'"]*)\2/gi,
    (match, attribute: string, quote: string, path: string, offset: number, fullHtml: string) => {
      if (isBaseTagAttribute(fullHtml, offset)) return match
      const proxiedPath = toDevProxyPath(path, basePath)
      if (proxiedPath === path) return match
      return `${attribute}=${quote}${proxiedPath}${quote}`
    }
  )

  const rewrittenSrcSets = rewrittenAttributes.replace(
    /\bsrcset=(['"])([^'"]*)\1/gi,
    (_match, quote: string, value: string) => {
      const rewrittenValue = value
        .split(',')
        .map((candidate) => rewriteSrcSetCandidate(candidate, basePath))
        .join(',')
      return `srcset=${quote}${rewrittenValue}${quote}`
    }
  )

  return rewriteCssUrlReferences(rewrittenSrcSets, basePath)
}

export function rewriteViteClientHmrBase(js: string, basePath: string): string {
  const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`

  return js.replace(
    /(\$\{\s*hmrPort\s*\|\|\s*importMetaUrl\.port\s*\}\$\{)(['"])([^'"]*)\2(\})/,
    (match, prefix: string, quote: string, hmrBase: string, suffix: string) => {
      if (hmrBase.startsWith(normalizedBasePath)) return match
      const hmrBasePath = hmrBase.startsWith('/') ? hmrBase.slice(1) : hmrBase
      const proxiedHmrBase = `${normalizedBasePath}${hmrBasePath}`
      return `${prefix}${quote}${proxiedHmrBase}${quote}${suffix}`
    }
  )
}

export function rewriteDevProxyJavaScriptPaths(js: string, basePath: string): string {
  const rewrittenStaticImports = js.replace(
    /\b((?:import|export)\s+(?:[^'"]*?\s+from\s+)?)(['"])(\/[^/][^'"]*)\2/g,
    (match, prefix: string, quote: string, path: string) => {
      const proxiedPath = toDevProxyPath(path, basePath)
      if (proxiedPath === path) return match
      return `${prefix}${quote}${proxiedPath}${quote}`
    }
  )

  return rewrittenStaticImports.replace(
    /\b(import\(\s*)(['"])(\/[^/][^'"]*)\2(\s*\))/g,
    (match, prefix: string, quote: string, path: string, suffix: string) => {
      const proxiedPath = toDevProxyPath(path, basePath)
      if (proxiedPath === path) return match
      return `${prefix}${quote}${proxiedPath}${quote}${suffix}`
    }
  )
}

export function rewriteDevProxyCssPaths(css: string, basePath: string): string {
  return rewriteCssUrlReferences(css, basePath)
}

function rewriteCssUrlReferences(content: string, basePath: string): string {
  const rewrittenUrls = content.replace(
    /\burl\(\s*(['"]?)(\/(?!\/)[^)'"]*)\1\s*\)/gi,
    (match, quote: string, path: string) => {
      const proxiedPath = toDevProxyPath(path, basePath)
      if (proxiedPath === path) return match
      return `url(${quote}${proxiedPath}${quote})`
    }
  )

  return rewrittenUrls.replace(
    /(@import\s+)(['"])(\/(?!\/)[^'"]*)\2/gi,
    (match, prefix: string, quote: string, path: string) => {
      const proxiedPath = toDevProxyPath(path, basePath)
      if (proxiedPath === path) return match
      return `${prefix}${quote}${proxiedPath}${quote}`
    }
  )
}

function rewriteSrcSetCandidate(candidate: string, basePath: string): string {
  const match = candidate.match(/^(\s*)(\/\S+)(.*)$/)
  if (!match) return candidate
  const [, leading = '', path = '', descriptor = ''] = match
  return `${leading}${toDevProxyPath(path, basePath)}${descriptor}`
}

function toDevProxyPath(path: string, basePath: string): string {
  const normalizedBasePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  if (path === normalizedBasePath || path.startsWith(`${normalizedBasePath}/`)) return path
  return `${normalizedBasePath}${path}`
}

function isBaseTagAttribute(html: string, attributeOffset: number): boolean {
  const tagStart = html.lastIndexOf('<', attributeOffset)
  if (tagStart === -1) return false
  return /^<\s*base\b/i.test(html.slice(tagStart, attributeOffset))
}

