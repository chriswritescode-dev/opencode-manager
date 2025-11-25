import { logger } from '../utils/logger'
import { ENV } from '../config'

const OPENCODE_SERVER_URL = `http://127.0.0.1:${ENV.OPENCODE.PORT}`

export async function proxyRequest(request: Request) {
  const url = new URL(request.url)
  const path = url.pathname + url.search
  
  // Remove /api/opencode prefix before forwarding to OpenCode server
  const cleanPath = path.replace(/^\/api\/opencode/, '')
  const targetUrl = `${OPENCODE_SERVER_URL}${cleanPath}`
  
  try {
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      if (!['host', 'connection'].includes(key.toLowerCase())) {
        headers[key] = value
      }
    })

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined,
    })

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      if (!['connection', 'transfer-encoding'].includes(key.toLowerCase())) {
        responseHeaders[key] = value
      }
    })

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    logger.error(`Proxy request failed for ${path}:`, error)
    return new Response(JSON.stringify({ error: 'Proxy request failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
