const PERMISSION_LABELS: Record<string, string> = {
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
  if (!permission) return 'Approval'
  return PERMISSION_LABELS[permission] ?? permission.charAt(0).toUpperCase() + permission.slice(1)
}

interface PermissionLike {
  permission?: unknown
  metadata?: unknown
  patterns?: unknown
}

export interface PermissionDetail {
  primary: string
  secondary?: string
}

export function getPermissionDetail(input: PermissionLike): PermissionDetail {
  const permission = typeof input.permission === 'string' ? input.permission : ''
  const metadata = (input.metadata && typeof input.metadata === 'object' ? input.metadata : {}) as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

  switch (permission) {
    case 'bash': {
      const command = str(metadata.command)
      if (command) return { primary: command }
      break
    }
    case 'edit':
    case 'write': {
      const filePath = str(metadata.filePath)
      if (filePath) {
        const diff = str(metadata.diff)
        return { primary: filePath, secondary: diff ? diff.slice(0, 500) + (diff.length > 500 ? '\n...' : '') : undefined }
      }
      break
    }
    case 'webfetch': {
      const url = str(metadata.url)
      if (url) return { primary: url }
      break
    }
    case 'external_directory': {
      const value = str(metadata.command) ?? str(metadata.filepath)
      if (value) return { primary: value }
      break
    }
    case 'doom_loop': {
      const tool = str(metadata.tool)
      if (tool) {
        const input2 = metadata.input
        return { primary: `Tool: ${tool}`, secondary: input2 ? JSON.stringify(input2, null, 2).slice(0, 300) : undefined }
      }
      break
    }
  }

  return { primary: fallbackPattern(input) }
}

function fallbackPattern(input: PermissionLike): string {
  const patterns = Array.isArray(input.patterns) ? input.patterns.filter((p): p is string => typeof p === 'string') : []
  return patterns.join('\n')
}

interface QuestionLike {
  questions?: unknown
}

export function getQuestionText(input: QuestionLike): string {
  const questions = Array.isArray(input.questions) ? input.questions : []
  const first = questions[0] as { question?: unknown } | undefined
  return first && typeof first.question === 'string' && first.question.length > 0 ? first.question : ''
}
