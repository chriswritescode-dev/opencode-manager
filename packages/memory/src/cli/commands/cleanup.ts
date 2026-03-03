import { openDatabase, formatDate, truncate, confirm, resolveProjectNames, displayProjectId, MemoryScope } from '../utils'

interface CleanupOptions {
  olderThan?: number
  ids?: number[]
  scope?: MemoryScope
  sessions?: boolean
  all?: boolean
  dryRun?: boolean
  force?: boolean
  projectId?: string
  dbPath?: string
  help?: boolean
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
    } else if (arg === '--sessions') {
      options.sessions = true
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

Options:
  --older-than <days>   Delete memories older than N days
  --ids <id,id,...>     Delete specific memory IDs
  --scope <scope>       Filter by scope (convention, decision, context)
  --sessions            Clean up session states instead of memories
  --all                 Delete all memories for the project (requires --project)
  --dry-run             Preview what would be deleted without deleting
  --force               Skip confirmation prompt
  --project, -p <id>    Project ID (auto-detected from git if not provided)
  --db-path <path>      Path to memory database
  --help, -h            Show this help message
  `.trim())
}

export function run(args: string[], globalOpts: { dbPath?: string; projectId?: string }): void {
  const options = parseArgs(args)
  options.projectId = options.projectId || globalOpts.projectId

  if (options.help) {
    help()
    process.exit(0)
  }

  if (!options.olderThan && !options.ids && !options.sessions && !options.all) {
    console.error('At least one filter must be provided: --older-than, --ids, --sessions, or --all')
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
    if (options.sessions) {
      runSessionCleanup(db, options)
    } else {
      runMemoryCleanup(db, options)
    }
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

async function runSessionCleanup(db: ReturnType<typeof openDatabase>, options: CleanupOptions): Promise<void> {
  const projectId = options.projectId!
  const nameMap = resolveProjectNames()
  let query = 'SELECT key, project_id, expires_at, created_at, updated_at FROM session_state WHERE project_id = ?'
  const params: (string | number)[] = [projectId]

  if (options.olderThan) {
    const cutoffTime = Date.now() - options.olderThan * 24 * 60 * 60 * 1000
    query += ' AND created_at < ?'
    params.push(cutoffTime)
  }

  if (options.all) {
    query = 'SELECT key, project_id, expires_at, created_at, updated_at FROM session_state WHERE project_id = ?'
    params.length = 0
    params.push(projectId)
  }

  const rows = db.prepare(query).all(...params) as Array<{
    key: string
    project_id: string
    expires_at: number | null
    created_at: number
    updated_at: number
  }>

  if (rows.length === 0) {
    console.log('No session states found to delete.')
    return
  }

  console.log('')
  console.log(`Found ${rows.length} session states to delete:`)
  console.log('  KEY                                    PROJECT        CREATED      EXPIRED')

  const displayRows = rows.slice(0, 20)
  for (const row of displayRows) {
    const key = truncate(row.key, 38).padEnd(40)
    const project = displayProjectId(row.project_id, nameMap).padEnd(14)
    const created = formatDate(row.created_at)
    const expired = row.expires_at ? formatDate(row.expires_at) : '-'
    console.log(`  ${key}  ${project}  ${created}  ${expired}`)
  }

  if (rows.length > 20) {
    console.log(`  ... and ${rows.length - 20} more`)
  }

  console.log('')

  if (options.dryRun) {
    console.log('Dry run - no session states deleted.')
    return
  }

  const shouldProceed = options.force || (await confirm(`Delete ${rows.length} session states`))

  if (!shouldProceed) {
    console.log('Cancelled.')
    return
  }

  const keysToDelete = rows.map((r) => r.key)
  const deleteQuery = `DELETE FROM session_state WHERE key IN (${keysToDelete.map(() => '?').join(',')})`
  db.prepare(deleteQuery).run(...keysToDelete)

  console.log(`Deleted ${rows.length} session states.`)
}
