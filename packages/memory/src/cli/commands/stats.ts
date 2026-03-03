import { openDatabase, formatDate, resolveProjectNames, displayProjectId } from '../utils'

interface ScopeStats {
  scope: string
  count: number
}

interface ProjectStats {
  oldest: number
  newest: number
}

interface SessionStats {
  planning: number
  compaction: number
  expired: number
}

function parseArgs(args: string[]): { projectId?: string; dbPath?: string; help?: boolean } {
  const options: { projectId?: string; dbPath?: string; help?: boolean } = {}
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '--project' || arg === '-p') {
      options.projectId = args[++i]
    } else if (arg === '--db-path') {
      options.dbPath = args[++i]
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
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
Show memory statistics for a project

Usage:
  ocm-mem stats [options]

Options:
  --project, -p <id>    Project ID (auto-detected from git if not provided)
  --db-path <path>      Path to memory database
  --help, -h            Show this help message
  `.trim())
}

export function run(args: string[], globalOpts: { dbPath?: string; projectId?: string }): void {
  const options = parseArgs(args)
  const dbPath = options.dbPath || globalOpts.dbPath
  const projectId = options.projectId || globalOpts.projectId

  if (options.help) {
    help()
    process.exit(0)
  }

  if (!projectId) {
    console.error('Project ID required. Use --project or run from a git repository.')
    process.exit(1)
  }

  const finalProjectId = projectId

  const db = openDatabase(dbPath)
  const nameMap = resolveProjectNames()

  try {
    const scopeRows = db.prepare(`
      SELECT scope, COUNT(*) as count FROM memories 
      WHERE project_id = ? GROUP BY scope
    `).all(finalProjectId) as ScopeStats[]

    const statsRow = db.prepare(`
      SELECT MIN(created_at) as oldest, MAX(created_at) as newest
      FROM memories WHERE project_id = ?
    `).get(finalProjectId) as ProjectStats | undefined

    const sessionRows = db.prepare(`
      SELECT 
        SUM(CASE WHEN key LIKE 'session:%' THEN 1 ELSE 0 END) as planning,
        SUM(CASE WHEN key LIKE 'compaction:%' THEN 1 ELSE 0 END) as compaction,
        SUM(CASE WHEN expires_at IS NOT NULL AND expires_at < ? THEN 1 ELSE 0 END) as expired
      FROM session_state WHERE project_id = ?
    `).get(Date.now(), finalProjectId) as SessionStats | undefined

    const totalMemories = scopeRows.reduce((sum, row) => sum + row.count, 0)

    console.log('')
    console.log(`Memory Statistics for: ${displayProjectId(finalProjectId, nameMap)}`)
    console.log(`  Total: ${totalMemories}`)
    console.log('  By scope:')

    const scopeCounts: Record<string, number> = {}
    for (const scope of ['convention', 'decision', 'context'] as const) {
      scopeCounts[scope] = 0
    }
    for (const row of scopeRows) {
      scopeCounts[row.scope] = row.count
    }

    console.log(`    convention: ${scopeCounts['convention']}`)
    console.log(`    decision:   ${scopeCounts['decision']}`)
    console.log(`    context:    ${scopeCounts['context']}`)

    if (statsRow && statsRow.oldest) {
      console.log(`  Oldest: ${formatDate(statsRow.oldest)}`)
      console.log(`  Newest: ${formatDate(statsRow.newest)}`)
    }

    console.log('')
    console.log('Session State:')

    if (sessionRows) {
      console.log(`  Planning states: ${sessionRows.planning || 0}`)
      console.log(`  Compaction snapshots: ${sessionRows.compaction || 0}`)
      console.log(`  Expired (pending cleanup): ${sessionRows.expired || 0}`)
    } else {
      console.log('  None')
    }

    console.log('')
  } finally {
    db.close()
  }
}
