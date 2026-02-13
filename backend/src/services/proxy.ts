import { logger } from '../utils/logger'
import { ENV } from '@opencode-manager/shared/config/env'

const OPENCODE_SERVER_URL = `http://${ENV.OPENCODE.HOST}:${ENV.OPENCODE.PORT}`

export async function setOpenCodeAuth(providerId: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${OPENCODE_SERVER_URL}/auth/${providerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'api', key: apiKey }),
    })
    
    if (response.ok) {
      logger.info(`Set OpenCode auth for provider: ${providerId}`)
      return true
    }
    
    logger.error(`Failed to set OpenCode auth: ${response.status} ${response.statusText}`)
    return false
  } catch (error) {
    logger.error('Failed to set OpenCode auth:', error)
    return false
  }
}

export async function deleteOpenCodeAuth(providerId: string): Promise<boolean> {
  try {
    const response = await fetch(`${OPENCODE_SERVER_URL}/auth/${providerId}`, {
      method: 'DELETE',
    })
    
    if (response.ok) {
      logger.info(`Deleted OpenCode auth for provider: ${providerId}`)
      return true
    }
    
    logger.error(`Failed to delete OpenCode auth: ${response.status} ${response.statusText}`)
    return false
  } catch (error) {
    logger.error('Failed to delete OpenCode auth:', error)
    return false
  }
}

export type PatchConfigResult = {
  success: boolean
  error?: string
}

export async function patchOpenCodeConfig(config: Record<string, unknown>): Promise<PatchConfigResult> {
  try {
    const response = await fetch(`${OPENCODE_SERVER_URL}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    
    if (response.ok) {
      logger.info('Patched OpenCode config via API')
      return { success: true }
    }
    
    let errorMessage = `${response.status} ${response.statusText}`
    try {
      const errorBody = await response.json() as Record<string, unknown>
      if (errorBody?.name === 'ConfigInvalidError' && errorBody?.data) {
        const data = errorBody.data as { issues?: Array<{ message: string; path?: string[] }> }
        if (data.issues) {
          const issues = data.issues
            .map((issue) => 
              issue.path ? `${issue.path.join('.')}: ${issue.message}` : issue.message
            )
            .join('; ')
          errorMessage = `Invalid config: ${issues}`
        }
      } else if (typeof errorBody?.error === 'string') {
        errorMessage = errorBody.error
      } else if (typeof errorBody?.message === 'string') {
        errorMessage = errorBody.message
      }
    } catch {
      // Use default error message if we can't parse response body
    }
    
    logger.error(`Failed to patch OpenCode config: ${errorMessage}`)
    return { success: false, error: errorMessage }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Failed to patch OpenCode config:', error)
    return { success: false, error: errorMessage }
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

export async function proxyMcpAuthStart(
  serverName: string,
  directory: string | undefined,
): Promise<Response> {
  const path = `/mcp/${encodeURIComponent(serverName)}/auth`
  const url = new URL(`${OPENCODE_SERVER_URL}${path}`)
  
  if (directory) {
    url.searchParams.set('directory', directory)
  }
  
  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    
    const responseBody = await response.text()
    return new Response(responseBody, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
    })
  } catch (error) {
    logger.error(`MCP auth start failed for ${serverName}:`, error)
    return new Response(JSON.stringify({ error: 'MCP auth start failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export async function proxyMcpAuthAuthenticate(
  serverName: string,
  directory: string | undefined,
): Promise<Response> {
  const path = `/mcp/${encodeURIComponent(serverName)}/auth/authenticate`
  const url = new URL(`${OPENCODE_SERVER_URL}${path}`)
  
  if (directory) {
    url.searchParams.set('directory', directory)
  }
  
  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    
    const responseBody = await response.text()
    return new Response(responseBody, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
    })
  } catch (error) {
    logger.error(`MCP auth authenticate failed for ${serverName}:`, error)
    return new Response(JSON.stringify({ error: 'MCP auth authenticate failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

