import { openDatabase, formatDate, truncate, confirm } from '../utils'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir, platform } from 'os'
import { execSync } from 'child_process'
import { createConnection } from 'net'

export interface CleanupArgs {
  dbPath?: string
  resolvedProjectId?: string
  olderThan?: number
  ids?: string
  scope?: 'convention' | 'decision' | 'context'
  all?: boolean
  dryRun?: boolean
  force?: boolean
  vecWorkers?: boolean
}

export async function run(argv: CleanupArgs): Promise<void> {
  if (argv.vecWorkers) {
    const result = await cleanupVecWorkers()
    console.log(result)
    return
  }

  if (!argv.olderThan && !argv.ids && !argv.all) {
    console.error('At least one filter must be provided: --older-than, --ids, or --all')
    process.exit(1)
  }

  const projectId = argv.resolvedProjectId

  if (argv.all && !projectId) {
    console.error('--all requires --project to be specified')
    process.exit(1)
  }

  if (!projectId) {
    console.error('Project ID required. Use --project or run from a git repository.')
    process.exit(1)
  }

  const db = openDatabase(argv.dbPath)

  try {
    let query = 'SELECT id, project_id, scope, content, created_at FROM memories WHERE project_id = ?'
    const params: (string | number)[] = [projectId]

    if (argv.olderThan) {
      const cutoffTime = Date.now() - argv.olderThan * 24 * 60 * 60 * 1000
      query += ' AND created_at < ?'
      params.push(cutoffTime)
    }

    if (argv.ids) {
      const parsedIds = argv.ids.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id))
      if (parsedIds.length === 0) {
        console.error('Invalid --ids value')
        process.exit(1)
      }
      query += ` AND id IN (${parsedIds.map(() => '?').join(',')})`
      params.push(...parsedIds)
    }

    if (argv.scope) {
      query += ' AND scope = ?'
      params.push(argv.scope)
    }

    if (argv.all) {
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

    if (argv.dryRun) {
      console.log('Dry run - no memories deleted.')
      return
    }

    const shouldProceed = argv.force || await confirm(`Delete ${rows.length} memories`)

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
  } finally {
    db.close()
  }
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
  --vec-workers         Clean up orphaned vec-worker processes
  --help, -h            Show this help message
  `.trim())
}

export async function cli(args: string[], globalOpts: { dbPath?: string; resolvedProjectId?: string }): Promise<void> {
  const argv: CleanupArgs = {
    dbPath: globalOpts.dbPath,
    resolvedProjectId: globalOpts.resolvedProjectId,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg === '--older-than') {
      argv.olderThan = parseInt(args[++i], 10)
      if (isNaN(argv.olderThan)) {
        console.error('Invalid --older-than value')
        process.exit(1)
      }
    } else if (arg === '--ids') {
      argv.ids = args[++i]
    } else if (arg === '--scope') {
      const scope = args[++i] as 'convention' | 'decision' | 'context'
      if (scope !== 'convention' && scope !== 'decision' && scope !== 'context') {
        console.error(`Unknown scope '${scope}'. Use 'convention', 'decision', or 'context'.`)
        process.exit(1)
      }
      argv.scope = scope
    } else if (arg === '--all') {
      argv.all = true
    } else if (arg === '--dry-run') {
      argv.dryRun = true
    } else if (arg === '--force') {
      argv.force = true
    } else if (arg === '--vec-workers') {
      argv.vecWorkers = true
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

  await run(argv)
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
      } catch {
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
