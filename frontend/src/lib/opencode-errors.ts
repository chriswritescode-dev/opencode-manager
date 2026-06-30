import { FetchError } from '@opencode-manager/shared'
import type { components } from '@/api/opencode-types'

export type OpenCodeError =
  | components['schemas']['ProviderAuthError']
  | components['schemas']['UnknownError']
  | components['schemas']['MessageOutputLengthError']
  | components['schemas']['MessageAbortedError']
  | components['schemas']['APIError']

export interface ParsedError {
  title: string
  message: string
  isRetryable: boolean
  statusCode?: number
  providerID?: string
}

export function parseOpenCodeError(error: OpenCodeError | undefined | null): ParsedError | null {
  if (!error) return null

  switch (error.name) {
    case 'ProviderAuthError':
      return {
        title: 'Authentication Failed',
        message: error.data.message || `Authentication failed for provider: ${error.data.providerID}`,
        isRetryable: false,
        providerID: error.data.providerID,
      }

    case 'UnknownError':
      return {
        title: 'Error',
        message: error.data.message || 'An unknown error occurred',
        isRetryable: true,
      }

    case 'MessageOutputLengthError':
      return {
        title: 'Response Too Long',
        message: 'The model response exceeded the maximum allowed length',
        isRetryable: false,
      }

    case 'MessageAbortedError':
      return null 

    case 'APIError':
      return {
        title: `API Error${error.data.statusCode ? ` (${error.data.statusCode})` : ''}`,
        message: error.data.message || 'An API error occurred',
        isRetryable: error.data.isRetryable,
        statusCode: error.data.statusCode,
      }

    default:
      return {
        title: 'Error',
        message: 'An unexpected error occurred',
        isRetryable: true,
      }
  }
}

export function isGatewayTimeout(error: unknown): boolean {
  return error instanceof FetchError && error.statusCode === 524
}

export function parseNetworkError(error: unknown): ParsedError {
  if (error instanceof Error) {
    if (error instanceof FetchError) {
      if (error.statusCode === 502) {
        return {
          title: 'Server Unavailable',
          message: 'The OpenCode server is not responding. It may need to be restarted.',
          isRetryable: true,
        }
      }

      if (error.statusCode === 524) {
        return {
          title: 'Request Timeout',
          message: 'The request took too long to complete. Please try again.',
          isRetryable: true,
        }
      }
    }

    const message = error.message.toLowerCase()

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
      message: error.message,
      isRetryable: true,
    }
  }

  return {
    title: 'Error',
    message: 'An unexpected error occurred',
    isRetryable: true,
  }
}

export function getErrorMessage(error: OpenCodeError | undefined | null): string {
  const parsed = parseOpenCodeError(error)
  return parsed ? `${parsed.title}: ${parsed.message}` : ''
}

/**
 * Extracts a human-readable message from a Manager REST API error, handling
 * both {@link FetchError} and axios-style `{ response: { data } }` shapes,
 * including OpenCode config validation issues and removed fields.
 */
export function getOpenCodeApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof FetchError) {
    let message = error.detail || error.message || fallback

    if (error.validationIssues && error.validationIssues.length > 0) {
      const issues = error.validationIssues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')
      message = `Validation failed: ${issues}`
    }

    if (error.removedFields && error.removedFields.length > 0) {
      message += ` (removed invalid fields: ${error.removedFields.join(', ')})`
    }

    return message
  }

  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { details?: string; error?: string; validationIssues?: Array<{ path: string; message: string }>; removedFields?: string[] } } }).response
    const data = response?.data

    let message = data?.details || data?.error || fallback

    if (data?.validationIssues && data.validationIssues.length > 0) {
      const issues = data.validationIssues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')
      message = `Validation failed: ${issues}`
    }

    if (data?.removedFields && data.removedFields.length > 0) {
      message += ` (removed invalid fields: ${data.removedFields.join(', ')})`
    }

    return message
  }

  return fallback
}
