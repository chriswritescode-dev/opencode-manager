import type { z } from 'zod'

export async function readJson<Schema extends z.ZodType>(
  response: Response,
  schema: Schema,
): Promise<z.infer<Schema>> {
  return schema.parse(await response.json())
}
