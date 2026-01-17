import type { Context } from 'hono'
import { GitAuthenticationError, GitConflictError, GitNotFoundError, GitOperationError } from '../errors/git-errors'

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
    code = (error as ErrorWithStatusCode).statusCode || 500
  } else if (error && typeof error === 'object' && 'status' in error) {
    code = (error as ErrorWithStatusCode).status || 500
  }
  return VALID_STATUS_CODES.has(code) ? code : 500
}

export function handleGitError(error: unknown, c: Context<any, any, any>) {
  if (error instanceof GitAuthenticationError) {
    return c.json({ error: error.message, code: 'AUTH_FAILED' }, 401)
  }
  if (error instanceof GitConflictError) {
    return c.json({ error: error.message, code: 'CONFLICT' }, 409)
  }
  if (error instanceof GitNotFoundError) {
    return c.json({ error: error.message, code: 'NOT_FOUND' }, 404)
  }
  return c.json({ error: getErrorMessage(error), code: 'UNKNOWN' }, 500)
}