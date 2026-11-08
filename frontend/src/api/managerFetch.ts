import { isConnectivityError } from '@/lib/opencode-errors'
import { reportConnectivityFailure } from '@/lib/connectivitySignal'

/** Time a write may stay pending before a background health probe starts. */
export const SLOW_WRITE_PROBE_MS = 3000

/** Time a background health probe may take before it counts as failed. */
export const HEALTH_PROBE_TIMEOUT_MS = 3000

let probeInFlight: Promise<boolean> | null = null

function isWriteMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD'
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function probeHeaders(input: RequestInfo | URL, init?: RequestInit): HeadersInit | undefined {
  if (init?.headers) return init.headers
  return input instanceof Request ? input.headers : undefined
}

/**
 * Builds the Manager health URL for a request, keeping any base path that
 * precedes the `/api/` segment.
 */
export function managerHealthUrl(requestUrlValue: string): string {
  const origin = window.location.origin
  const { pathname } = new URL(requestUrlValue, origin)
  const apiIndex = pathname.indexOf('/api/')
  const basePath = apiIndex === -1 ? '' : pathname.slice(0, apiIndex)
  return `${origin}${basePath}/api/health`
}

async function performProbe(url: string, headers: HeadersInit | undefined): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers,
      signal: controller.signal,
    })
    return response.status >= 500
  } catch {
    return true
  } finally {
    clearTimeout(timeoutId)
  }
}

function probeManager(input: RequestInfo | URL, init?: RequestInit): Promise<boolean> {
  if (probeInFlight) return probeInFlight

  const probe = performProbe(managerHealthUrl(requestUrl(input)), probeHeaders(input, init))
  probeInFlight = probe
  void probe.finally(() => {
    if (probeInFlight === probe) probeInFlight = null
  })
  return probe
}

/**
 * Fetches Manager REST endpoints with credentials, reporting connectivity
 * failures for writes and probing health after ambiguous write failures.
 */
export async function managerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = requestMethod(input, init)
  const fetchInit: RequestInit = { ...init, credentials: 'include' }

  if (!isWriteMethod(method)) {
    return fetch(input, fetchInit)
  }

  let reported = false
  const reportOnce = (): void => {
    if (reported) return
    reported = true
    reportConnectivityFailure()
  }

  let writeSettled = false
  let slowWriteTimer: ReturnType<typeof setTimeout> | undefined
  const writePromise = (async () => fetch(input, fetchInit))()
  const slowWrite = new Promise<void>((resolve) => {
    slowWriteTimer = setTimeout(resolve, SLOW_WRITE_PROBE_MS)
  })

  void slowWrite.then(() => {
    if (writeSettled) return
    void probeManager(input, init).then((failed) => {
      if (failed && !writeSettled) reportOnce()
    })
  })

  try {
    const response = await writePromise
    writeSettled = true
    if (slowWriteTimer) clearTimeout(slowWriteTimer)

    if (response.status === 502) {
      void probeManager(input, init).then((failed) => {
        if (failed) reportOnce()
      })
    }

    return response
  } catch (error) {
    writeSettled = true
    if (slowWriteTimer) clearTimeout(slowWriteTimer)
    if (isConnectivityError(error)) reportOnce()
    throw error
  }
}
