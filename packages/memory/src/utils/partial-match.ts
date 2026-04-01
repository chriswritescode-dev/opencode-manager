export interface PartialMatchResult<T> {
  match: T | null
  candidates: T[]
}

export function findPartialMatch<T>(
  input: string,
  items: T[],
  getFields: (item: T) => (string | undefined)[],
): PartialMatchResult<T> {
  const inputLower = input.toLowerCase()

  let exactMatch: T | null = null
  const substringMatches: T[] = []

  for (const item of items) {
    const fields = getFields(item)
    let hasExact = false
    let hasSubstring = false

    for (const field of fields) {
      if (field === undefined) continue
      const fieldLower = field.toLowerCase()

      if (fieldLower === inputLower) {
        hasExact = true
      }
      if (fieldLower.includes(inputLower)) {
        hasSubstring = true
      }
    }

    if (hasExact) {
      exactMatch = item
      break
    }
    if (hasSubstring) {
      substringMatches.push(item)
    }
  }

  if (exactMatch) {
    return { match: exactMatch, candidates: [] }
  }

  if (substringMatches.length === 1) {
    return { match: substringMatches[0], candidates: [] }
  }

  if (substringMatches.length > 1) {
    return { match: null, candidates: substringMatches }
  }

  return { match: null, candidates: [] }
}

export function filterByPartial<T>(
  input: string | undefined,
  items: T[],
  getFields: (item: T) => (string | undefined)[],
): T[] {
  if (!input || input.length === 0) {
    return items
  }

  const inputLower = input.toLowerCase()

  return items.filter((item) => {
    const fields = getFields(item)
    for (const field of fields) {
      if (field === undefined) continue
      if (field.toLowerCase().includes(inputLower)) {
        return true
      }
    }
    return false
  })
}
