import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'

const MessageCarrierSchema = z.object({ message: z.coerce.string() })

const StatusCarrierSchema = z.object({
  statusCode: z.number().optional(),
  status: z.number().optional(),
})

const CONTENTFUL_STATUS_VALUES = [
  200, 201, 202, 203, 206, 207, 208, 226,
  300, 301, 302, 303, 305, 306, 307, 308,
  400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418,
  421, 422, 423, 424, 425, 426, 428, 429, 431, 451,
  500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
] satisfies readonly ContentfulStatusCode[]

const CONTENTFUL_STATUS_CODES = new Map<number, ContentfulStatusCode>(
  CONTENTFUL_STATUS_VALUES.map((code): [number, ContentfulStatusCode] => [code, code]),
)

const ERROR_STATUS_VALUES = [
  200, 201, 301, 302, 400, 401, 403, 404, 405, 409, 413, 422, 500, 501, 502, 503,
] satisfies readonly ContentfulStatusCode[]

const ERROR_STATUS_CODES = new Map<number, ContentfulStatusCode>(
  ERROR_STATUS_VALUES.map((code): [number, ContentfulStatusCode] => [code, code]),
)

export function toContentfulStatus(status: number): ContentfulStatusCode {
  return CONTENTFUL_STATUS_CODES.get(status) ?? 500
}

export function getErrorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message
  }
  const parsed = MessageCarrierSchema.safeParse(cause)
  if (parsed.success) {
    return parsed.data.message
  }
  return String(cause)
}

export function getStatusCode(cause: unknown): ContentfulStatusCode {
  const parsed = StatusCarrierSchema.safeParse(cause)
  if (!parsed.success) {
    return 500
  }
  return ERROR_STATUS_CODES.get(parsed.data.statusCode ?? parsed.data.status ?? 500) ?? 500
}
