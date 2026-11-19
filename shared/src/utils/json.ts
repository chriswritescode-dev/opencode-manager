import { z } from 'zod'

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject

export interface JsonObject {
  [key: string]: JsonValue
}

export interface JsonContainer {
  [key: string]: JsonValue | undefined
}

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonValueSchema),
    JsonObjectSchema,
  ]),
)

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), JsonValueSchema)

export const JsonContainerSchema: z.ZodType<JsonContainer> = z.record(
  z.string(),
  z.union([JsonValueSchema, z.undefined()]),
)

export function isJsonContainer(value: JsonValue | JsonContainer | undefined): value is JsonContainer {
  return JsonContainerSchema.safeParse(value).success
}

export function parseJsonObject(value: JsonValue | undefined): JsonObject | null {
  const parsed = JsonObjectSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseJsonString(value: JsonValue | undefined): string | null {
  const parsed = z.string().safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseJsonText(text: string): JsonValue | null {
  try {
    const parsed = JsonValueSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
