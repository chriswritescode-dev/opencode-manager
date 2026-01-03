export function isError(error: unknown): error is Error {
  return error instanceof Error
}

export function getErrorMessage(error: unknown): string {
  if (isError(error)) {
    return error.message
  }
  return String(error)
}

export function getErrorStack(error: unknown): string | undefined {
  if (isError(error)) {
    return error.stack
  }
  return undefined
}

interface ErrorWithStatusCode {
  statusCode?: number
  status?: number
}

const VALID_STATUS_CODES = new Set([200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 405, 409, 413, 422, 500, 501, 502, 503])

export function getStatusCode(error: unknown): number {
  let code = 500
  if (error && typeof error === 'object' && 'statusCode' in error) {
    error = (error as ErrorWithStatusCode).statusCode || 500
  }
  if (error && typeof error === 'object' && 'status' in error) {
    error = (error as ErrorWithStatusCode).status || 500
  }
  if (typeof error === 'number') {
    code = error
  }
  return VALID_STATUS_CODES.has(code) ? code : 500
}