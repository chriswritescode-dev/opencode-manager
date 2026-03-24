import { readFileSync } from 'fs'
import { extname } from 'path'
import {
  openDatabase,
  PluginMemory,
  MemoryScope,
} from '../utils'

export interface ImportArgs {
  dbPath?: string
  resolvedProjectId?: string
  file: string
  format?: 'json' | 'markdown'
  force?: boolean
}

export function parseJsonImport(content: string, projectId: string): PluginMemory[] {
  const data = JSON.parse(content)
  if (!Array.isArray(data)) {
    throw new Error('Invalid JSON format: expected array of memories')
  }

  const now = Date.now()
  return data.map((item: Record<string, unknown>) => {
    if (!item.content || typeof item.content !== 'string') {
      throw new Error('Invalid memory: missing or invalid content field')
    }
    return {
      id: 0,
      projectId: (item.projectId as string) || projectId,
      scope: (item.scope as MemoryScope) || 'context',
      content: item.content as string,
      filePath: (item.filePath as string) || null,
      accessCount: 0,
      lastAccessedAt: null,
      createdAt: (item.createdAt as number) || now,
      updatedAt: (item.updatedAt as number) || now,
    }
  })
}

export function parseMarkdownImport(content: string, projectId: string): PluginMemory[] {
  const memories: PluginMemory[] = []
  const lines = content.split('\n')
  let currentScope: MemoryScope = 'context'
  let currentContent: string[] = []
  let currentCreatedAt = Date.now()

  const scopePattern = /^##\s+(\w+)(?:s)?\s+\(\d+\)$/i
  const memoryPattern = /^###\s+\[(\d+)\]\s+-\s+Created\s+(\d{4}-\d{2}-\d{2})/

  function saveCurrentMemory() {
    if (currentContent.length > 0) {
      const contentStr = currentContent.join('\n').trim()
      if (contentStr) {
        memories.push({
          id: 0,
          projectId,
          scope: currentScope,
          content: contentStr,
          filePath: null,
          accessCount: 0,
          lastAccessedAt: null,
          createdAt: currentCreatedAt,
          updatedAt: currentCreatedAt,
        })
      }
      currentContent = []
    }
  }

  for (const line of lines) {
    const scopeMatch = line.match(scopePattern)
    if (scopeMatch) {
      saveCurrentMemory()
      const scopeStr = scopeMatch[1].toLowerCase()
      if (scopeStr.startsWith('convention')) {
        currentScope = 'convention'
      } else if (scopeStr.startsWith('decision')) {
        currentScope = 'decision'
      } else {
        currentScope = 'context'
      }
      continue
    }

    const memoryMatch = line.match(memoryPattern)
    if (memoryMatch) {
      saveCurrentMemory()
      try {
        currentCreatedAt = new Date(memoryMatch[2]).getTime()
      } catch {
        currentCreatedAt = Date.now()
      }
      continue
    }

    if (line.startsWith('#') && !line.startsWith('##')) {
      continue
    }

    if (line.trim() || currentContent.length > 0) {
      currentContent.push(line)
    }
  }

  saveCurrentMemory()

  if (memories.length === 0 && content.trim()) {
    const fallbackContent = content
      .replace(/^#.*$/gm, '')
      .replace(/^##.*$/gm, '')
      .replace(/^###.*$/gm, '')
      .trim()

    if (fallbackContent) {
      memories.push({
        id: 0,
        projectId,
        scope: 'context',
        content: fallbackContent,
        filePath: null,
        accessCount: 0,
        lastAccessedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
  }

  return memories
}

export function run(argv: ImportArgs): void {
  const projectId = argv.resolvedProjectId

  if (!projectId) {
    console.error('Project ID required. Use --project or ensure this is a git repository.')
    process.exit(1)
  }

  let filePath = argv.file
  if (filePath === '-') filePath = '/dev/stdin'

  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    console.error(`Failed to read file: ${filePath}`)
    process.exit(1)
  }

  const format = argv.format || (extname(filePath).toLowerCase() === '.md' ? 'markdown' : 'json')

  let memories: PluginMemory[]
  try {
    if (format === 'markdown') {
      memories = parseMarkdownImport(content, projectId)
    } else {
      memories = parseJsonImport(content, projectId)
    }
  } catch (error) {
    console.error(`Failed to parse ${format} file: ${error instanceof Error ? error.message : 'Unknown error'}`)
    process.exit(1)
  }

  if (memories.length === 0) {
    console.log('No memories found to import.')
    process.exit(0)
  }

  const db = openDatabase(argv.dbPath)

  try {
    let importedCount = 0
    let skippedCount = 0

    for (const memory of memories) {
      memory.projectId = projectId

      if (!argv.force) {
        const existing = db
          .prepare('SELECT id FROM memories WHERE project_id = ? AND content = ? LIMIT 1')
          .get(projectId, memory.content)

        if (existing) {
          skippedCount++
          continue
        }
      }

      const now = Date.now()
      db.prepare(
        'INSERT INTO memories (project_id, scope, content, file_path, access_count, last_accessed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        memory.projectId,
        memory.scope,
        memory.content,
        memory.filePath,
        0,
        null,
        memory.createdAt || now,
        memory.updatedAt || now
      )

      importedCount++
    }

    console.log(`Import complete: ${importedCount} imported, ${skippedCount} skipped`)
  } finally {
    db.close()
  }
}

export function help(): void {
  console.log(`
Import memories into the database

Usage:
  ocm-mem import <file> [options]

Arguments:
  <file>                   Input file path (use '-' for stdin)

Options:
  --format, -f <format>    Input format: json or markdown (auto-detected from extension)
  --force                  Skip duplicate detection and import all memories
  --db-path <path>         Path to database file
  --help, -h               Show this help message
  `.trim())
}

export function cli(args: string[], globalOpts: { dbPath?: string; resolvedProjectId?: string }): void {
  const filePath = args[0]
  if (!filePath || filePath.startsWith('-') && filePath !== '-') {
    console.error('Import requires a file path')
    help()
    process.exit(1)
  }

  const argv: ImportArgs = {
    dbPath: globalOpts.dbPath,
    resolvedProjectId: globalOpts.resolvedProjectId,
    file: filePath === '-' ? '/dev/stdin' : filePath,
  }

  let i = 1
  while (i < args.length) {
    const arg = args[i]
    if (arg === '--format' || arg === '-f') {
      const format = args[++i] as 'json' | 'markdown'
      if (format !== 'json' && format !== 'markdown') {
        console.error(`Unknown format '${format}'. Use 'json' or 'markdown'.`)
        process.exit(1)
      }
      argv.format = format
    } else if (arg === '--force') {
      argv.force = true
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

  if (!argv.resolvedProjectId) {
    console.error('Project ID required. Use --project or ensure this is a git repository.')
    process.exit(1)
  }

  run(argv)
}
