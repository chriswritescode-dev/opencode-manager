import { openDatabase, formatDate, resolveProjectNames, displayProjectId } from '../utils'

interface ScopeStats {
  scope: string
  count: number
}

interface ProjectStats {
  oldest: number
  newest: number
}

export interface StatsArgs {
  dbPath?: string
  resolvedProjectId?: string
}

export function run(argv: StatsArgs): void {
  const projectId = argv.resolvedProjectId

  if (!projectId) {
    console.error('Project ID required. Use --project or run from a git repository.')
    process.exit(1)
  }

  const db = openDatabase(argv.dbPath)
  const nameMap = resolveProjectNames()

  try {
    const scopeRows = db.prepare(`
      SELECT scope, COUNT(*) as count FROM memories 
      WHERE project_id = ? GROUP BY scope
    `).all(projectId) as ScopeStats[]

    const statsRow = db.prepare(`
      SELECT MIN(created_at) as oldest, MAX(created_at) as newest
      FROM memories WHERE project_id = ?
    `).get(projectId) as ProjectStats | undefined

    const totalMemories = scopeRows.reduce((sum, row) => sum + row.count, 0)

    console.log('')
    console.log(`Memory Statistics for: ${displayProjectId(projectId, nameMap)}`)
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
  } finally {
    db.close()
  }
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

export function cli(args: string[], globalOpts: { dbPath?: string; resolvedProjectId?: string }): void {
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      help()
      process.exit(0)
    }
  }

  run({ dbPath: globalOpts.dbPath, resolvedProjectId: globalOpts.resolvedProjectId })
}
