import { vi, type Mock } from 'vitest'
import { z } from 'zod'
import { parseJsonText, type JsonValue } from '@opencode-manager/shared/utils'
import { setActiveFetch } from './fetchProxy'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type FetchRoutePath = string | RegExp

export interface RecordedFetchRequest {
  method: string
  path: string
  url: string
  searchParams: URLSearchParams
  headers: Record<string, string>
  body: JsonValue | null
}

export interface FetchRouteResult {
  status?: number
  headers?: Record<string, string>
  json?: object | null
  text?: string
  blob?: Blob
}

export interface FetchRoute {
  method: HttpMethod
  path: FetchRoutePath
  respond: (
    request: RecordedFetchRequest,
    params: Record<string, string>,
    init: RequestInit | undefined,
  ) => FetchRouteResult | Promise<FetchRouteResult>
}

export interface FetchFakeOptions {
  fallback?: (request: RecordedFetchRequest) => FetchRouteResult | Promise<FetchRouteResult>
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface FetchFake {
  fetch: Mock<FetchLike>
  requests: RecordedFetchRequest[]
  unmatchedRequests: RecordedFetchRequest[]
  install: () => void
  reset: () => void
  findRequests: (method: HttpMethod, path: FetchRoutePath) => RecordedFetchRequest[]
  lastRequest: (method: HttpMethod, path: FetchRoutePath) => RecordedFetchRequest | undefined
  findFormData: () => FormData | undefined
}

interface CompiledRoute {
  route: FetchRoute
  matches: (path: string) => Record<string, string> | null
}

function escapeSegment(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compilePath(pattern: FetchRoutePath): (path: string) => Record<string, string> | null {
  if (pattern instanceof RegExp) {
    return (path) => (pattern.test(path) ? {} : null)
  }

  const paramNames: string[] = []
  const source = pattern.split('/').map((segment) => {
    if (segment === '*') {
      paramNames.push('*')
      return '(.*)'
    }
    if (segment.startsWith(':')) {
      paramNames.push(segment.slice(1))
      return '([^/]+)'
    }
    return escapeSegment(segment)
  }).join('/')
  const matcher = new RegExp(`^${source}$`)

  return (path) => {
    const match = matcher.exec(path)
    if (!match) return null
    return paramNames.reduce<Record<string, string>>((params, name, index) => {
      params[name] = decodeURIComponent(match[index + 1] ?? '')
      return params
    }, {})
  }
}

function compileRoutes(routes: readonly FetchRoute[]): CompiledRoute[] {
  return routes.map((route) => ({ route, matches: compilePath(route.path) }))
}

function readRequestBody(body: BodyInit | null | undefined): JsonValue | null {
  const text = z.string().safeParse(body)
  return text.success ? parseJsonText(text.data) : null
}

function readRequestHeaders(input: RequestInfo | URL, init: RequestInit | undefined): Headers {
  if (init?.headers) return new Headers(init.headers)
  if (input instanceof Request) return new Headers(input.headers)
  return new Headers()
}

function buildResponse(reply: FetchRouteResult): Response {
  const status = reply.status ?? 200
  const headers = new Headers(reply.headers)
  if (reply.blob) return new Response(reply.blob, { status, headers })
  if (reply.text !== undefined) return new Response(reply.text, { status, headers })
  if (reply.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    return new Response(JSON.stringify(reply.json), { status, headers })
  }
  return new Response(null, { status, headers })
}

export function createFetchFake(
  routes: readonly FetchRoute[],
  options: FetchFakeOptions = {},
): FetchFake {
  const compiledRoutes = compileRoutes(routes)
  const requests: RecordedFetchRequest[] = []
  const unmatchedRequests: RecordedFetchRequest[] = []

  const fetchMock = vi.fn<FetchLike>(async (input, init) => {
    const rawUrl = input instanceof Request ? input.url : input instanceof URL ? input.toString() : input
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const url = new URL(rawUrl, window.location.origin)
    const request: RecordedFetchRequest = {
      method,
      path: url.pathname,
      url: url.toString(),
      searchParams: url.searchParams,
      headers: Object.fromEntries(readRequestHeaders(input, init).entries()),
      body: readRequestBody(init?.body),
    }
    requests.push(request)

    for (const candidate of compiledRoutes) {
      if (candidate.route.method !== method) continue
      const params = candidate.matches(url.pathname)
      if (!params) continue
      return buildResponse(await candidate.route.respond(request, params, init))
    }

    unmatchedRequests.push(request)
    if (options.fallback) return buildResponse(await options.fallback(request))

    throw new Error(
      `Unhandled ${method} ${url.pathname}. Add a fetch route or pass a fallback to createFetchFake.`,
    )
  })

  const findRequests = (method: HttpMethod, path: FetchRoutePath): RecordedFetchRequest[] => {
    const matches = compilePath(path)
    return requests.filter((request) => request.method === method && matches(request.path) !== null)
  }

  const findFormData = (): FormData | undefined => {
    for (const [, init] of [...fetchMock.mock.calls].reverse()) {
      if (init?.body instanceof FormData) return init.body
    }
    return undefined
  }

  return {
    fetch: fetchMock,
    requests,
    unmatchedRequests,
    install: () => {
      setActiveFetch(fetchMock)
      vi.stubGlobal('fetch', fetchMock)
    },
    reset: () => {
      requests.length = 0
      unmatchedRequests.length = 0
      fetchMock.mockClear()
    },
    findRequests,
    lastRequest: (method, path) => {
      const matched = findRequests(method, path)
      return matched[matched.length - 1]
    },
    findFormData,
  }
}
