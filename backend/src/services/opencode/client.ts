import { logger } from '../../utils/logger'
import { ENV } from '@opencode-manager/shared/config/env'
import { createOpenCodeApi, type OpenCodeApi } from '@opencode-manager/shared/opencode'
import { getOpenCodeBasicAuthHeader, type OpenCodePasswordResolver } from './auth'
import { getOpenCodeUpstreamBaseUrl, withDefaultOpenCodeDirectory } from './upstream'

export interface OpenCodeClient {
  readonly api: OpenCodeApi
  forwardRaw(request: Request): Promise<Response>
}

export type OpenCodeClientHost = string | (() => string)

export interface FetchOpenCodeClientConfig {
  baseUrl: OpenCodeClientHost
  basicAuth: string | null
  passwordResolver?: OpenCodePasswordResolver
  fetchFn?: typeof fetch
}

export class FetchOpenCodeClient implements OpenCodeClient {
  readonly api: OpenCodeApi

  constructor(private readonly config: FetchOpenCodeClientConfig) {
    this.api = createOpenCodeApi({
      baseUrl: this.resolveBaseUrl(),
      fetch: ((input, init) => this.fetchWithResolvedAuth(input, init)) as typeof fetch,
    })
  }

  private get fetchFn(): typeof fetch {
    return this.config.fetchFn ?? fetch
  }

  private resolveBaseUrl(): string {
    return typeof this.config.baseUrl === 'function' ? this.config.baseUrl() : this.config.baseUrl
  }

  private async getBasicAuth(): Promise<string> {
    if (!this.config.passwordResolver) {
      return this.config.basicAuth ?? ''
    }

    return await getOpenCodeBasicAuthHeader(this.config.passwordResolver)
  }

  private async fetchWithResolvedAuth(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
    const headers = new Headers(withDefaultOpenCodeDirectory(Object.fromEntries(new Headers(init?.headers))))
    const basicAuth = await this.getBasicAuth()

    if (basicAuth) {
      headers.set('Authorization', basicAuth)
    }

    return this.fetchFn(input, { ...init, headers })
  }

  private async request(req: { method: string; path: string; body?: string; headers?: Record<string, string> }): Promise<Response> {
    const url = new URL(this.resolveBaseUrl() + req.path)

    const headers: Record<string, string> = withDefaultOpenCodeDirectory({ ...(req.headers ?? {}) })

    const basicAuth = await this.getBasicAuth()

    if (basicAuth) {
      headers.Authorization = basicAuth
    }

    try {
      const response = await this.fetchFn(url, {
        method: req.method,
        headers,
        body: req.body,
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
}

export function createOpenCodeClient(
  passwordOverride?: string | OpenCodePasswordResolver,
  host?: OpenCodeClientHost,
): OpenCodeClient {
  const resolveConfiguredHost = typeof host === 'function' ? host : () => (host ?? ENV.OPENCODE.HOST)
  const baseUrl: OpenCodeClientHost = () => getOpenCodeUpstreamBaseUrl(resolveConfiguredHost())
  const passwordResolver = typeof passwordOverride === 'function' ? passwordOverride : undefined
  const password = typeof passwordOverride === 'string' ? passwordOverride : ENV.OPENCODE.SERVER_PASSWORD
  const basicAuth = password ? getOpenCodeBasicAuthHeader(password) : null

  return new FetchOpenCodeClient({ baseUrl, basicAuth, passwordResolver })
}
