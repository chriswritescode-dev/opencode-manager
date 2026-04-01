import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { getErrorMessage } from './error-utils'
import { logger } from './logger'

export function parseId(value: string | undefined, label?: string, ErrorClass?: new (message: string, status: number) => Error): number {
  if (!value) {
    throw ErrorClass
      ? new ErrorClass(`Missing ${label || 'id'}`, 400)
      : new Error(`Missing ${label || 'id'}`)
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    throw ErrorClass
      ? new ErrorClass(`Invalid ${label || 'id'}`, 400)
      : new Error(`Invalid ${label || 'id'}`)
  }
  return parsed
}

interface ServiceError {
  message: string
  statusCode?: number
  status?: number
}

type ServiceErrorConstructor = new (message: string, statusOrStatusCode: number) => ServiceError

export function handleServiceError(
  c: Context,
  error: unknown,
  fallback: string,
  ErrorClass: ServiceErrorConstructor,
) {
  if (error instanceof ErrorClass) {
    const status = (error as ServiceError).statusCode ?? (error as ServiceError).status ?? 500
    return c.json({ error: error.message }, status as ContentfulStatusCode)
  }
  logger.error(fallback, error)
  return c.json({ error: getErrorMessage(error) }, 500)
}
