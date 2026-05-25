export interface FileReference {
  filePath: string
  lineNumber?: number
  startIndex: number
  endIndex: number
  fullMatch: string
}

const FILE_REFERENCE_PATTERN = /\b([\w\-./]+\.(ts|tsx|js|jsx|py|java|cpp|c|h|hpp|go|rs|rb|php|swift|kt|cs|vue|svelte|css|scss|sass|less|html|xml|json|yaml|yml|md|txt|sh|bash|sql|graphql|proto|toml|ini|conf|env))(?::(\d+))?\b/gi

export function detectFileReferences(text: string): FileReference[] {
  const references: FileReference[] = []
  const regex = new RegExp(FILE_REFERENCE_PATTERN)
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const fullMatch = match[0]
    const filePath = match[1]
    const lineNumber = match[3] ? parseInt(match[3], 10) : undefined

    references.push({
      filePath,
      lineNumber,
      startIndex: match.index,
      endIndex: match.index + fullMatch.length,
      fullMatch,
    })
  }

  return references
}


