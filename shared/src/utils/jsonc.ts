import { parse as parseJsoncLib, parseTree, findNodeAtLocation, type ParseError, type JSONPath } from 'jsonc-parser'

export function parseJsonc<T = unknown>(content: string): T {
  const errors: ParseError[] = []
  const result = parseJsoncLib(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })

  if (errors.length > 0) {
    const error = errors[0]!
    const message = getParseErrorMessage(error.error, content, error.offset)
    throw new SyntaxError(message)
  }

  return result as T
}

export function getParseErrorMessage(error: number, content: string, offset: number | undefined): string {
  if (offset === undefined) {
    return getErrorMessageByCode(error)
  }
  
  const line = content.substring(0, offset).split('\n').length
  const col = (content.substring(0, offset).split('\n').pop()?.length ?? 0) + 1
  
  const message = getErrorMessageByCode(error)
  return `${message} at line ${line}, column ${col}`
}

function getErrorMessageByCode(error: number): string {
  const errorMessages: Record<number, string> = {
    1: 'Invalid symbol',
    2: 'Invalid number format',
    3: 'Property name expected',
    4: 'Value expected',
    5: 'Colon expected',
    6: 'Comma expected',
    7: 'Trailing comma not allowed',
    8: 'Unexpected end of input',
    9: 'Invalid comment',
  }

  return errorMessages[error] || 'Invalid JSONC'
}

export function parseJsoncErrorLine(error: unknown): number | null {
  if (!(error instanceof SyntaxError)) return null
  const match = error.message.match(/at line (\d+)/)
  return match ? Number(match[1]) : null
}

export function findJsoncLineForPath(content: string, path: JSONPath): number | null {
  if (path.length === 0) return null
  const root = parseTree(content, [], { allowTrailingComma: true, disallowComments: false })
  if (!root) return null
  const node = findNodeAtLocation(root, path)
  if (!node) return null
  return content.substring(0, node.offset).split('\n').length
}

export function parseJsoncPathSegments(path: string): JSONPath {
  if (!path || path === 'root') return []
  return path.split('.').map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment))
}
