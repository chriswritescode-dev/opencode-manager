import type { LoopState } from '../../services/loop'
import { openDatabase, confirm } from '../utils'
import { execSync, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { findPartialMatch } from '../../utils/partial-match'

export interface CancelArgs {
  dbPath?: string
  resolvedProjectId?: string
  name?: string
  cleanup?: boolean
  force?: boolean
}

export async function run(argv: CancelArgs): Promise<void> {
  const db = openDatabase(argv.dbPath)

  try {
    const projectId = argv.resolvedProjectId

    const now = Date.now()
    let query: string
    let params: (string | number)[]

    if (projectId) {
      query = 'SELECT project_id, key, data FROM project_kv WHERE project_id = ? AND key LIKE ? AND expires_at > ?'
      params = [projectId, 'loop:%', now]
    } else {
      query = 'SELECT project_id, key, data FROM project_kv WHERE key LIKE ? AND expires_at > ?'
      params = ['loop:%', now]
    }

    let rows: Array<{ project_id: string; key: string; data: string }>
    try {
      rows = db.prepare(query).all(...params) as Array<{ project_id: string; key: string; data: string }>
    } catch {
      rows = []
    }

    if (rows.length === 0) {
      console.log('')
      console.log('No active memory loops.')
      console.log('')
      return
    }

    const loops: Array<{ state: LoopState; row: { project_id: string; key: string; data: string } }> = []

    for (const row of rows) {
      try {
        const state = JSON.parse(row.data) as LoopState
        if (state.active) {
          loops.push({ state, row })
        }
      } catch (err) {
        console.error(`Failed to parse memory state for key ${row.key}:`, err)
      }
    }

    if (loops.length === 0) {
      console.log('')
      console.log('No active memory loops.')
      console.log('')
      return
    }

    let loopToCancel: { state: LoopState; row: { project_id: string; key: string; data: string } } | undefined

    if (argv.name) {
      const { match, candidates } = findPartialMatch(argv.name, loops, (l) => [
        l.state.worktreeName,
        l.state.worktreeBranch,
      ])

      if (!match && candidates.length > 0) {
        console.error(`Multiple loops match '${argv.name}':`)
        for (const c of candidates) {
          console.error(`  - ${c.state.worktreeName}`)
        }
        console.error('')
        process.exit(1)
      }

      if (!match && candidates.length === 0) {
        console.error(`Memory loop not found: ${argv.name}`)
        console.error('')
        console.error('Active loops:')
        for (const l of loops) {
          console.error(`  - ${l.state.worktreeName}`)
        }
        console.error('')
        process.exit(1)
      }

      loopToCancel = match!
    } else {
      if (loops.length === 1) {
        loopToCancel = loops[0]
      } else {
        console.log('')
        console.log('Multiple active memory loops. Please specify which one to cancel:')
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
    console.log(`Memory Loop to Cancel:`)
    console.log(`  Worktree:  ${state.worktreeName}`)
    console.log(`  Session:   ${state.sessionId}`)
    console.log(`  Iteration: ${state.iteration}/${state.maxIterations}`)
    console.log(`  Phase:     ${state.phase}`)
    if (argv.cleanup) {
      console.log(`  Worktree:  ${state.worktreeDir} (will be removed)`)
    }
    console.log('')

    const shouldProceed = argv.force || await confirm(`Cancel memory loop '${state.worktreeName}'`)

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

    console.log(`Cancelled memory loop: ${state.worktreeName}`)

    if (argv.cleanup && state.worktreeDir && state.worktree) {
      if (existsSync(state.worktreeDir)) {
        try {
          const gitCommonDir = execSync('git rev-parse --git-common-dir', { cwd: state.worktreeDir, encoding: 'utf-8' }).trim()
          const gitRoot = resolve(state.worktreeDir, gitCommonDir, '..')
          const removeResult = spawnSync('git', ['worktree', 'remove', '-f', state.worktreeDir], { cwd: gitRoot, encoding: 'utf-8' })
          if (removeResult.status !== 0) {
            throw new Error(removeResult.stderr || 'git worktree remove failed')
          }
          console.log(`Removed worktree: ${state.worktreeDir}`)
        } catch {
          console.error(`Failed to remove worktree: ${state.worktreeDir}`)
          console.error('You may need to remove it manually.')
        }
      }
    }

    console.log('')
  } finally {
    db.close()
  }
}

export function help(): void {
  console.log(`
Cancel a memory loop

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

export async function cli(args: string[], globalOpts: { dbPath?: string; resolvedProjectId?: string }): Promise<void> {
  const argv: CancelArgs = {
    dbPath: globalOpts.dbPath,
    resolvedProjectId: globalOpts.resolvedProjectId,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg === '--cleanup') {
      argv.cleanup = true
    } else if (arg === '--force') {
      argv.force = true
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
