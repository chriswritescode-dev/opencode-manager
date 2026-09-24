import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ClientError } from '@opencode-manager/shared/opencode'
import { isOAuthErrorCode, type OAuthErrorCode } from '@opencode-manager/shared/schemas'
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

const NOT_FOUND_OPENCODE_ERROR_TAGS = new Set<string>([
  'IntegrationNotFoundError',
  'IntegrationAttemptNotFoundError',
  'IntegrationMethodNotFoundError',
])

export interface OpenCodeErrorPayload {
  error: string
  code?: OAuthErrorCode
}

export interface OpenCodeErrorFailure {
  status: ContentfulStatusCode
  payload: OpenCodeErrorPayload
}

export function mapOpenCodeError(error: unknown, fallback: string): OpenCodeErrorFailure | null {
  if (!(error instanceof Error)) return null

  const tag = (error as { _tag?: unknown })._tag
  if (typeof tag === 'string') {
    return {
      status: NOT_FOUND_OPENCODE_ERROR_TAGS.has(tag) ? 404 : 502,
      payload: {
        error: error.message || fallback,
        ...(isOAuthErrorCode(tag) ? { code: tag } : {}),
      },
    }
  }

  if (error instanceof ClientError) {
    return { status: 502, payload: { error: fallback, code: 'ClientError' } }
  }

  return null
}

export function handleOpenCodeError(c: Context, error: unknown, fallback: string) {
  const failure = mapOpenCodeError(error, fallback)
  if (failure) return c.json(failure.payload, failure.status)
  logger.error(fallback, error)
  return c.json({ error: fallback }, 500)
}
