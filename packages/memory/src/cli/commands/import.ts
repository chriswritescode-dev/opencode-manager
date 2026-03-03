import { readFileSync } from 'fs'
import { extname } from 'path'
import {
  openDatabase,
  PluginMemory,
  MemoryScope,
} from '../utils'

export interface ImportOptions {
  format?: 'json' | 'markdown'
  projectId: string
  force?: boolean
  dbPath?: string
}

export function parseJsonImport(content: string, projectId: string): PluginMemory[] {
  const data = JSON.parse(content)
  if (!Array.isArray(data)) {
    throw new Error('Invalid JSON format: expected array of memories')
  }

  const now = Date.now()
  return data.map((item: Record<string, unknown>, index: number) => ({
    id: 0,
    projectId: (item.projectId as string) || projectId,
    scope: (item.scope as MemoryScope) || 'context',
    content: item.content as string,
    filePath: (item.filePath as string) || null,
    accessCount: 0,
    lastAccessedAt: null,
    createdAt: (item.createdAt as number) || now,
    updatedAt: (item.updatedAt as number) || now,
  }))
}

export function parseMarkdownImport(content: string, projectId: string): PluginMemory[] {
  const memories: PluginMemory[] = []
  const lines = content.split('\n')
  let currentScope: MemoryScope = 'context'
  let currentContent: string[] = []
  let currentCreatedAt = Date.now()
  let memoryIndex = 0

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
      memoryIndex++
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

function importMemories(filePath: string, options: ImportOptions): void {
  const db = openDatabase(options.dbPath)

  let content: string

  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    console.error(`Failed to read file: ${filePath}`)
    process.exit(1)
  }

  const format = options.format || (extname(filePath).toLowerCase() === '.md' ? 'markdown' : 'json')

  let memories: PluginMemory[]

  try {
    if (format === 'markdown') {
      memories = parseMarkdownImport(content, options.projectId)
    } else {
      memories = parseJsonImport(content, options.projectId)
    }
  } catch (error) {
    console.error(`Failed to parse ${format} file: ${error instanceof Error ? error.message : 'Unknown error'}`)
    process.exit(1)
  }

  if (memories.length === 0) {
    console.log('No memories found to import.')
    process.exit(0)
  }

  try {
    let importedCount = 0
    let skippedCount = 0

    for (const memory of memories) {
      memory.projectId = options.projectId

      if (!options.force) {
        const existing = db
          .prepare('SELECT id FROM memories WHERE project_id = ? AND content = ? LIMIT 1')
          .get(options.projectId, memory.content)

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

function parseArgs(args: string[]): { filePath: string; options: ImportOptions } {
  const options: ImportOptions = { projectId: '' }
  let filePath = args[0]
  let i = 1

  if (!filePath || filePath.startsWith('-')) {
    console.error('Import requires a file path')
    help()
    process.exit(1)
  }

  if (filePath === '-') {
    filePath = '/dev/stdin'
  }

  while (i < args.length) {
    const arg = args[i]

    if (arg === '--format' || arg === '-f') {
      const format = args[++i] as 'json' | 'markdown'
      if (format !== 'json' && format !== 'markdown') {
        console.error(`Unknown format '${format}'. Use 'json' or 'markdown'.`)
        process.exit(1)
      }
      options.format = format
    } else if (arg === '--project' || arg === '-p') {
      options.projectId = args[++i]
    } else if (arg === '--force') {
      options.force = true
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

  return { filePath, options }
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
  --project, -p <id>       Project ID to assign memories to (required, auto-detected from git)
  --force                  Skip duplicate detection and import all memories
  --db-path <path>         Path to database file
  --help, -h               Show this help message
  `.trim())
}

export function run(args: string[], globalOpts: { dbPath?: string; projectId?: string }): void {
  const { filePath, options } = parseArgs(args)
  options.dbPath = options.dbPath || globalOpts.dbPath
  options.projectId = options.projectId || globalOpts.projectId || ''

  if (!options.projectId) {
    console.error('Project ID required. Use --project or ensure this is a git repository.')
    process.exit(1)
  }

  importMemories(filePath, options)
}
