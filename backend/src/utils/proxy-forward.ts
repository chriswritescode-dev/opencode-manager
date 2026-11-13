import { NULL_BODY_STATUSES } from './proxy-headers'

export class ProxyHeadersTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Upstream did not send response headers within ${timeoutMs}ms`)
    this.name = 'ProxyHeadersTimeoutError'
  }
}

export interface ForwardProxyRequestInput {
  url: string | URL
  method: string
  headers: Record<string, string>
  body: RequestInit['body']
  signal?: AbortSignal
  headersTimeoutMs?: number
  fetchFn?: typeof fetch
  buildResponseHeaders: (upstream: Headers) => Headers
}

export async function forwardProxyRequest({
  url,
  method,
  headers,
  body,
  signal,
  headersTimeoutMs,
  fetchFn = fetch,
  buildResponseHeaders,
}: ForwardProxyRequestInput): Promise<Response> {
  const timeoutMs = body === null || body === undefined ? headersTimeoutMs : undefined
  const timeoutController = timeoutMs === undefined ? null : new AbortController()
  let headersTimedOut = false
  const timeoutTimer = timeoutController === null
    ? null
    : setTimeout(() => {
        headersTimedOut = true
        timeoutController.abort()
      }, timeoutMs)

  const requestSignal = timeoutController === null
    ? signal
    : signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal

  let upstream: Response
  try {
    upstream = await fetchFn(url, {
      method,
      headers,
      body: body ?? undefined,
      redirect: 'manual',
      duplex: 'half',
      signal: requestSignal,
    })
  } catch (error) {
    if (headersTimedOut && timeoutMs !== undefined) {
      throw new ProxyHeadersTimeoutError(timeoutMs)
    }
    throw error
  } finally {
    if (timeoutTimer !== null) clearTimeout(timeoutTimer)
  }

  return new Response(NULL_BODY_STATUSES.has(upstream.status) ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildResponseHeaders(upstream.headers),
  })
}
