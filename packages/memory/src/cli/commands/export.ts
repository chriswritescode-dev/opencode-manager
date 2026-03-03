import { writeFileSync } from 'fs'
import {
  openDatabase,
  groupBy,
  capitalize,
  PluginMemory,
  MemoryScope,
} from '../utils'

export interface ExportOptions {
  format?: 'json' | 'markdown'
  output?: string
  projectId?: string
  scope?: MemoryScope
  limit?: number
  offset?: number
  dbPath?: string
}

export function formatAsJson(memories: PluginMemory[]): string {
  return JSON.stringify(memories, null, 2)
}

export function formatAsMarkdown(memories: PluginMemory[]): string {
  const byScope = groupBy(memories, (m) => m.scope)
  const lines = [
    '# Memory Export',
    '',
    `Exported on ${new Date().toISOString().split('T')[0]}`,
    '',
  ]

  for (const scope of ['convention', 'decision', 'context'] as const) {
    const items = byScope[scope] || []
    if (items.length === 0) continue

    lines.push(`## ${capitalize(scope)}s (${items.length})`, '')

    for (const m of items) {
      lines.push(
        `### [${m.id}] - Created ${new Date(m.createdAt).toISOString().split('T')[0]}`,
        '',
        m.content,
        ''
      )
    }
  }

  return lines.join('\n')
}

function exportMemories(options: ExportOptions): void {
  const db = openDatabase(options.dbPath)

  try {
    if (!options.projectId) {
      console.error('Project ID required. Use --project or ensure this is a git repository.')
      process.exit(1)
    }

    const projectId = options.projectId

    const conditions: string[] = ['project_id = ?']
    const params: (string | number)[] = [projectId]

    if (options.scope) {
      conditions.push('scope = ?')
      params.push(options.scope)
    }

    const limit = options.limit ?? 1000
    const offset = options.offset ?? 0

    const query = `
      SELECT id, project_id, scope, content, file_path, access_count, last_accessed_at, created_at, updated_at
      FROM memories
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `

    const rows = db.prepare(query).all(...params, limit, offset) as Array<{
      id: number
      project_id: string
      scope: string
      content: string
      file_path: string | null
      access_count: number
      last_accessed_at: number | null
      created_at: number
      updated_at: number
    }>

    const memories: PluginMemory[] = rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      scope: row.scope as MemoryScope,
      content: row.content,
      filePath: row.file_path,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    const format = options.format || 'json'
    let output: string

    if (format === 'markdown') {
      output = formatAsMarkdown(memories)
    } else {
      output = formatAsJson(memories)
    }

    if (options.output) {
      writeFileSync(options.output, output, 'utf-8')
      console.log(`Exported ${memories.length} memories to ${options.output}`)
    } else {
      console.log(output)
    }
  } finally {
    db.close()
  }
}

function parseArgs(args: string[]): ExportOptions {
  const options: ExportOptions = {}
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '--format' || arg === '-f') {
      const format = args[++i] as 'json' | 'markdown'
      if (format !== 'json' && format !== 'markdown') {
        console.error(`Unknown format '${format}'. Use 'json' or 'markdown'.`)
        process.exit(1)
      }
      options.format = format
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i]
    } else if (arg === '--project' || arg === '-p') {
      options.projectId = args[++i]
    } else if (arg === '--scope' || arg === '-s') {
      const scope = args[++i] as MemoryScope
      if (scope !== 'convention' && scope !== 'decision' && scope !== 'context') {
        console.error(`Unknown scope '${scope}'. Use 'convention', 'decision', or 'context'.`)
        process.exit(1)
      }
      options.scope = scope
    } else if (arg === '--limit' || arg === '-l') {
      options.limit = parseInt(args[++i], 10)
      if (isNaN(options.limit)) {
        console.error('Invalid limit value')
        process.exit(1)
      }
    } else if (arg === '--offset') {
      options.offset = parseInt(args[++i], 10)
      if (isNaN(options.offset ?? 0)) {
        console.error('Invalid offset value')
        process.exit(1)
      }
    } else if (arg === '--db-path') {
      options.dbPath = args[++i]
    } else if (arg === '--help' || arg === '-h') {
      help()
      process.exit(0)
    } else {
      console.error(`Unknown option: ${arg}`)
      help()
      process.exit(1)
    }

    i++
  }

  return options
}

export function help(): void {
  console.log(`
Export memories from the database

Usage:
  ocm-mem export [options]

Options:
  --format, -f <format>    Output format: json or markdown (default: json)
  --output, -o <file>      Output file path (prints to stdout if not specified)
  --project, -p <id>       Project ID to filter by (auto-detected from git if not provided)
  --scope, -s <scope>      Filter by scope: convention, decision, or context
  --limit, -l <n>          Limit number of memories (default: 1000)
  --offset <n>             Offset for pagination (default: 0)
  --db-path <path>         Path to database file
  --help, -h               Show this help message
  `.trim())
}

export function run(args: string[], globalOpts: { dbPath?: string; projectId?: string }): void {
  const options = parseArgs(args)
  options.dbPath = options.dbPath || globalOpts.dbPath
  options.projectId = options.projectId || globalOpts.projectId

  exportMemories(options)
}
