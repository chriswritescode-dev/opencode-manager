import { handleApiError } from '@opencode-manager/shared'
import { FetchError } from '@opencode-manager/shared'
import type { ApiErrorResponse } from '@opencode-manager/shared'

export { FetchError }

interface FetchWrapperOptions extends RequestInit {
  timeout?: number
  params?: Record<string, string | number | boolean | undefined>
}

async function handleResponse(response: Response): Promise<never> {
  const data: ApiErrorResponse = await response.json().catch(() => ({ error: 'An error occurred' }))
  throw new FetchError(
    data.error || 'Request failed',
    response.status,
    data.code,
    data.detail
  )
}

function buildUrl(url: string, params?: Record<string, string | number | boolean | undefined>): URL {
  const urlObj = new URL(url, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        urlObj.searchParams.append(key, String(value))
      }
    })
  }
  return urlObj
}

async function fetchWithTimeout(
  url: string,
  options: FetchWrapperOptions = {}
): Promise<Response> {
  const { timeout = 30000, params, ...fetchOptions } = options
  const urlObj = buildUrl(url, params)

  const controller = new AbortController()
  const timeoutId = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null

  try {
    const response = await fetch(urlObj.toString(), {
      ...fetchOptions,
      signal: controller.signal,
    })

    if (timeoutId) clearTimeout(timeoutId)

    if (!response.ok) {
      await handleResponse(response)
    }

    return response
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new FetchError('Request timeout', 408, 'TIMEOUT')
    }
    throw error
  }
}

async function fetchWrapper<T = unknown>(
  url: string,
  options: FetchWrapperOptions = {}
): Promise<T> {
  const response = await fetchWithTimeout(url, options)

  try {
    return await response.json()
  } catch {
    throw new FetchError('Invalid JSON response', response.status, 'INVALID_JSON')
  }
}

async function fetchWrapperText(
  url: string,
  options: FetchWrapperOptions = {}
): Promise<string> {
  const response = await fetchWithTimeout(url, options)
  return response.text()
}

async function fetchWrapperVoid(
  url: string,
  options: FetchWrapperOptions = {}
): Promise<void> {
  await fetchWithTimeout(url, options)
}

async function fetchWrapperBlob(
  url: string,
  options: FetchWrapperOptions = {}
): Promise<Blob> {
  const response = await fetchWithTimeout(url, options)
  return response.blob()
}

export { fetchWrapper, fetchWrapperText, fetchWrapperVoid, fetchWrapperBlob, handleApiError }
