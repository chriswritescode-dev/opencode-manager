import { z } from 'zod'

const errorCodeSchema = z.object({ code: z.string() })

export function getErrorCode(cause: unknown): string | null {
  const parsed = errorCodeSchema.safeParse(cause)
  return parsed.success ? parsed.data.code : null
}
