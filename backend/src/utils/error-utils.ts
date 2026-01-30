function isError(error: unknown): error is Error {
  return error instanceof Error
}

export function getErrorMessage(error: unknown): string {
  if (isError(error)) {
    return error.message
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }
  return String(error)
}


interface ErrorWithStatusCode {
  statusCode?: number
  status?: number
}

const VALID_STATUS_CODES = new Set([200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 405, 409, 413, 422, 500, 501, 502, 503])

export function getStatusCode(error: unknown): number {
  let code = 500
  if (error && typeof error === 'object' && 'statusCode' in error) {
    code = (error as ErrorWithStatusCode).statusCode || 500
  } else if (error && typeof error === 'object' && 'status' in error) {
    code = (error as ErrorWithStatusCode).status || 500
  }
  return VALID_STATUS_CODES.has(code) ? code : 500
}