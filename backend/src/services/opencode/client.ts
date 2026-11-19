import { logger } from '../../utils/logger'
import { ENV } from '@opencode-manager/shared/config/env'
import { createOpenCodeApi, type OpenCodeApi } from '@opencode-manager/shared/opencode'
import { filterProxyHeaders } from '../../utils/proxy-headers'
import { forwardProxyRequest } from '../../utils/proxy-forward'
import { getOpenCodeBasicAuthHeader, type OpenCodePasswordResolver } from './auth'
import { getOpenCodeUpstreamBaseUrl, withDefaultOpenCodeDirectory } from './upstream'

const FORWARD_EXCLUDED_HEADERS: ReadonlySet<string> = new Set(['cookie'])

function resolveHostString(host: OpenCodeClientHost): string {
  return host instanceof Function ? host() : host
}

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
  defaultDirectory?: boolean
}

export class FetchOpenCodeClient implements OpenCodeClient {
  readonly api: OpenCodeApi

  constructor(private readonly config: FetchOpenCodeClientConfig) {
    this.api = createOpenCodeApi({
      baseUrl: this.resolveBaseUrl(),
      fetch: Object.assign(
        (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => this.fetchWithResolvedAuth(input, init),
        { preconnect: fetch.preconnect },
      ),
    })
  }

  private get fetchFn(): typeof fetch {
    return this.config.fetchFn ?? fetch
  }

  private resolveBaseUrl(): string {
    return resolveHostString(this.config.baseUrl)
  }

  private async getBasicAuth(): Promise<string> {
    if (!this.config.passwordResolver) {
      return this.config.basicAuth ?? ''
    }

    return await getOpenCodeBasicAuthHeader(this.config.passwordResolver)
  }

  private withDirectoryHeader(headers: Record<string, string>): Record<string, string> {
    return this.config.defaultDirectory === false ? headers : withDefaultOpenCodeDirectory(headers)
  }

  private async fetchWithResolvedAuth(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
    const headers = new Headers(this.withDirectoryHeader(Object.fromEntries(new Headers(init?.headers))))
    const basicAuth = await this.getBasicAuth()

    if (basicAuth) {
      headers.set('Authorization', basicAuth)
    }

    return this.fetchFn(input, { ...init, headers })
  }

  async forwardRaw(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/api\/opencode/, '') + url.search
    const headers = this.withDirectoryHeader(filterProxyHeaders(request.headers, FORWARD_EXCLUDED_HEADERS))
    const basicAuth = await this.getBasicAuth()

    if (basicAuth) {
      headers.Authorization = basicAuth
    }

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'

    try {
      return await forwardProxyRequest({
        url: this.resolveBaseUrl() + path,
        method: request.method,
        headers,
        body: hasBody ? request.body : null,
        signal: request.signal,
        fetchFn: this.fetchFn,
        buildResponseHeaders: (upstream) => new Headers(filterProxyHeaders(upstream)),
      })
    } catch (error) {
      logger.error(`Proxy request failed for ${path}:`, error)
      return new Response(JSON.stringify({ error: 'Proxy request failed' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
}

export function createOpenCodeClient(
  passwordOverride?: string | OpenCodePasswordResolver,
  host?: OpenCodeClientHost,
): OpenCodeClient {
  const resolveConfiguredHost = host instanceof Function ? host : () => (host ?? ENV.OPENCODE.HOST)
  const baseUrl: OpenCodeClientHost = () => getOpenCodeUpstreamBaseUrl(resolveConfiguredHost())
  const passwordResolver = passwordOverride instanceof Function ? passwordOverride : undefined
  const password = passwordOverride instanceof Function ? ENV.OPENCODE.SERVER_PASSWORD : passwordOverride
  const basicAuth = password ? getOpenCodeBasicAuthHeader(password) : null

  return new FetchOpenCodeClient({ baseUrl, basicAuth, passwordResolver })
}
