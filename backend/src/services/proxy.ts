import { logger } from '../utils/logger'
import { ENV } from '@opencode-manager/shared/config/env'

const OPENCODE_SERVER_URL = `http://127.0.0.1:${ENV.OPENCODE.PORT}`

export async function patchOpenCodeConfig(config: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch(`${OPENCODE_SERVER_URL}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    
    if (response.ok) {
      logger.info('Patched OpenCode config via API')
      return true
    }
    
    logger.error(`Failed to patch OpenCode config: ${response.status} ${response.statusText}`)
    return false
  } catch (error) {
    logger.error('Failed to patch OpenCode config:', error)
    return false
  }
}

export async function proxyRequest(request: Request) {
  const url = new URL(request.url)
  
  // Remove /api/opencode prefix from pathname before forwarding
  const cleanPathname = url.pathname.replace(/^\/api\/opencode/, '')
  const targetUrl = `${OPENCODE_SERVER_URL}${cleanPathname}${url.search}`
  
  if (url.pathname.includes('/permissions/')) {
    logger.info(`Proxying permission request: ${url.pathname}${url.search} -> ${targetUrl}`)
  }
  
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
    logger.error(`Proxy request failed for ${url.pathname}${url.search}:`, error)
    return new Response(JSON.stringify({ error: 'Proxy request failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export async function proxyToOpenCodeWithDirectory(
  path: string,
  method: string,
  directory: string | undefined,
  body?: string,
  headers?: Record<string, string>
): Promise<Response> {
  const url = new URL(`${OPENCODE_SERVER_URL}${path}`)
  
  if (directory) {
    url.searchParams.set('directory', directory)
  }
  
  try {
    const response = await fetch(url.toString(), {
      method,
      headers: headers || { 'Content-Type': 'application/json' },
      body,
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
    logger.error(`Proxy to OpenCode failed for ${path}:`, error)
    return new Response(JSON.stringify({ error: 'Proxy request failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
