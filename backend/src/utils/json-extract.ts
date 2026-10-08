import type { ZodType } from 'zod'

export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) {
    return null
  }

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(start, index + 1)
      }
    }
  }

  return null
}

export function parseFirstJsonObject<T>(text: string, schema: ZodType<T>): T | null {
  const extracted = extractFirstJsonObject(text)
  if (!extracted) {
    return null
  }

  let raw: unknown
  try {
    raw = JSON.parse(extracted)
  } catch {
    return null
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return null
  }

  return parsed.data
}
