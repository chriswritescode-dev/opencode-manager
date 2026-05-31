export const PERMISSION_LABELS: Record<string, string> = {
  read: 'Read File',
  edit: 'Edit File',
  write: 'Write File',
  glob: 'Search Files',
  grep: 'Search Content',
  list: 'List Directory',
  bash: 'Run Command',
  task: 'Run Task',
  external_directory: 'External Access',
  todowrite: 'Write Todo',
  todoread: 'Read Todo',
  question: 'Ask Question',
  webfetch: 'Fetch URL',
  websearch: 'Web Search',
  codesearch: 'Code Search',
  lsp: 'LSP Action',
  doom_loop: 'Repeated Action',
}

export function getPermissionLabel(permission: string): string {
  if (permission in PERMISSION_LABELS) return PERMISSION_LABELS[permission]!
  if (!permission) return 'Approval'
  return permission.charAt(0).toUpperCase() + permission.slice(1)
}

interface PermissionLike {
  permission?: unknown
  metadata?: unknown
  patterns?: unknown
}

export function getPermissionDetail(input: PermissionLike): string {
  const permission = typeof input.permission === 'string' ? input.permission : ''
  const metadata = (input.metadata && typeof input.metadata === 'object' ? input.metadata : {}) as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

  switch (permission) {
    case 'bash':
      return str(metadata.command) ?? fallbackPattern(input)
    case 'edit':
    case 'write':
      return str(metadata.filePath) ?? fallbackPattern(input)
    case 'webfetch':
      return str(metadata.url) ?? fallbackPattern(input)
    case 'external_directory':
      return str(metadata.command) ?? str(metadata.filepath) ?? fallbackPattern(input)
    case 'doom_loop': {
      const tool = str(metadata.tool)
      return tool ? `Tool: ${tool}` : fallbackPattern(input)
    }
    default:
      return fallbackPattern(input)
  }
}

function fallbackPattern(input: PermissionLike): string {
  const patterns = Array.isArray(input.patterns) ? input.patterns.filter((p): p is string => typeof p === 'string') : []
  return patterns[0] ?? ''
}

interface QuestionLike {
  questions?: unknown
}

export function getQuestionText(input: QuestionLike): string {
  const questions = Array.isArray(input.questions) ? input.questions : []
  const first = questions[0] as { question?: unknown } | undefined
  return first && typeof first.question === 'string' && first.question.length > 0 ? first.question : ''
}
