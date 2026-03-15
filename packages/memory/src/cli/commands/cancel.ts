import type { RalphState } from '../../services/ralph'
import { openDatabase, confirm } from '../utils'
import { execSync } from 'child_process'
import { existsSync } from 'fs'

interface CancelOptions {
  projectId?: string
  dbPath?: string
  cleanup?: boolean
  force?: boolean
  help?: boolean
}

function parseArgs(args: string[]): CancelOptions & { worktreeName?: string } {
  const options: CancelOptions & { worktreeName?: string } = {}
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '--project' || arg === '-p') {
      options.projectId = args[++i]
    } else if (arg === '--db-path') {
      options.dbPath = args[++i]
    } else if (arg === '--cleanup') {
      options.cleanup = true
    } else if (arg === '--force') {
      options.force = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (!arg.startsWith('-')) {
      options.worktreeName = arg
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
Cancel a Ralph loop

Usage:
  ocm-mem cancel [name] [options]

Arguments:
  name                  Worktree name to cancel (optional if only one active)

Options:
  --cleanup             Remove worktree directory after cancellation
  --force               Skip confirmation prompt
  --project, -p <id>    Project ID (auto-detected from git if not provided)
  --db-path <path>      Path to memory database
  --help, -h            Show this help message
  `.trim())
}

export async function run(args: string[], globalOpts: { dbPath?: string; projectId?: string }): Promise<void> {
  const options = parseArgs(args)
  options.projectId = options.projectId || globalOpts.projectId
  options.dbPath = options.dbPath || globalOpts.dbPath

  if (options.help) {
    help()
    process.exit(0)
  }

  const db = openDatabase(options.dbPath)

  try {
    const projectId = options.projectId

    const now = Date.now()
    let query: string
    let params: (string | number)[]

    if (projectId) {
      query = 'SELECT project_id, key, data FROM project_kv WHERE project_id = ? AND key LIKE ? AND expires_at > ?'
      params = [projectId, 'ralph:%', now]
    } else {
      query = 'SELECT project_id, key, data FROM project_kv WHERE key LIKE ? AND expires_at > ?'
      params = ['ralph:%', now]
    }

    let rows: Array<{ project_id: string; key: string; data: string }>
    try {
      rows = db.prepare(query).all(...params) as Array<{ project_id: string; key: string; data: string }>
    } catch {
      rows = []
    }

    if (rows.length === 0) {
      console.log('')
      console.log('No active Ralph loops.')
      console.log('')
      return
    }

    const loops: Array<{ state: RalphState; row: { project_id: string; key: string; data: string } }> = []

    for (const row of rows) {
      try {
        const state = JSON.parse(row.data) as RalphState
        if (state.active) {
          loops.push({ state, row })
        }
      } catch {}
    }

    if (loops.length === 0) {
      console.log('')
      console.log('No active Ralph loops.')
      console.log('')
      return
    }

    let loopToCancel: { state: RalphState; row: { project_id: string; key: string; data: string } } | undefined

    if (options.worktreeName) {
      loopToCancel = loops.find((l) => l.state.worktreeName === options.worktreeName)

      if (!loopToCancel) {
        console.error(`Ralph loop not found: ${options.worktreeName}`)
        console.error('')
        console.error('Active loops:')
        for (const l of loops) {
          console.error(`  - ${l.state.worktreeName}`)
        }
        console.error('')
        process.exit(1)
      }
    } else {
      if (loops.length === 1) {
        loopToCancel = loops[0]
      } else {
        console.log('')
        console.log('Multiple active Ralph loops. Please specify which one to cancel:')
        console.log('')
        for (const l of loops) {
          console.log(`  - ${l.state.worktreeName}`)
        }
        console.log('')
        console.log("Run 'ocm-mem cancel <name>' to cancel a specific loop.")
        console.log('')
        process.exit(1)
      }
    }

    if (!loopToCancel) {
      console.error('Internal error: loop not found')
      process.exit(1)
    }

    const { state } = loopToCancel

    console.log('')
    console.log(`Ralph Loop to Cancel:`)
    console.log(`  Worktree:  ${state.worktreeName}`)
    console.log(`  Session:   ${state.sessionId}`)
    console.log(`  Iteration: ${state.iteration}/${state.maxIterations}`)
    console.log(`  Phase:     ${state.phase}`)
    if (options.cleanup) {
      console.log(`  Worktree:  ${state.worktreeDir} (will be removed)`)
    }
    console.log('')

    await runCancel(db, loopToCancel, options)
  } finally {
    db.close()
  }
}

async function runCancel(
  db: ReturnType<typeof openDatabase>,
  loopToCancel: { state: RalphState; row: { project_id: string; key: string; data: string } },
  options: CancelOptions & { worktreeName?: string },
): Promise<void> {
  const { state } = loopToCancel

  const shouldProceed = options.force || await confirm(`Cancel Ralph loop '${state.worktreeName}'`)

  if (!shouldProceed) {
    console.log('Cancelled.')
    return
  }

  const updatedState = {
    ...state,
    active: false,
    completedAt: new Date().toISOString(),
    terminationReason: 'cancelled',
  }
  db.prepare('UPDATE project_kv SET data = ?, updated_at = ? WHERE project_id = ? AND key = ?').run(
    JSON.stringify(updatedState),
    Date.now(),
    loopToCancel.row.project_id,
    loopToCancel.row.key,
  )

  console.log(`Cancelled Ralph loop: ${state.worktreeName}`)

  if (options.cleanup && state.worktreeDir && !state.inPlace) {
    if (existsSync(state.worktreeDir)) {
      try {
        const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim()
        execSync(`git worktree remove -f "${state.worktreeDir}"`, { encoding: 'utf-8', cwd: gitRoot })
        console.log(`Removed worktree: ${state.worktreeDir}`)
      } catch {
        console.error(`Failed to remove worktree: ${state.worktreeDir}`)
        console.error('You may need to remove it manually.')
      }
    }
  }

  console.log('')
}
