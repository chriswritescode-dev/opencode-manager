import type { LoopState } from '../../services/loop'
import { openDatabase } from '../utils'
import { formatSessionOutput, formatAuditResult } from '../../utils/loop-format'
import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import { fetchSessionOutput } from '../../services/loop'
import { findPartialMatch, filterByPartial } from '../../utils/partial-match'

interface LoopInfo {
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
  limit?: number
}

export async function run(argv: StatusArgs): Promise<void> {
  const db = openDatabase(argv.dbPath)

  function createStatusClient(serverUrl: string, directory: string) {
    const url = new URL(serverUrl)
    const password = url.password || process.env['OPENCODE_SERVER_PASSWORD']
    const cleanUrl = new URL(url.toString())
    cleanUrl.username = ''
    cleanUrl.password = ''
    const clientConfig: Parameters<typeof createOpencodeClient>[0] = { baseUrl: cleanUrl.toString(), directory }
    if (password) {
      clientConfig.headers = {
        Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
      }
    }
    return createOpencodeClient(clientConfig)
  }

  async function tryFetchSessionOutput(serverUrl: string, sessionId: string, directory: string) {
    try {
      const client = createStatusClient(serverUrl, directory)
      return await fetchSessionOutput(client, sessionId, directory)
    } catch {
      return null
    }
  }

  async function tryFetchSessionStatus(serverUrl: string, sessionId: string, directory: string): Promise<string> {
    try {
      const client = createStatusClient(serverUrl, directory)
      const statusResult = await client.session.status({ directory })
      const statuses = (statusResult.data ?? {}) as Record<string, { type: string; attempt?: number; message?: string; next?: number }>
      const status = statuses[sessionId]
      if (!status) return 'unknown'
      if (status.type === 'retry') {
        return `retry (attempt ${status.attempt}, next in ${Math.round(((status.next ?? 0) - Date.now()) / 1000)}s)`
      }
      return status.type
    } catch {
      return 'unavailable'
    }
  }

  try {
    if (argv.listWorktrees) {
      const rows = db.prepare('SELECT key, data FROM project_kv WHERE key LIKE ? AND expires_at > ?').all('loop:%', Date.now()) as Array<{ key: string; data: string }>
      const states: LoopState[] = []
      for (const row of rows) {
        try {
          const state = JSON.parse(row.data) as LoopState
          states.push(state)
        } catch (err) {
          console.error(`Failed to parse memory state for key ${row.key}:`, err)
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
      params = [projectId, 'loop:%', now]
    } else {
      query = 'SELECT key, data FROM project_kv WHERE key LIKE ? AND expires_at > ?'
      params = ['loop:%', now]
    }

    let rows: Array<{ key: string; data: string }>
    try {
      rows = db.prepare(query).all(...params) as Array<{ key: string; data: string }>
    } catch {
      rows = []
    }

    const activeLoops: LoopInfo[] = []
    const recentLoops: Array<{ state: LoopState; row: { key: string; data: string } }> = []

    for (const row of rows) {
      try {
        const state = JSON.parse(row.data) as LoopState
        if (state.active && state.sessionId && state.worktreeName && state.iteration != null && state.maxIterations != null && state.phase && state.startedAt) {
          activeLoops.push({
            sessionId: state.sessionId,
            worktreeName: state.worktreeName,
            worktreeBranch: state.worktreeBranch,
            iteration: state.iteration,
            maxIterations: state.maxIterations,
            phase: state.phase,
            startedAt: state.startedAt,
            audit: state.audit ?? false,
          })
        } else if (state.completedAt) {
          recentLoops.push({ state, row })
        }
      } catch {}
    }

    const worktreeName = argv.name

    if (worktreeName) {
      type LoopUnion = { type: 'active'; loop: LoopInfo } | { type: 'recent'; loop: typeof recentLoops[number] }
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
        console.error(`Loop not found: ${worktreeName}`)
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
            const state = JSON.parse(r.data) as LoopState
            return state.worktreeName === resolvedWorktreeName
          } catch {
            return false
          }
        })

        if (!row) {
          console.error(`Failed to retrieve state for: ${worktreeName}`)
          process.exit(1)
        }

        const state = JSON.parse(row.data) as LoopState
        const startedAt = state.startedAt!
        const duration = Date.now() - new Date(startedAt).getTime()
        const hours = Math.floor(duration / (1000 * 60 * 60))
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((duration % (1000 * 60)) / 1000)

        console.log('')
        console.log(`Memory Loop: ${state.worktreeName}`)
        console.log(`  Session ID:      ${state.sessionId}`)
        console.log(`  Worktree:        ${state.worktreeName}`)
        if (state.worktreeBranch) {
          console.log(`  Branch:          ${state.worktreeBranch}`)
        }
        console.log(`  Worktree Dir:    ${state.worktreeDir}`)
        if (!state.worktree) {
          console.log(`  Mode:            in-place`)
        }
        console.log(`  Phase:           ${state.phase}`)
        console.log(`  Iteration:       ${state.iteration}/${state.maxIterations}`)
        console.log(`  Duration:        ${hours}h ${minutes}m ${seconds}s`)
        console.log(`  Audit:           ${state.audit ? 'Yes' : 'No'}`)
        console.log(`  Error Count:     ${state.errorCount ?? 0}`)
        console.log(`  Audit Count:     ${state.auditCount ?? 0}`)
        console.log(`  Started:         ${new Date(startedAt).toISOString()}`)
        const sessionStatus = await tryFetchSessionStatus(argv.server ?? 'http://localhost:5551', state.sessionId, state.worktreeDir!)
        console.log(`  Status:          ${sessionStatus}`)
        if (state.completionPromise) {
          console.log(`  Completion:      ${state.completionPromise}`)
        }
        if (state.lastAuditResult) {
          for (const line of formatAuditResult(state.lastAuditResult)) {
            console.log(line)
          }
        }

        const sessionOutput = await tryFetchSessionOutput(argv.server ?? 'http://localhost:5551', state.sessionId, state.worktreeDir!)
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
        const startedAt = state.startedAt!
        const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime()
        const hours = Math.floor(duration / (1000 * 60 * 60))
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((duration % (1000 * 60)) / 1000)

        console.log('')
        console.log(`Memory Loop (Completed): ${state.worktreeName}`)
        console.log(`  Session ID:      ${state.sessionId}`)
        console.log(`  Worktree:        ${state.worktreeName}`)
        if (state.worktreeBranch) {
          console.log(`  Branch:          ${state.worktreeBranch}`)
        }
        console.log(`  Worktree Dir:    ${state.worktreeDir}`)
        if (!state.worktree) {
          console.log(`  Mode:            in-place (completed)`)
        }
        console.log(`  Iteration:       ${state.iteration}/${state.maxIterations}`)
        console.log(`  Duration:        ${hours}h ${minutes}m ${seconds}s`)
        console.log(`  Reason:          ${state.terminationReason ?? 'unknown'}`)
        console.log(`  Started:         ${new Date(startedAt).toISOString()}`)
        console.log(`  Completed:       ${new Date(completedAt).toISOString()}`)
        if (state.lastAuditResult) {
          for (const line of formatAuditResult(state.lastAuditResult)) {
            console.log(line)
          }
        }

        const sessionOutput = await tryFetchSessionOutput(argv.server ?? 'http://localhost:5551', state.sessionId, state.worktreeDir!)
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
        console.log('Active Memory Loops:')
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

        const limit = argv.limit ?? 10
        const displayedLoops = recentLoops.slice(0, limit)
        for (const loop of displayedLoops) {
          const reason = loop.state.terminationReason ?? 'unknown'
          const completed = new Date(loop.state.completedAt!).toLocaleString()

          console.log(`  ${loop.state.worktreeName}`)
          console.log(`    Iterations: ${loop.state.iteration}  Reason: ${reason}  Completed: ${completed}`)
          console.log('')
        }
        
        if (recentLoops.length > limit) {
          console.log(`  ... and ${recentLoops.length - limit} more. Use 'ocm-mem status <name>' for details.`)
          console.log('')
        }
      }

      if (activeLoops.length === 0 && recentLoops.length === 0) {
        console.log('')
        console.log('No memory loops found.')
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
Show memory loop status

Usage:
  ocm-mem status [options]
  ocm-mem status <name> [options]

Arguments:
  name                    Worktree name for detailed status (optional, supports partial matching)

Options:
  --server <url>          OpenCode server URL (default: http://localhost:5551)
  --list-worktrees        List all worktree names (for shell completion)
                          Optionally provide a filter: --list-worktrees <filter>
  --limit <n>             Limit recent loops shown (default: 10)
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
    } else if (arg === '--limit') {
      argv.limit = parseInt(args[++i], 10)
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
