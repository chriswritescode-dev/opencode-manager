import type { RalphState } from '../../services/ralph'
import { openDatabase } from '../utils'
import { formatSessionOutput, formatAuditResult } from '../../utils/ralph-format'
import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import { fetchSessionOutput } from '../../services/ralph'
import { findPartialMatch, filterByPartial } from '../../utils/partial-match'

interface RalphLoopInfo {
  sessionId: string
  worktreeName: string
  worktreeBranch?: string
  iteration: number
  maxIterations: number
  phase: 'coding' | 'auditing'
  startedAt: string
  audit: boolean
}

export interface StatusArgs {
  dbPath?: string
  resolvedProjectId?: string
  name?: string
  server?: string
  listWorktrees?: boolean
  listWorktreesFilter?: string
}

export async function run(argv: StatusArgs): Promise<void> {
  const db = openDatabase(argv.dbPath)

  async function tryFetchSessionOutput(serverUrl: string, sessionId: string, directory: string) {
    try {
      const client = createOpencodeClient({ baseUrl: serverUrl, directory })
      return await fetchSessionOutput(client, sessionId, directory)
    } catch {
      return null
    }
  }

  try {
    if (argv.listWorktrees) {
      const rows = db.prepare('SELECT key, data FROM project_kv WHERE key LIKE ? AND expires_at > ?').all('ralph:%', Date.now()) as Array<{ key: string; data: string }>
      const states: RalphState[] = []
      for (const row of rows) {
        try {
          const state = JSON.parse(row.data) as RalphState
          states.push(state)
        } catch {
        }
      }
      const filtered = filterByPartial(argv.listWorktreesFilter, states, (s) => [s.worktreeName, s.worktreeBranch])
      for (const state of filtered) {
        console.log(state.worktreeName)
      }
      db.close()
      return
    }

    const projectId = argv.resolvedProjectId

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

    const worktreeName = argv.name

    if (worktreeName) {
      type LoopUnion = { type: 'active'; loop: RalphLoopInfo } | { type: 'recent'; loop: typeof recentLoops[number] }
      const allLoops: LoopUnion[] = [
        ...activeLoops.map((l) => ({ type: 'active' as const, loop: l })),
        ...recentLoops.map((l) => ({ type: 'recent' as const, loop: l })),
      ]

      const { match, candidates } = findPartialMatch(worktreeName, allLoops, (l) => [
        l.type === 'active' ? l.loop.worktreeName : l.loop.state.worktreeName,
        l.type === 'active' ? l.loop.worktreeBranch : l.loop.state.worktreeBranch,
      ])

      if (!match && candidates.length > 0) {
        console.error(`Multiple loops match '${worktreeName}':`)
        for (const c of candidates) {
          const name = c.type === 'active' ? c.loop.worktreeName : c.loop.state.worktreeName
          console.error(`  - ${name}`)
        }
        console.error('')
        process.exit(1)
      }

      if (!match && candidates.length === 0) {
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

      const matchedLoop = match!
      const resolvedWorktreeName = matchedLoop.type === 'active'
        ? matchedLoop.loop.worktreeName
        : matchedLoop.loop.state.worktreeName

      if (matchedLoop.type === 'active') {
        const row = rows.find((r) => {
          try {
            const state = JSON.parse(r.data) as RalphState
            return state.worktreeName === resolvedWorktreeName
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
        if (state.worktreeBranch) {
          console.log(`  Branch:          ${state.worktreeBranch}`)
        }
        console.log(`  Worktree Dir:    ${state.worktreeDir}`)
        if (state.inPlace) {
          console.log(`  Mode:            in-place`)
        }
        console.log(`  Phase:           ${state.phase}`)
        console.log(`  Iteration:       ${state.iteration}/${state.maxIterations}`)
        console.log(`  Duration:        ${hours}h ${minutes}m ${seconds}s`)
        console.log(`  Audit:           ${state.audit ? 'Yes' : 'No'}`)
        console.log(`  Error Count:     ${state.errorCount}`)
        console.log(`  Audit Count:     ${state.auditCount}`)
        console.log(`  Started:         ${new Date(state.startedAt).toISOString()}`)
        if (state.completionPromise) {
          console.log(`  Completion:      ${state.completionPromise}`)
        }
        if (state.lastAuditResult) {
          for (const line of formatAuditResult(state.lastAuditResult)) {
            console.log(line)
          }
        }

        const sessionOutput = await tryFetchSessionOutput(argv.server ?? 'http://localhost:5551', state.sessionId, state.worktreeDir)
        if (sessionOutput) {
          console.log('Session Output:')
          for (const line of formatSessionOutput(sessionOutput)) {
            console.log(line)
          }
          console.log('')
        }
      } else {
        const state = matchedLoop.loop.state
        const completedAt = state.completedAt!
        const duration = new Date(completedAt).getTime() - new Date(state.startedAt).getTime()
        const hours = Math.floor(duration / (1000 * 60 * 60))
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((duration % (1000 * 60)) / 1000)

        console.log('')
        console.log(`Ralph Loop (Completed): ${state.worktreeName}`)
        console.log(`  Session ID:      ${state.sessionId}`)
        console.log(`  Worktree:        ${state.worktreeName}`)
        if (state.worktreeBranch) {
          console.log(`  Branch:          ${state.worktreeBranch}`)
        }
        console.log(`  Worktree Dir:    ${state.worktreeDir}`)
        if (state.inPlace) {
          console.log(`  Mode:            in-place (completed)`)
        }
        console.log(`  Iteration:       ${state.iteration}/${state.maxIterations}`)
        console.log(`  Duration:        ${hours}h ${minutes}m ${seconds}s`)
        console.log(`  Reason:          ${state.terminationReason ?? 'unknown'}`)
        console.log(`  Started:         ${new Date(state.startedAt).toISOString()}`)
        console.log(`  Completed:       ${new Date(completedAt).toISOString()}`)
        if (state.lastAuditResult) {
          for (const line of formatAuditResult(state.lastAuditResult)) {
            console.log(line)
          }
        }

        const sessionOutput = await tryFetchSessionOutput(argv.server ?? 'http://localhost:5551', state.sessionId, state.worktreeDir)
        if (sessionOutput) {
          console.log('Session Output:')
          for (const line of formatSessionOutput(sessionOutput)) {
            console.log(line)
          }
          console.log('')
        }
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

export function help(): void {
  console.log(`
Show Ralph loop status

Usage:
  ocm-mem status [options]
  ocm-mem status <name> [options]

Arguments:
  name                    Worktree name for detailed status (optional, supports partial matching)

Options:
  --server <url>          OpenCode server URL (default: http://localhost:5551)
  --list-worktrees        List all worktree names (for shell completion)
                          Optionally provide a filter: --list-worktrees <filter>
  --project, -p <id>      Project ID (auto-detected from git if not provided)
  --db-path <path>        Path to memory database
  --help, -h              Show this help message
  `.trim())
}

export async function cli(args: string[], globalOpts: { dbPath?: string; resolvedProjectId?: string }): Promise<void> {
  const argv: StatusArgs = {
    dbPath: globalOpts.dbPath,
    resolvedProjectId: globalOpts.resolvedProjectId,
    server: 'http://localhost:5551',
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg === '--server') {
      argv.server = args[++i]
    } else if (arg === '--list-worktrees') {
      argv.listWorktrees = true
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        argv.listWorktreesFilter = args[++i]
      }
    } else if (arg === '--help' || arg === '-h') {
      help()
      process.exit(0)
    } else if (!arg.startsWith('-')) {
      argv.name = arg
    } else {
      console.error(`Unknown option: ${arg}`)
      help()
      process.exit(1)
    }
    i++
  }

  await run(argv)
}
