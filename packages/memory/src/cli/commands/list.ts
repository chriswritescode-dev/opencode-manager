import { openDatabase, formatDate, resolveProjectNames, displayProjectId } from '../utils'

interface ProjectMemoryStats {
  project_id: string
  count: number
  oldest: number
  newest: number
}

interface ProjectSessionStats {
  project_id: string
  count: number
  oldest: number
  newest: number
}

function parseArgs(args: string[]): { dbPath?: string; help?: boolean } {
  const options: { dbPath?: string; help?: boolean } = {}
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '--db-path') {
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
List projects with memory and session state counts

Usage:
  ocm-mem list [options]

Options:
  --db-path <path>    Path to memory database
  --help, -h          Show this help message
  `.trim())
}

export function run(args: string[], globalOpts: { dbPath?: string; projectId?: string }): void {
  const options = parseArgs(args)
  options.dbPath = options.dbPath || globalOpts.dbPath

  if (options.help) {
    help()
    process.exit(0)
  }

  const db = openDatabase(options.dbPath)
  const nameMap = resolveProjectNames()

  try {
    const memoryRows = db.prepare(`
      SELECT project_id, COUNT(*) as count, 
             MIN(created_at) as oldest, MAX(created_at) as newest
      FROM memories GROUP BY project_id ORDER BY count DESC
    `).all() as ProjectMemoryStats[]

    const sessionRows = db.prepare(`
      SELECT project_id, COUNT(*) as count,
             MIN(created_at) as oldest, MAX(updated_at) as newest
      FROM session_state GROUP BY project_id ORDER BY count DESC
    `).all() as ProjectSessionStats[]

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

    if (sessionRows.length > 0) {
      console.log('Session states:')
      console.log('  PROJECT              SESSIONS   OLDEST         NEWEST')

      for (const row of sessionRows) {
        const name = displayProjectId(row.project_id, nameMap).padEnd(19)
        const count = String(row.count).padEnd(9)
        const oldest = formatDate(row.oldest)
        const newest = formatDate(row.newest)
        console.log(`  ${name}   ${count}  ${oldest}     ${newest}`)
      }
    } else {
      console.log('No session states found.')
    }

    console.log('')
  } finally {
    db.close()
  }
}
