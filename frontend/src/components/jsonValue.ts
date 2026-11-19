import { z } from 'zod'
import { JsonObjectSchema, JsonValueSchema, type JsonObject, type JsonValue } from '@opencode-manager/shared/utils'

export const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean()])

export function readJsonString(value: JsonValue | undefined): string | undefined {
  const parsed = z.string().safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function readJsonNumber(value: JsonValue | undefined): number | undefined {
  const parsed = z.number().safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function readJsonObject(value: JsonValue | undefined): JsonObject | undefined {
  const parsed = JsonObjectSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function readJsonArray(value: JsonValue | undefined): JsonValue[] | undefined {
  const parsed = z.array(JsonValueSchema).safeParse(value)
  return parsed.success ? parsed.data : undefined
}

const failureWithMessageSchema = z.object({ message: z.coerce.string() })

export function readFailureMessage(cause: unknown): string | undefined {
  if (cause instanceof Error) return cause.message
  const withMessage = failureWithMessageSchema.safeParse(cause)
  if (withMessage.success) return withMessage.data.message
  const text = z.string().safeParse(cause)
  return text.success ? text.data : undefined
}
