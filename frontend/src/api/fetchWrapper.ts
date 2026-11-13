import { z } from 'zod'
import { JsonValueSchema, parseJsonText, type JsonValue } from '@opencode-manager/shared/utils'
import { FetchError } from '@opencode-manager/shared'

export { FetchError }

interface FetchWrapperOptions extends RequestInit {
  timeout?: number
  params?: Record<string, string | number | boolean | undefined>
  acceptedStatuses?: number[]
}

const validationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
})

const apiErrorResponseSchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
  detail: z.string().optional(),
  details: JsonValueSchema.optional(),
  validationIssues: z.array(validationIssueSchema).optional(),
  message: z.string().optional(),
  data: z.object({ message: z.string().optional() }).optional(),
})

const validationDetailSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])).optional(),
  message: z.string().optional(),
})

type ApiErrorBody = z.infer<typeof apiErrorResponseSchema>

function formatDetails(details: JsonValue | undefined): string | undefined {
  if (Array.isArray(details)) {
    return details
      .map((detail) => {
        const parsed = validationDetailSchema.safeParse(detail)
        if (!parsed.success) return null
        const path = parsed.data.path
        const message = parsed.data.message
        return path && path.length > 0 ? `${path.join('.')}: ${message}` : message
      })
      .filter(Boolean)
      .join('; ')
  }
  const text = z.string().safeParse(details)
  return text.success ? text.data : undefined
}

function parseErrorBody(text: string, status: number): ApiErrorBody {
  if (!text) return { error: 'An error occurred' }
  const parsed = apiErrorResponseSchema.safeParse(parseJsonText(text))
  if (parsed.success) return parsed.data
  return { error: /^\s*</.test(text) ? `Request failed with status ${status}` : text }
}

async function handleResponse(response: Response): Promise<never> {
  const text = await response.text().catch(() => '')
  const data = parseErrorBody(text, response.status)
  const detail = data.detail || formatDetails(data.details)
  throw new FetchError(
    data.error || data.message || data.data?.message || 'Request failed',
    response.status,
    data.code,
    detail,
    {
      details: data.details,
      validationIssues: data.validationIssues,
    }
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
  const { timeout = 30000, params, acceptedStatuses, ...fetchOptions } = options
  const urlObj = buildUrl(url, params)

  const controller = new AbortController()
  const timeoutId = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null

  try {
    const response = await fetch(urlObj.toString(), {
      credentials: 'include',
      ...fetchOptions,
      signal: controller.signal,
    })

    if (timeoutId) clearTimeout(timeoutId)

    if (!response.ok && !acceptedStatuses?.includes(response.status)) {
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

async function fetchWrapper<T>(
  url: string,
  schema: z.ZodType<T>,
  options: FetchWrapperOptions = {}
): Promise<T> {
  const response = await fetchWithTimeout(url, options)

  const body = await response.json().catch(() => {
    throw new FetchError('Invalid JSON response', response.status, 'INVALID_JSON')
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new FetchError('Unexpected response body', response.status, 'INVALID_RESPONSE', parsed.error.message)
  }
  return parsed.data
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

export { fetchWrapper, fetchWrapperVoid, fetchWrapperBlob }
