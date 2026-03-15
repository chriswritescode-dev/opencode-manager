import { openDatabase, formatDate, truncate, confirm, resolveProjectNames, displayProjectId, MemoryScope } from '../utils'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir, platform } from 'os'
import { execSync } from 'child_process'
import { createConnection } from 'net'

interface CleanupOptions {
  olderThan?: number
  ids?: number[]
  scope?: MemoryScope
  all?: boolean
  dryRun?: boolean
  force?: boolean
  projectId?: string
  dbPath?: string
  help?: boolean
  vecWorkers?: boolean
}

function parseArgs(args: string[]): CleanupOptions {
  const options: CleanupOptions = {}
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '--older-than') {
      options.olderThan = parseInt(args[++i], 10)
      if (isNaN(options.olderThan)) {
        console.error('Invalid --older-than value')
        process.exit(1)
      }
    } else if (arg === '--ids') {
      const idsStr = args[++i]
      options.ids = idsStr.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id))
      if (options.ids.length === 0) {
        console.error('Invalid --ids value')
        process.exit(1)
      }
    } else if (arg === '--scope') {
      const scope = args[++i] as MemoryScope
      if (scope !== 'convention' && scope !== 'decision' && scope !== 'context') {
        console.error(`Unknown scope '${scope}'. Use 'convention', 'decision', or 'context'.`)
        process.exit(1)
      }
      options.scope = scope
    } else if (arg === '--all') {
      options.all = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--force') {
      options.force = true
    } else if (arg === '--project' || arg === '-p') {
      options.projectId = args[++i]
    } else if (arg === '--db-path') {
      options.dbPath = args[++i]
    } else if (arg === '--vec-workers') {
      options.vecWorkers = true
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
Delete memories by criteria

Usage:
  ocm-mem cleanup [options]
  ocm-mem cleanup --vec-workers

Options:
  --older-than <days>   Delete memories older than N days
  --ids <id,id,...>     Delete specific memory IDs
  --scope <scope>       Filter by scope (convention, decision, context)
  --all                 Delete all memories for the project (requires --project)
  --dry-run             Preview what would be deleted without deleting
  --force               Skip confirmation prompt
  --project, -p <id>    Project ID (auto-detected from git if not provided)
  --db-path <path>      Path to memory database
  --vec-workers         Clean up orphaned vec-worker processes
  --help, -h            Show this help message
  `.trim())
}

export async function run(args: string[], globalOpts: { dbPath?: string; projectId?: string }): Promise<void> {
  const options = parseArgs(args)
  options.projectId = options.projectId || globalOpts.projectId

  if (options.help) {
    help()
    process.exit(0)
  }

  if (options.vecWorkers) {
    const result = await cleanupVecWorkers()
    console.log(result)
    return
  }

  if (!options.olderThan && !options.ids && !options.all) {
    console.error('At least one filter must be provided: --older-than, --ids, or --all')
    help()
    process.exit(1)
  }

  if (options.all && !options.projectId) {
    console.error('--all requires --project to be specified')
    process.exit(1)
  }

  if (!options.projectId) {
    console.error('Project ID required. Use --project or run from a git repository.')
    process.exit(1)
  }

  const db = openDatabase(options.dbPath || globalOpts.dbPath)

  try {
    runMemoryCleanup(db, options)
  } finally {
    db.close()
  }
}

async function runMemoryCleanup(db: ReturnType<typeof openDatabase>, options: CleanupOptions): Promise<void> {
  const projectId = options.projectId!
  let query = 'SELECT id, project_id, scope, content, created_at FROM memories WHERE project_id = ?'
  const params: (string | number)[] = [projectId]

  if (options.olderThan) {
    const cutoffTime = Date.now() - options.olderThan * 24 * 60 * 60 * 1000
    query += ' AND created_at < ?'
    params.push(cutoffTime)
  }

  if (options.ids && options.ids.length > 0) {
    query += ` AND id IN (${options.ids.map(() => '?').join(',')})`
    params.push(...options.ids)
  }

  if (options.scope) {
    query += ' AND scope = ?'
    params.push(options.scope)
  }

  if (options.all) {
    query = 'SELECT id, project_id, scope, content, created_at FROM memories WHERE project_id = ?'
    params.length = 0
    params.push(projectId)
  }

  const rows = db.prepare(query).all(...params) as Array<{
    id: number
    project_id: string
    scope: string
    content: string
    created_at: number
  }>

  if (rows.length === 0) {
    console.log('No memories found to delete.')
    return
  }

  console.log('')
  console.log(`Found ${rows.length} memories to delete:`)
  console.log('  ID    SCOPE        CREATED      CONTENT')

  const displayRows = rows.slice(0, 20)
  for (const row of displayRows) {
    const id = String(row.id).padEnd(6)
    const scope = row.scope.padEnd(12)
    const created = formatDate(row.created_at)
    const content = truncate(row.content, 40)
    console.log(`  ${id}  ${scope}  ${created}  ${content}`)
  }

  if (rows.length > 20) {
    console.log(`  ... and ${rows.length - 20} more`)
  }

  console.log('')

  if (options.dryRun) {
    console.log('Dry run - no memories deleted.')
    return
  }

  const shouldProceed = options.force || await confirm(`Delete ${rows.length} memories`)

  if (!shouldProceed) {
    console.log('Cancelled.')
    return
  }

  const idsToDelete = rows.map((r) => r.id)
  const deleteQuery = `DELETE FROM memories WHERE id IN (${idsToDelete.map(() => '?').join(',')})`
  db.prepare(deleteQuery).run(...idsToDelete)

  const remainingCount = db.prepare('SELECT COUNT(*) as count FROM memories WHERE project_id = ?').get(projectId) as { count: number }

  console.log(`Deleted ${rows.length} memories. ${remainingCount.count} remaining.`)
  console.log("Note: Run 'memory-health reindex' in OpenCode to clean up orphaned embeddings.")
}

export async function cleanupVecWorkers(): Promise<string> {
  const workers = findVecWorkers()
  const defaultDataDir = getDefaultDataDir()
  
  if (workers.length === 0) {
    return 'No vec-worker processes found.'
  }
  
  const results: string[] = []
  let cleaned = 0
  
  for (const worker of workers) {
    const isDefault = worker.dbPath.startsWith(defaultDataDir)
    const isHealthy = await isWorkerHealthy(worker.pid, worker.socketPath)
    
    if (isHealthy) {
      results.push(`✓ PID ${worker.pid} - healthy (data dir: ${isDefault ? 'global' : 'workspace'})`)
    } else {
      try {
        process.kill(worker.pid, 'SIGTERM')
        results.push(`✗ PID ${worker.pid} - terminated (was orphaned)`)
        cleaned++
      } catch (err) {
        results.push(`✗ PID ${worker.pid} - failed to terminate`)
      }
    }
  }
  
  return `Vec-worker cleanup complete:\n${results.join('\n')}\n\nTerminated ${cleaned} orphaned worker(s).`
}

function getDefaultDataDir(): string {
  const defaultBase = join(homedir(), platform() === 'win32' ? 'AppData' : '.local', 'share')
  const xdgDataHome = process.env['XDG_DATA_HOME'] || defaultBase
  return join(xdgDataHome, 'opencode', 'memory')
}

function findVecWorkers(): Array<{ pid: number; dbPath: string; socketPath: string }> {
  const workers: Array<{ pid: number; dbPath: string; socketPath: string }> = []
  
  try {
    const output = execSync('ps aux | grep vec-worker | grep -v grep', { encoding: 'utf-8' })
    const lines = output.split('\n').filter(line => line.trim())
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      const pid = parseInt(parts[1], 10)
      
      const dbMatch = line.match(/--db\s+([^\s]+)/)
      const socketMatch = line.match(/--socket\s+([^\s]+)/)
      
      if (dbMatch && socketMatch && !isNaN(pid)) {
        workers.push({
          pid,
          dbPath: dbMatch[1],
          socketPath: socketMatch[1],
        })
      }
    }
  } catch {
  }
  
  return workers
}

async function isWorkerHealthy(pid: number, socketPath: string): Promise<boolean> {
  if (!existsSync(socketPath)) return false
  try {
    process.kill(pid, 0)
    return new Promise((resolve) => {
      const client = createConnection({ path: socketPath })
      const timeout = setTimeout(() => {
        client.destroy()
        resolve(false)
      }, 2000)
      
      client.on('connect', () => {
        client.write(JSON.stringify({ action: 'health' }) + '\n')
      })
      
      client.on('data', (chunk) => {
        clearTimeout(timeout)
        client.destroy()
        try {
          const response = JSON.parse(chunk.toString())
          resolve(response.status === 'ok')
        } catch {
          resolve(false)
        }
      })
      
      client.on('error', () => {
        clearTimeout(timeout)
        resolve(false)
      })
    })
  } catch {
    return false
  }
}
