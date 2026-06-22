import type { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'
import type { AuthInstance } from '../../auth'
import { getDevServerPort } from './manager'
import { buildUpstreamUrl, filterProxyHeaders, sanitizeUpstreamResponseHeaders } from './proxy-utils'
import { logger } from '../../utils/logger'

const PreviewResponse = Response

type WebSocketMessage = string | ArrayBuffer | Uint8Array

interface PreviewWebSocketData {
  upstreamUrl: string
  protocol: string | null
  upstream: WebSocket | null
  pendingMessages: WebSocketMessage[]
}

function getUnauthorizedHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in required</title></head>
<body>
<h1>Sign in required</h1>
<p>Open the preview from an authenticated OpenCode Manager session.</p>
</body>
</html>`
}

function getNotRunningHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Dev Server Not Running</title></head>
<body>
<h1>Dev Server Not Running</h1>
<p>No development server responded on localhost:${port}.</p>
</body>
</html>`
}

function htmlResponse(html: string, status: number): Response {
  return new PreviewResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  })
}

async function hasValidSession(auth: AuthInstance, headers: Headers): Promise<boolean> {
  try {
    const session = await auth.api.getSession({ headers })
    return Boolean(session)
  } catch {
    return false
  }
}

async function handleAuthenticatedPreviewRequest(request: Request, db: Database, port: number): Promise<Response> {
  const url = new URL(request.url)
  const upstreamUrl = buildUpstreamUrl(port, url.pathname, url.search)

  const headers = filterProxyHeaders(request.headers)
  let body: RequestInit['body'] = undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = request.body
  }

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      duplex: 'half',
    } as RequestInit)
  } catch {
    return htmlResponse(getNotRunningHtml(port), 503)
  }

  return new PreviewResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: sanitizeUpstreamResponseHeaders(upstreamResponse.headers),
  })
}

export function buildUpstreamWebSocketUrl(port: number, path: string, search: string): string {
  return `ws://127.0.0.1:${port}${path}${search}`
}

export function selectWebSocketProtocol(protocolHeader: string | null): string | null {
  if (!protocolHeader) return null
  return protocolHeader
    .split(',')
    .map(protocol => protocol.trim())
    .find(Boolean) ?? null
}

function createPendingWebSocketData(upstreamUrl: string, protocol: string | null): PreviewWebSocketData {
  return {
    upstreamUrl,
    protocol,
    upstream: null,
    pendingMessages: [],
  }
}

function sendToUpstream(data: PreviewWebSocketData, message: WebSocketMessage): void {
  if (data.upstream?.readyState === WebSocket.OPEN) {
    data.upstream.send(message)
    return
  }
  data.pendingMessages.push(message)
}

function flushPendingMessages(data: PreviewWebSocketData): void {
  if (!data.upstream || data.upstream.readyState !== WebSocket.OPEN) return
  for (const message of data.pendingMessages) {
    data.upstream.send(message)
  }
  data.pendingMessages = []
}

function createUpstreamWebSocket(ws: Bun.ServerWebSocket<PreviewWebSocketData>): WebSocket {
  const data = ws.data
  const upstream = data.protocol
    ? new WebSocket(data.upstreamUrl, data.protocol)
    : new WebSocket(data.upstreamUrl)

  upstream.addEventListener('open', () => flushPendingMessages(data))
  upstream.addEventListener('message', event => ws.send(event.data))
  upstream.addEventListener('close', event => ws.close(event.code, event.reason))
  upstream.addEventListener('error', event => {
    logger.warn('Dev preview upstream websocket error', event)
    ws.close()
  })
  return upstream
}

function isPreviewWebSocketRequest(url: URL): boolean {
  return url.searchParams.has('token')
    || url.pathname.includes('webpack-hmr')
    || url.pathname === '/ws'
    || url.pathname.endsWith('/ws')
    || url.pathname.includes('/sockjs-node')
}

export function startPreviewServer(auth: AuthInstance, db: Database): Bun.Server<PreviewWebSocketData> {
  return Bun.serve<PreviewWebSocketData>({
    port: ENV.DEV_PREVIEW.PORT,
    hostname: ENV.SERVER.HOST,
    async fetch(request, server) {
      if (!(await hasValidSession(auth, request.headers))) {
        return htmlResponse(getUnauthorizedHtml(), 401)
      }

      const port = getDevServerPort(db)
      const url = new URL(request.url)
      if (isPreviewWebSocketRequest(url)) {
        const protocol = selectWebSocketProtocol(request.headers.get('sec-websocket-protocol'))
        const upgraded = server.upgrade(request, {
          data: createPendingWebSocketData(buildUpstreamWebSocketUrl(port, url.pathname, url.search), protocol),
          headers: protocol ? { 'Sec-WebSocket-Protocol': protocol } : undefined,
        })
        if (upgraded) return undefined
      }

      return handleAuthenticatedPreviewRequest(request, db, port)
    },
    websocket: {
      open(ws) {
        ws.data.upstream = createUpstreamWebSocket(ws)
      },
      message(ws, message) {
        sendToUpstream(ws.data, message)
      },
      close(ws) {
        ws.data.upstream?.close()
      },
    },
  })
}
