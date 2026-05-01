import { logger } from '../../utils/logger'
import { ENV } from '@opencode-manager/shared/config/env'

export interface ForwardRequest {
  method: string
  path: string
  body?: string
  headers?: Record<string, string>
  directory?: string
  signal?: AbortSignal
}

export interface JsonRequestOptions {
  directory?: string
  headers?: Record<string, string>
  signal?: AbortSignal
}

export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
    message?: string,
  ) {
    super(message ?? `OpenCode upstream returned ${status}`)
    this.name = 'UpstreamError'
  }
}

export interface OpenCodeClient {
  forward(req: ForwardRequest): Promise<Response>
  forwardRaw(request: Request): Promise<Response>
  getJson<T>(path: string, opts?: JsonRequestOptions): Promise<T>
  postJson<T>(path: string, body: unknown, opts?: JsonRequestOptions): Promise<T>
  setProviderAuth(providerId: string, apiKey: string): Promise<boolean>
  deleteProviderAuth(providerId: string): Promise<boolean>
  startMcpAuth(serverName: string, directory?: string): Promise<Response>
  authenticateMcp(serverName: string, directory?: string): Promise<Response>
}

export interface FetchOpenCodeClientConfig {
  baseUrl: string
  basicAuth: string
  fetchFn?: typeof fetch
}

export class FetchOpenCodeClient implements OpenCodeClient {
  constructor(private readonly config: FetchOpenCodeClientConfig) {}

  private get fetchFn(): typeof fetch {
    return this.config.fetchFn ?? fetch
  }

  private async request(req: ForwardRequest): Promise<Response> {
    const url = new URL(this.config.baseUrl + req.path)

    if (req.directory) {
      url.searchParams.set('directory', req.directory)
    }

    const headers: Record<string, string> = { ...(req.headers ?? {}) }

    if (this.config.basicAuth) {
      headers.Authorization = this.config.basicAuth
    }

    try {
      const response = await this.fetchFn(url, {
        method: req.method,
        headers,
        body: req.body,
        signal: req.signal,
      })

      const filteredHeaders: Record<string, string> = {}
      const skipHeaders = new Set(['connection', 'transfer-encoding', 'content-encoding', 'content-length'])
      response.headers.forEach((value, key) => {
        if (!skipHeaders.has(key.toLowerCase())) {
          filteredHeaders[key] = value
        }
      })

      const noBodyStatuses = new Set([101, 204, 205, 304])
      if (noBodyStatuses.has(response.status)) {
        return new Response(null, {
          status: response.status,
          statusText: response.statusText,
          headers: filteredHeaders,
        })
      }

      const body = await response.text()
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: filteredHeaders,
      })
    } catch (error) {
      logger.error(`Proxy request failed for ${req.path}:`, error)
      return new Response(JSON.stringify({ error: 'Proxy request failed' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  async forward(req: ForwardRequest): Promise<Response> {
    return this.request(req)
  }

  async forwardRaw(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const cleanPathname = url.pathname.replace(/^\/api\/opencode/, '')

    if (url.pathname.includes('/permissions/')) {
      logger.info(`Proxying permission request: ${url.pathname}${url.search} -> ${cleanPathname}${url.search}`)
    }

    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase()
      if (!['host', 'connection', 'authorization'].includes(lowerKey)) {
        headers[key] = value
      }
    })

    const body = request.method !== 'GET' && request.method !== 'HEAD'
      ? await request.text()
      : undefined

    return this.request({
      method: request.method,
      path: cleanPathname + url.search,
      body,
      headers,
    })
  }

  async getJson<T>(path: string, opts?: JsonRequestOptions): Promise<T> {
    const response = await this.request({
      method: 'GET',
      path,
      directory: opts?.directory,
      headers: opts?.headers,
      signal: opts?.signal,
    })

    if (!response.ok) {
      const bodyText = await response.text()
      throw new UpstreamError(response.status, bodyText)
    }

    return (await response.json()) as T
  }

  async postJson<T>(path: string, body: unknown, opts?: JsonRequestOptions): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts?.headers ?? {}),
    }

    const response = await this.request({
      method: 'POST',
      path,
      body: JSON.stringify(body),
      headers,
      directory: opts?.directory,
      signal: opts?.signal,
    })

    if (!response.ok) {
      const bodyText = await response.text()
      throw new UpstreamError(response.status, bodyText)
    }

    return (await response.json()) as T
  }

  async setProviderAuth(providerId: string, apiKey: string): Promise<boolean> {
    const response = await this.request({
      method: 'PUT',
      path: `/auth/${encodeURIComponent(providerId)}`,
      body: JSON.stringify({ type: 'api', key: apiKey }),
      headers: { 'Content-Type': 'application/json' },
    })

    if (response.ok) {
      logger.info(`Set OpenCode auth for provider: ${providerId}`)
      return true
    }

    if (response.status === 502) {
      logger.error(`Failed to set OpenCode auth for provider: ${providerId}`)
      return false
    }

    logger.error(`Failed to set OpenCode auth: ${response.status} ${response.statusText}`)
    return false
  }

  async deleteProviderAuth(providerId: string): Promise<boolean> {
    const response = await this.request({
      method: 'DELETE',
      path: `/auth/${encodeURIComponent(providerId)}`,
    })

    if (response.ok) {
      logger.info(`Deleted OpenCode auth for provider: ${providerId}`)
      return true
    }

    if (response.status === 502) {
      logger.error(`Failed to delete OpenCode auth for provider: ${providerId}`)
      return false
    }

    logger.error(`Failed to delete OpenCode auth: ${response.status} ${response.statusText}`)
    return false
  }

  async startMcpAuth(serverName: string, directory?: string): Promise<Response> {
    return this.request({
      method: 'POST',
      path: `/mcp/${encodeURIComponent(serverName)}/auth`,
      headers: { 'Content-Type': 'application/json' },
      directory,
    })
  }

  async authenticateMcp(serverName: string, directory?: string): Promise<Response> {
    return this.request({
      method: 'POST',
      path: `/mcp/${encodeURIComponent(serverName)}/auth/authenticate`,
      headers: { 'Content-Type': 'application/json' },
      directory,
    })
  }
}

export function createOpenCodeClient(): OpenCodeClient {
  const baseUrl = `http://${ENV.OPENCODE.HOST}:${ENV.OPENCODE.PORT}`
  const password = ENV.OPENCODE.SERVER_PASSWORD
  const username = ENV.OPENCODE.SERVER_USERNAME
  const basicAuth = password
    ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    : ''

  return new FetchOpenCodeClient({ baseUrl, basicAuth })
}
