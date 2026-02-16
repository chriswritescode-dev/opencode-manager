import { FetchError } from './types/errors'
import type { ApiErrorResponse } from './types/errors'

/**
 * Handles API errors for both fetch responses and thrown errors.
 * Throws a FetchError with parsed details for failed fetch responses,
 * or rethrows errors with context for thrown exceptions.
 */
export async function handleApiError(errorOrResponse: unknown, context?: string): Promise<never> {
  if (typeof Response !== 'undefined' && errorOrResponse instanceof Response) {
    const response = errorOrResponse
    let errorMsg = 'Request failed'
    let code: string | undefined
    let detail: string | undefined
    try {
      const data = (await response.json()) as Partial<ApiErrorResponse>
      errorMsg = data.error || errorMsg
      code = data.code
      detail = data.detail
    } catch {}
    throw new FetchError(errorMsg, response.status, code, detail)
  }
  if (errorOrResponse instanceof FetchError) {
    throw new Error(`${context ? context + ': ' : ''}${errorOrResponse.message}`)
  }
  if (errorOrResponse instanceof Error) {
    throw new Error(`${context ? context + ': ' : ''}${errorOrResponse.message}`)
  }
  throw errorOrResponse
}
