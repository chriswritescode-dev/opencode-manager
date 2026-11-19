import type { Context } from 'hono'
import type { ZodType } from 'zod'
import { z } from 'zod'
import type { GitErrorCode } from './git-errors'
import type { JsonObject } from '@opencode-manager/shared/utils'
import { ClientError, openCodeErrorStatus } from '@opencode-manager/shared/opencode'
import { isOAuthErrorCode } from '@opencode-manager/shared/schemas'
import { JsonValueSchema } from '@opencode-manager/shared/utils'
import { getErrorMessage, toContentfulStatus } from './error-utils'
import { parseGitError } from './git-errors'
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
  code?: string
  details?: unknown
}

type ServiceErrorConstructor = new (message: string, statusOrStatusCode: number) => ServiceError

interface ServiceErrorBody {
  error: string
  code?: string
  details?: unknown
}

interface GitErrorBody {
  error: string
  detail: string
  code: GitErrorCode
  details?: JsonObject
}

const TaggedErrorSchema = z.object({ _tag: z.string() })

export function handleServiceError(
  c: Context,
  cause: unknown,
  fallback: string,
  ErrorClass: ServiceErrorConstructor,
) {
  if (cause instanceof ErrorClass) {
    const status = toContentfulStatus(cause.statusCode ?? cause.status ?? 500)
    const body: ServiceErrorBody = { error: cause.message }
    if (cause.code !== undefined) {
      body.code = cause.code
    }
    if (cause.details !== undefined) {
      body.details = cause.details
    }
    return c.json(body, status)
  }
  logger.error(fallback, cause)
  return c.json({ error: getErrorMessage(cause) }, 500)
}

export function respondWithGitError(c: Context, cause: unknown, logMessage: string) {
  logger.error(logMessage, cause)
  const gitError = parseGitError(cause)
  const body: GitErrorBody = {
    error: gitError.summary,
    detail: gitError.detail,
    code: gitError.code,
  }
  if (gitError.details) {
    body.details = gitError.details
  }
  return c.json(body, gitError.statusCode)
}

export function handleOpenCodeError(
  c: Context,
  cause: unknown,
  fallback: string,
  options?: { unknownStatus?: 500 | 502 },
) {
  if (cause instanceof Error) {
    const taggedError = TaggedErrorSchema.safeParse(cause)
    if (taggedError.success) {
      const body: ServiceErrorBody = { error: cause.message || fallback }
      if (isOAuthErrorCode(taggedError.data._tag)) {
        body.code = taggedError.data._tag
      }
      return c.json(body, openCodeErrorStatus(cause) === 404 ? 404 : 502)
    }

    if (cause instanceof ClientError) {
      return c.json({ error: fallback, code: 'ClientError' }, 502)
    }
  }

  logger.error(fallback, cause)
  const status = options?.unknownStatus ?? 500
  if (status === 502) {
    return c.json({ error: getErrorMessage(cause) || fallback }, 502)
  }
  return c.json({ error: fallback }, 500)
}

export type JsonBodyResult<T> = { ok: true; data: T } | { ok: false; response: Response }

export async function parseJsonBody<T>(
  c: Context,
  schema: ZodType<T>,
  options?: { allowEmpty?: boolean; invalidMessage?: string; invalidBodyMessage?: string },
): Promise<JsonBodyResult<T>> {
  const text = await c.req.text()

  let value: z.infer<typeof JsonValueSchema>
  if (!text.trim()) {
    if (!options?.allowEmpty) {
      return { ok: false, response: c.json({ error: options?.invalidMessage ?? 'Invalid JSON' }, 400) }
    }
    value = {}
  } else {
    try {
      value = JsonValueSchema.parse(JSON.parse(text))
    } catch {
      return { ok: false, response: c.json({ error: options?.invalidMessage ?? 'Invalid JSON' }, 400) }
    }
  }

  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || 'Invalid request body'
    return {
      ok: false,
      response: c.json({ error: options?.invalidBodyMessage ?? message, details: parsed.error.issues }, 400),
    }
  }

  return { ok: true, data: parsed.data }
}
