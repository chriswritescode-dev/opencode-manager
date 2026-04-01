import { openDatabase, formatDate, resolveProjectNames, displayProjectId } from '../utils'

interface ProjectMemoryStats {
  project_id: string
  count: number
  oldest: number
  newest: number
}

export interface ListArgs {
  dbPath?: string
}

export function run(argv: ListArgs): void {
  const db = openDatabase(argv.dbPath)
  const nameMap = resolveProjectNames()

  try {
    const memoryRows = db.prepare(`
      SELECT project_id, COUNT(*) as count, 
             MIN(created_at) as oldest, MAX(created_at) as newest
      FROM memories GROUP BY project_id ORDER BY count DESC
    `).all() as ProjectMemoryStats[]

    console.log('')

    if (memoryRows.length > 0) {
      console.log('Projects with memories:')
      console.log('  PROJECT              MEMORIES   OLDEST         NEWEST')

      for (const row of memoryRows) {
        const name = displayProjectId(row.project_id, nameMap).padEnd(19)
        const count = String(row.count).padEnd(9)
        const oldest = formatDate(row.oldest)
        const newest = formatDate(row.newest)
        console.log(`  ${name}   ${count}  ${oldest}     ${newest}`)
      }
    } else {
      console.log('No memories found.')
    }

    console.log('')
  } finally {
    db.close()
  }
}

export function help(): void {
  console.log(`
List projects with memory counts

Usage:
  ocm-mem list [options]

Options:
  --db-path <path>    Path to memory database
  --help, -h          Show this help message
  `.trim())
}

export function cli(args: string[], globalOpts: { dbPath?: string; resolvedProjectId?: string }): void {
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      help()
      process.exit(0)
    }
  }

  run({ dbPath: globalOpts.dbPath })
}
