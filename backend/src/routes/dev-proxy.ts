import { Hono, type Context } from 'hono'
import type { Database } from 'bun:sqlite'
import { getDevServerPort } from '../services/dev-server/manager'
import {
  parseDevProxyPath,
  buildUpstreamUrl,
  filterProxyHeaders,
  sanitizeUpstreamResponseHeaders,
  prepareTransformedResponseHeaders,
  isWebSocketUpgrade,
  injectBaseTag,
  rewriteDevProxyCssPaths,
  rewriteDevProxyHtmlPaths,
  rewriteDevProxyJavaScriptPaths,
  rewriteViteClientHmrBase,
  DEV_PROXY_PREFIX,
} from '../services/dev-server/proxy-utils'
import { getDevServerConfig } from '../db/queries'

function getNotRunningHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Dev Server Not Running</title></head>
<body>
<h1>Dev Server Not Running</h1>
<p>No development server responded on localhost:${port}.</p>
<p><a href="javascript:history.back()">Go back</a></p>
</body>
</html>`
}

export function createDevProxyRoutes(db: Database): Hono {
  const app = new Hono()

  app.all('/:repoId', async (c) => {
    return handleProxyRequest(c, db)
  })

  app.all('/:repoId/*', async (c) => {
    return handleProxyRequest(c, db)
  })

  return app
}

async function handleProxyRequest(c: Context, db: Database): Promise<Response> {
  const repoId = parseInt(c.req.param('repoId'), 10)
  if (isNaN(repoId)) {
    return c.json({ error: 'Invalid repoId' }, 400)
  }

  const port = getDevServerPort(db)

  if (isWebSocketUpgrade((key: string) => c.req.header(key))) {
    return c.json({ error: 'WebSocket handled by upgrade listener' }, 426)
  }

  const url = new URL(c.req.url)
  const parsed = parseDevProxyPath(url.pathname) ?? parseMountedDevProxyPath(url.pathname, repoId)
  if (!parsed) {
    return c.json({ error: 'Invalid proxy path' }, 400)
  }

  const upstreamUrl = buildUpstreamUrl(port, parsed.rest, url.search)

  const filteredHeaders = filterProxyHeaders(c.req.raw.headers)
  delete filteredHeaders['if-none-match']
  delete filteredHeaders['if-modified-since']

  let requestBody: RequestInit['body'] = undefined
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    requestBody = c.req.raw.body
  }

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: c.req.method,
      headers: filteredHeaders,
      body: requestBody,
      redirect: 'manual',
      duplex: 'half',
    })
  } catch {
    return c.html(getNotRunningHtml(port), 503)
  }

  const sanitizedHeaders = sanitizeUpstreamResponseHeaders(upstreamResponse.headers)

  const contentType = upstreamResponse.headers.get('content-type') ?? ''

  if (contentType.includes('text/html')) {
    const config = getDevServerConfig(db, repoId)
    const text = await upstreamResponse.text()
    const basePath = `${DEV_PROXY_PREFIX}/${repoId}/`
    const modified = config.injectBase ? injectBaseTag(text, basePath) : rewriteDevProxyHtmlPaths(text, basePath)
    return new Response(modified, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: prepareTransformedResponseHeaders(sanitizedHeaders),
    })
  }

  if (isJavaScriptContentType(contentType)) {
    const text = await upstreamResponse.text()
    const basePath = `${DEV_PROXY_PREFIX}/${repoId}/`
    const rewrittenPaths = rewriteDevProxyJavaScriptPaths(text, basePath)
    const modified = isViteClientRequest(parsed.rest)
      ? rewriteViteClientHmrBase(rewrittenPaths, basePath)
      : rewrittenPaths
    return new Response(modified, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: prepareTransformedResponseHeaders(sanitizedHeaders),
    })
  }

  if (isCssContentType(contentType)) {
    const text = await upstreamResponse.text()
    const modified = rewriteDevProxyCssPaths(text, `${DEV_PROXY_PREFIX}/${repoId}/`)
    return new Response(modified, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: prepareTransformedResponseHeaders(sanitizedHeaders),
    })
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: sanitizedHeaders,
  })
}

function isViteClientRequest(rest: string): boolean {
  return rest === '/@vite/client'
}

function isJavaScriptContentType(contentType: string): boolean {
  return contentType.includes('javascript') || contentType.includes('ecmascript')
}

function isCssContentType(contentType: string): boolean {
  return contentType.includes('text/css')
}

function parseMountedDevProxyPath(pathname: string, repoId: number): { repoId: number; rest: string } | null {
  const prefix = `/${repoId}`
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null
  const rest = pathname.slice(prefix.length)
  return { repoId, rest: rest || '/' }
}
