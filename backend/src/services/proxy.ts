import { logger } from '../utils/logger'
import { ENV } from '@opencode-manager/shared/config/env'
import { parseJsonc } from '@opencode-manager/shared/utils'

export const OPENCODE_SERVER_URL = `http://${ENV.OPENCODE.HOST}:${ENV.OPENCODE.PORT}`

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

export type PatchConfigValidationIssue = {
  path: string
  message: string
}

export type PatchConfigResult = {
  success: boolean
  error?: string
  details?: PatchConfigValidationIssue[]
  removedFields?: string[]
  appliedConfig?: Record<string, unknown>
}

function getIssuePath(value: unknown): string {
  if (Array.isArray(value)) {
    const path = value
      .map((part) => typeof part === 'string' || typeof part === 'number' ? String(part) : '')
      .filter(Boolean)
      .join('.')
    return path || 'root'
  }

  if (typeof value === 'string' && value.length > 0) {
    return value
  }

  if (typeof value === 'number') {
    return String(value)
  }

  return 'root'
}

function getIssueMessage(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }

  return 'Validation error'
}

function extractValidationIssues(value: unknown): PatchConfigValidationIssue[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }

    const issue = item as Record<string, unknown>
    const nestedIssues = extractValidationIssues(issue.issues ?? issue.errors)
    if (nestedIssues.length > 0) {
      return nestedIssues
    }

    if (
      typeof issue.message === 'string'
      || typeof issue.path === 'string'
      || Array.isArray(issue.path)
      || typeof issue.instancePath === 'string'
      || Array.isArray(issue.instancePath)
    ) {
      return [{
        path: getIssuePath(issue.path ?? issue.instancePath),
        message: getIssueMessage(issue.message),
      }]
    }

    return []
  })
}

function removeFieldFromConfig(config: Record<string, unknown>, path: string): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(config)) as Record<string, unknown>
  const parts = path.split('.')
  
  let current: Record<string, unknown> = result
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!part || !current[part] || typeof current[part] !== 'object') {
      return result
    }
    current = current[part] as Record<string, unknown>
  }
  
  const lastPart = parts[parts.length - 1]
  if (lastPart) {
    delete current[lastPart]
  }
  
  return result
}

function parseErrorResponse(responseText: string): { details: PatchConfigValidationIssue[]; errorMessage: string } {
  const details: PatchConfigValidationIssue[] = []
  let errorMessage = 'Unknown error'

  try {
    const errorBody = parseJsonc(responseText) as Record<string, unknown>
    const structuredIssues = extractValidationIssues(
      errorBody?.errors
      ?? errorBody?.issues
      ?? (errorBody?.data && typeof errorBody.data === 'object'
        ? (errorBody.data as Record<string, unknown>).errors ?? (errorBody.data as Record<string, unknown>).issues
        : undefined)
    )

    if (structuredIssues.length > 0) {
      details.push(...structuredIssues)
      errorMessage = details.map((d) => `${d.path}: ${d.message}`).join('; ')
    } else if (errorBody?.name === 'ConfigInvalidError' && errorBody?.data) {
      const data = errorBody.data as { issues?: Array<{ message: string; path?: string[] }> }
      if (data.issues) {
        for (const issue of data.issues) {
          const path = issue.path ? issue.path.join('.') : 'root'
          details.push({ path, message: issue.message })
        }
        errorMessage = details.map((d) => `${d.path}: ${d.message}`).join('; ')
      }
    } else if (typeof errorBody?.error === 'string') {
      errorMessage = errorBody.error
    } else if (typeof errorBody?.message === 'string') {
      errorMessage = errorBody.message
    } else if (typeof errorBody?.success === 'boolean' && errorBody.success === false && errorBody?.data) {
      errorMessage = 'Config validation failed'
    } else {
      const snippet = responseText.slice(0, 300)
      errorMessage = `Request failed (${snippet.length < responseText.length ? 'truncated' : 'raw'} response): ${snippet}`
    }
  } catch {
    const snippet = responseText.slice(0, 300)
    errorMessage = `Parse error: ${snippet}`
  }

  return { details, errorMessage }
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
      return { success: true, appliedConfig: config }
    }

    const responseText = await response.text()
    logger.warn(`OpenCode PATCH response (${response.status}): ${responseText.slice(0, 500)}`)
    const { details, errorMessage: initialError } = parseErrorResponse(responseText)

    if (details.length === 0) {
      logger.error(`Failed to patch OpenCode config: ${initialError}`)
      return { success: false, error: initialError, details }
    }

    logger.warn(`OpenCode rejected config with validation errors: ${initialError}`)

    const problematicPaths = [...new Set(details.map((d) => d.path))]
    const removablePaths = problematicPaths.filter((path) => path !== 'root' && path.split('.').length <= 3)
    const nonRemovablePaths = problematicPaths.filter((path) => path === 'root' || path.split('.').length > 3)

    if (nonRemovablePaths.length > 0) {
      logger.error(`Failed to patch OpenCode config: ${initialError}`)
      return { success: false, error: initialError, details }
    }

    if (removablePaths.length === 0) {
      logger.error(`Failed to patch OpenCode config: ${initialError}`)
      return { success: false, error: initialError, details }
    }

    let cleanedConfig = config
    const removedFields: string[] = []

    for (const path of removablePaths) {
      cleanedConfig = removeFieldFromConfig(cleanedConfig, path)
      removedFields.push(path)
      logger.info(`Removed problematic field from config: ${path}`)
    }

    logger.info(`Retrying config patch after removing ${removedFields.length} problematic field(s): ${removedFields.join(', ')}`)
    const retryResponse = await fetch(`${OPENCODE_SERVER_URL}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanedConfig),
    })

    if (retryResponse.ok) {
      logger.info('Patched OpenCode config via API after removing invalid fields')
      return {
        success: true,
        appliedConfig: cleanedConfig,
        removedFields,
        details
      }
    }

    const retryResponseText = await retryResponse.text()
    const { details: retryDetails, errorMessage } = parseErrorResponse(retryResponseText)
    logger.error(`Failed to patch OpenCode config even after removing invalid fields: ${errorMessage}`)

    return {
      success: false,
      error: errorMessage,
      details: retryDetails.length > 0 ? retryDetails : details,
      removedFields
    }
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
    const skipHeaders = new Set(['connection', 'transfer-encoding', 'content-encoding', 'content-length'])
    response.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        responseHeaders[key] = value
      }
    })

    const body = await response.text()
    return new Response(body, {
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
    const skipHeaders = new Set(['connection', 'transfer-encoding', 'content-encoding', 'content-length'])
    response.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        responseHeaders[key] = value
      }
    })
    
    const responseBody = await response.text()
    return new Response(responseBody, {
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
