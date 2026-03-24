import { Database } from 'bun:sqlite'
import { existsSync, readFileSync } from 'fs'
import { homedir, platform } from 'os'
import { join, basename } from 'path'
import { execSync } from 'child_process'
import { createInterface } from 'readline'

export type MemoryScope = 'convention' | 'decision' | 'context'

export interface PluginMemory {
  id: number
  projectId: string
  scope: MemoryScope
  content: string
  filePath: string | null
  accessCount: number
  lastAccessedAt: number | null
  createdAt: number
  updatedAt: number
}

export function resolveDefaultDbPath(): string {
  const localPath = join(process.cwd(), '.opencode', 'state', 'opencode', 'memory', 'memory.db')
  if (existsSync(localPath)) {
    return localPath
  }

  const defaultBase = join(homedir(), platform() === 'win32' ? 'AppData' : '.local', 'share')
  const xdgDataHome = process.env['XDG_DATA_HOME'] || defaultBase
  const dataDir = join(xdgDataHome, 'opencode', 'memory')
  return join(dataDir, 'memory.db')
}

export function getGitProjectId(dir?: string): string | null {
  try {
    const execOpts = dir ? { encoding: 'utf-8' as const, cwd: dir } : { encoding: 'utf-8' as const }
    const repoRoot = execSync('git rev-parse --show-toplevel', execOpts).trim()
    if (!repoRoot) return null

    const cacheFile = join(repoRoot, '.git', 'opencode')
    if (existsSync(cacheFile)) {
      const cachedId = readFileSync(cacheFile, 'utf-8').trim()
      if (cachedId) return cachedId
    }

    const output = execSync('git rev-list --max-parents=0 --all', execOpts).trim()
    if (!output) return null

    const commits = output.split('\n').filter(Boolean).sort()
    return commits[0] || null
  } catch {
    return null
  }
}

export function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const key = keyFn(item)
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {} as Record<string, T[]>)
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function openDatabase(dbPath?: string): Database {
  const resolvedPath = dbPath || resolveDefaultDbPath()

  if (!existsSync(resolvedPath)) {
    console.error(`Database not found at ${resolvedPath}. Run OpenCode first to initialize memories.`)
    process.exit(1)
  }

  return new Database(resolvedPath)
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().split('T')[0]
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    rl.question(`${message} (y/n): `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}


export function resolveProjectNames(): Map<string, string> {
  const nameMap = new Map<string, string>()

  try {
    const defaultBase = join(homedir(), platform() === 'win32' ? 'AppData' : '.local', 'share')
    const xdgDataHome = process.env['XDG_DATA_HOME'] || defaultBase
    const opencodePath = join(xdgDataHome, 'opencode', 'opencode.db')

    if (!existsSync(opencodePath)) return nameMap

    const db = new Database(opencodePath, { readonly: true })

    try {
      const rows = db.prepare('SELECT id, worktree FROM project').all() as Array<{ id: string; worktree: string }>

      for (const row of rows) {
        nameMap.set(row.id, basename(row.worktree))
      }
    } finally {
      db.close()
    }
  } catch {
    // opencode.db may not exist or have different schema — graceful fallback
  }

  return nameMap
}

export function resolveProjectIdByName(name: string): string | null {
  try {
    const defaultBase = join(homedir(), platform() === 'win32' ? 'AppData' : '.local', 'share')
    const xdgDataHome = process.env['XDG_DATA_HOME'] || defaultBase
    const opencodePath = join(xdgDataHome, 'opencode', 'opencode.db')

    if (!existsSync(opencodePath)) return null

    const db = new Database(opencodePath, { readonly: true })

    try {
      const rows = db.prepare('SELECT id, worktree FROM project').all() as Array<{ id: string; worktree: string }>

      for (const row of rows) {
        if (basename(row.worktree) === name) return row.id
      }
    } finally {
      db.close()
    }
  } catch {
    return null
  }

  return null
}

export function displayProjectId(id: string, nameMap: Map<string, string>): string {
  return nameMap.get(id) || id
}

export interface GlobalOptions {
  dbPath?: string
  projectId?: string
  dir?: string
  help?: boolean
}

export interface ParsedGlobalOptions {
  globalOpts: GlobalOptions
  remainingArgs: string[]
}

export function parseGlobalOptions(args: string[]): ParsedGlobalOptions {
  const globalOpts: GlobalOptions = {}
  const remainingArgs: string[] = []

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '--db-path') {
      globalOpts.dbPath = args[++i]
    } else if (arg === '--project' || arg === '-p') {
      globalOpts.projectId = args[++i]
    } else if (arg === '--dir' || arg === '-d') {
      globalOpts.dir = args[++i]
    } else if (arg === '--help' || arg === '-h') {
      globalOpts.help = true
    } else {
      remainingArgs.push(arg)
    }

    i++
  }

  return { globalOpts, remainingArgs }
}
