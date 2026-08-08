export interface ParsedMarkdownTemplate {
  title?: string
  category?: string
  cadenceHint?: string
  suggestedName?: string
  suggestedDescription?: string
  description?: string
  prompt: string
}

interface FrontmatterMap {
  title?: string
  category?: string
  cadenceHint?: string
  suggestedName?: string
  suggestedDescription?: string
  description?: string
}

const KEY_MAP: Record<string, keyof FrontmatterMap> = {
  title: 'title',
  category: 'category',
  cadenceHint: 'cadenceHint',
  cadence: 'cadenceHint',
  suggestedName: 'suggestedName',
  suggestedDescription: 'suggestedDescription',
  description: 'description',
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function parseFrontmatter(raw: string): { frontmatter: FrontmatterMap; body: string } | null {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return null
  }

  const closing = raw.indexOf('\n---', 1)
  if (closing === -1) {
    return null
  }

  const fmBlock = raw.slice(4, closing)
  const body = raw.slice(closing + 5)
  const frontmatter: FrontmatterMap = {}

  for (const line of fmBlock.split('\n')) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue

    const key = line.slice(0, colonIndex).trim()
    const value = line.slice(colonIndex + 1).trim()
    if (!key || value === undefined) continue

    const mappedKey = KEY_MAP[key]
    if (mappedKey) {
      frontmatter[mappedKey] = stripQuotes(value)
    }
  }

  return { frontmatter, body }
}

function extractFirstH1(text: string): string | undefined {
  const match = text.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim()
}

function deriveTitle(fileName?: string): string {
  if (!fileName) return 'Imported template'
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.md')) return fileName.slice(0, -3)
  if (lower.endsWith('.markdown')) return fileName.slice(0, -9)
  return fileName
}

export function parseMarkdownTemplate(raw: string, fileName?: string): ParsedMarkdownTemplate {
  const result: ParsedMarkdownTemplate = { prompt: '' }

  const parsed = parseFrontmatter(raw)

  if (parsed) {
    if (parsed.frontmatter.title !== undefined) result.title = parsed.frontmatter.title
    if (parsed.frontmatter.category !== undefined) result.category = parsed.frontmatter.category
    if (parsed.frontmatter.cadenceHint !== undefined) result.cadenceHint = parsed.frontmatter.cadenceHint
    if (parsed.frontmatter.suggestedName !== undefined) result.suggestedName = parsed.frontmatter.suggestedName
    if (parsed.frontmatter.suggestedDescription !== undefined) result.suggestedDescription = parsed.frontmatter.suggestedDescription
    if (parsed.frontmatter.description !== undefined) result.description = parsed.frontmatter.description
    result.prompt = parsed.body.trim()
  } else {
    result.prompt = raw.trim()
  }

  if (!result.title && result.prompt) {
    result.title = extractFirstH1(result.prompt)
  }

  if (!result.title) {
    result.title = deriveTitle(fileName)
  }

  if (!result.suggestedName && result.title) {
    result.suggestedName = result.title
  }

  return result
}
