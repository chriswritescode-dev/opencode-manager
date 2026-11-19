import { FetchError } from '@opencode-manager/shared'
import { z } from 'zod'

export interface ParsedError {
  title: string
  message: string
  isRetryable: boolean
  statusCode?: number
}

const ValidationIssueSchema = z.object({ path: z.string(), message: z.string() })

const ErrorResponseSchema = z.looseObject({
  response: z
    .looseObject({
      data: z
        .looseObject({
          details: z.string().optional(),
          error: z.string().optional(),
          validationIssues: z.array(ValidationIssueSchema).optional(),
        })
        .optional(),
    })
    .optional(),
})

export function isGatewayTimeout(cause: unknown): boolean {
  return cause instanceof FetchError && cause.statusCode === 524
}

export function parseNetworkError(cause: unknown): ParsedError {
  if (cause instanceof Error) {
    if (cause instanceof FetchError) {
      if (cause.statusCode === 502) {
        return {
          title: 'Server Unavailable',
          message: 'The OpenCode server is not responding. It may need to be restarted.',
          isRetryable: true,
        }
      }

      if (cause.statusCode === 524) {
        return {
          title: 'Request Timeout',
          message: 'The request took too long to complete. Please try again.',
          isRetryable: true,
        }
      }
    }

    const message = cause.message.toLowerCase()

    if (message.includes('timeout') || message.includes('etimedout')) {
      return {
        title: 'Request Timeout',
        message: 'The request took too long to complete. Please try again.',
        isRetryable: true,
      }
    }

    if (
      message.includes('failed to fetch') ||
      message.includes('network error') ||
      message.includes('networkerror') ||
      message.includes('fetch failed') ||
      message.includes('econnrefused') ||
      message.includes('econnreset')
    ) {
      return {
        title: 'Connection Failed',
        message: 'Could not connect to the server. Please check your connection.',
        isRetryable: true,
      }
    }

    if (message.includes('502') || message.includes('bad gateway')) {
      return {
        title: 'Server Unavailable',
        message: 'The OpenCode server is not responding. It may need to be restarted.',
        isRetryable: true,
      }
    }

    return {
      title: 'Error',
      message: cause.message,
      isRetryable: true,
    }
  }

  return {
    title: 'Error',
    message: 'An unexpected error occurred',
    isRetryable: true,
  }
}

export function getOpenCodeApiErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof FetchError) {
    let message = cause.detail || cause.message || fallback

    if (cause.validationIssues && cause.validationIssues.length > 0) {
      const issues = cause.validationIssues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')
      message = `Validation failed: ${issues}`
    }

    return message
  }

  const parsed = ErrorResponseSchema.safeParse(cause)
  if (parsed.success) {
    const data = parsed.data.response?.data

    let message = data?.details || data?.error || fallback

    if (data?.validationIssues && data.validationIssues.length > 0) {
      const issues = data.validationIssues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')
      message = `Validation failed: ${issues}`
    }

    return message
  }

  return fallback
}
