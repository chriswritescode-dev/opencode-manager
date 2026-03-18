import type { RalphState } from '../../services/ralph'
import { openDatabase } from '../utils'

interface RalphLoopInfo {
  sessionId: string
  worktreeName: string
  worktreeBranch: string
  iteration: number
  maxIterations: number
  phase: 'coding' | 'auditing'
  startedAt: string
  audit: boolean
}

function parseArgs(args: string[]): { projectId?: string; dbPath?: string; help?: boolean; worktreeName?: string } {
  const options: { projectId?: string; dbPath?: string; help?: boolean; worktreeName?: string } = {}
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '--project' || arg === '-p') {
      options.projectId = args[++i]
    } else if (arg === '--db-path') {
      options.dbPath = args[++i]
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
Show Ralph loop status

Usage:
  ocm-mem status [options]
  ocm-mem status <name> [options]

Arguments:
  name                  Worktree name for detailed status (optional)

Options:
  --project, -p <id>    Project ID (auto-detected from git if not provided)
  --db-path <path>      Path to memory database
  --help, -h            Show this help message
  `.trim())
}

export function run(args: string[], globalOpts: { dbPath?: string; projectId?: string }): void {
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
      query = 'SELECT key, data FROM project_kv WHERE project_id = ? AND key LIKE ? AND expires_at > ?'
      params = [projectId, 'ralph:%', now]
    } else {
      query = 'SELECT key, data FROM project_kv WHERE key LIKE ? AND expires_at > ?'
      params = ['ralph:%', now]
    }

    let rows: Array<{ key: string; data: string }>
    try {
      rows = db.prepare(query).all(...params) as Array<{ key: string; data: string }>
    } catch {
      rows = []
    }

    const activeLoops: RalphLoopInfo[] = []
    const recentLoops: Array<{ state: RalphState; row: { key: string; data: string } }> = []

    for (const row of rows) {
      try {
        const state = JSON.parse(row.data) as RalphState
        if (state.active) {
          activeLoops.push({
            sessionId: state.sessionId,
            worktreeName: state.worktreeName,
            worktreeBranch: state.worktreeBranch,
            iteration: state.iteration,
            maxIterations: state.maxIterations,
            phase: state.phase,
            startedAt: state.startedAt,
            audit: state.audit,
          })
        } else if (state.completedAt) {
          recentLoops.push({ state, row })
        }
      } catch {}
    }

    const worktreeName = options.worktreeName

    if (worktreeName) {
      let activeLoop = activeLoops.find((l) => l.worktreeName === worktreeName)
      let recentLoop = recentLoops.find((l) => l.state.worktreeName === worktreeName)

      if (!activeLoop && !recentLoop) {
        console.error(`Ralph loop not found: ${worktreeName}`)
        console.error('')
        if (activeLoops.length > 0) {
          console.error('Active loops:')
          for (const l of activeLoops) {
            console.error(`  - ${l.worktreeName}`)
          }
        }
        if (recentLoops.length > 0) {
          console.error('Recently completed:')
          for (const l of recentLoops) {
            console.error(`  - ${l.state.worktreeName}`)
          }
        }
        console.error('')
        process.exit(1)
      }

      if (activeLoop) {
        const row = rows.find((r) => {
          try {
            const state = JSON.parse(r.data) as RalphState
            return state.worktreeName === worktreeName
          } catch {
            return false
          }
        })

        if (!row) {
          console.error(`Failed to retrieve state for: ${worktreeName}`)
          process.exit(1)
        }

        const state = JSON.parse(row.data) as RalphState
        const duration = Date.now() - new Date(state.startedAt).getTime()
        const hours = Math.floor(duration / (1000 * 60 * 60))
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((duration % (1000 * 60)) / 1000)

        console.log('')
        console.log(`Ralph Loop: ${state.worktreeName}`)
        console.log(`  Session ID:      ${state.sessionId}`)
        console.log(`  Worktree:        ${state.worktreeName}`)
        console.log(`  Branch:          ${state.worktreeBranch}`)
        console.log(`  Worktree Dir:    ${state.worktreeDir}`)
        if (state.inPlace) {
          console.log(`  Mode:            in-place`)
        }
        console.log(`  Phase:           ${state.phase}`)
        console.log(`  Iteration:       ${state.iteration}/${state.maxIterations}`)
        console.log(`  Duration:        ${hours}h ${minutes}m ${seconds}s`)
        console.log(`  Audit:           ${state.audit ? 'Yes' : 'No'}`)
        console.log(`  Error Count:     ${state.errorCount}`)
        console.log(`  Clean Audits:    ${state.cleanAuditCount}`)
        console.log(`  Started:         ${new Date(state.startedAt).toISOString()}`)
        if (state.completionPromise) {
          console.log(`  Completion:      ${state.completionPromise}`)
        }
        console.log('')
      } else if (recentLoop) {
        const state = recentLoop.state
        const completedAt = state.completedAt!
        const duration = new Date(completedAt).getTime() - new Date(state.startedAt).getTime()
        const hours = Math.floor(duration / (1000 * 60 * 60))
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((duration % (1000 * 60)) / 1000)

        console.log('')
        console.log(`Ralph Loop (Completed): ${state.worktreeName}`)
        console.log(`  Session ID:      ${state.sessionId}`)
        console.log(`  Worktree:        ${state.worktreeName}`)
        console.log(`  Branch:          ${state.worktreeBranch}`)
        console.log(`  Worktree Dir:    ${state.worktreeDir}`)
        if (state.inPlace) {
          console.log(`  Mode:            in-place (completed)`)
        }
        console.log(`  Iteration:       ${state.iteration}/${state.maxIterations}`)
        console.log(`  Duration:        ${hours}h ${minutes}m ${seconds}s`)
        console.log(`  Reason:          ${state.terminationReason ?? 'unknown'}`)
        console.log(`  Started:         ${new Date(state.startedAt).toISOString()}`)
        console.log(`  Completed:       ${new Date(completedAt).toISOString()}`)
        console.log('')
      }
    } else {
      if (activeLoops.length > 0) {
        console.log('')
        console.log('Active Ralph Loops:')
        console.log('')

        for (const loop of activeLoops) {
          const duration = Date.now() - new Date(loop.startedAt).getTime()
          const hours = Math.floor(duration / (1000 * 60 * 60))
          const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60))
          const durationStr = `${hours}h ${minutes}m`
          const iterStr = `${loop.iteration}/${loop.maxIterations}`
          const audit = loop.audit ? 'Yes' : 'No'

          console.log(`  ${loop.worktreeName}`)
          console.log(`    Phase: ${loop.phase}  Iteration: ${iterStr}  Duration: ${durationStr}  Audit: ${audit}`)
          console.log('')
        }

        console.log(`Total: ${activeLoops.length} active loop(s)`)
        console.log('')
      }

      if (recentLoops.length > 0) {
        console.log('Recently Completed:')
        console.log('')

        for (const loop of recentLoops) {
          const reason = loop.state.terminationReason ?? 'unknown'
          const completed = new Date(loop.state.completedAt!).toLocaleString()

          console.log(`  ${loop.state.worktreeName}`)
          console.log(`    Iterations: ${loop.state.iteration}  Reason: ${reason}  Completed: ${completed}`)
          console.log('')
        }
      }

      if (activeLoops.length === 0 && recentLoops.length === 0) {
        console.log('')
        console.log('No Ralph loops found.')
        console.log('')
      } else {
        console.log("Run 'ocm-mem status <name>' for detailed information.")
        console.log('')
      }
    }
  } finally {
    db.close()
  }
}
