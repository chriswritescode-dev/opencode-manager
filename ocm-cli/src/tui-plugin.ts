import type { Context } from '@opencode/plugin/tui/context'
import { readInstallNotice } from './state.js'
import { resolveManagerAuth } from './manager-auth.js'
import { fetchRepos, toRemoteRepoSummaries } from './manager-repos.js'
import { ManagerApi } from './manager-api.js'
import { prepareMirror, mirrorUpFast, pickMatchedRepo, chooseMoveDestination } from './mirror.js'
import type { MirrorPlan, MoveDestination } from './mirror.js'
import { getBranchName } from './local-repo.js'
import { transferSession, moveReminderText } from './session-move.js'
import { createManagerSessionTransfer } from './remote-session.js'
import type { ManagerSessionTransfer } from './remote-session.js'
import { confirmDialog, requireSessionTarget, selectDialog } from './tui-dialogs.js'
import { setPendingWarp, runPendingWarp } from './warp.js'
import { pushPhaseProgress, importProgress } from './move-progress.js'
import { warmRepoProxy } from './repo-proxy.js'
import type { MoveProgress } from './move-progress.js'
import { GOAL_COMMAND, runGoalCommand } from './tui-goal.js'
import type { GoalDialogProps } from './tui-goal.js'
import { MULTI_RUN_COMMAND, runMultiRunCommand } from './tui-multi-run.js'
import type { MultiRunLaunchDialogProps, MultiRunsDialogProps } from './tui-multi-run.js'
import { runOcmSwitch } from './tui-ocm.js'
import type { GoalStore } from './goal-store.js'
import type { RemoteContext } from './remote-context.js'

export type MoveProgressSetter = (progress: MoveProgress | null) => void

export type OcmDialogs = {
  goal: (props: GoalDialogProps) => void
  multiRunLaunch: (props: MultiRunLaunchDialogProps) => void
  multiRuns: (props: MultiRunsDialogProps) => void
}

export type OcmFeatures = {
  remote: RemoteContext | undefined
  goals: GoalStore | undefined
  dialogs: OcmDialogs
}

export async function setupOcm(context: Context, setMoveProgress: MoveProgressSetter, features: OcmFeatures): Promise<() => void> {
  showInstallNotice(context)
  context.ui.slot({
    append: 'app',
    render: () => {
      context.keymap.layer(() => ({
        mode: 'global',
        commands: [
          {
            id: 'ocm.session.move',
            title: 'Move session to Manager',
            description: 'Push repo state and move this session to OpenCode Manager',
            group: 'OpenCode Manager',
            palette: true,
            slash: { name: 'ocm-move' },
            run: () => runSessionMove(context, setMoveProgress),
          },
          {
            id: 'ocm.switch',
            title: 'Switch server',
            description: 'Attach this TUI to an OpenCode Manager repo, or go back to local opencode',
            group: 'OpenCode Manager',
            palette: true,
            slash: { name: 'ocm' },
            run: () => runOcmSwitch(context, { remote: features.remote }),
          },
          {
            id: 'ocm.goal',
            title: 'Goal',
            description: 'Start, pause, resume, or cancel a Manager goal for this session',
            group: 'OpenCode Manager',
            palette: true,
            slash: { name: GOAL_COMMAND, arguments: true },
            run: (input) =>
              runGoalCommand(context, { remote: features.remote, store: features.goals, showDialog: features.dialogs.goal }, input),
          },
          {
            id: 'ocm.multirun',
            title: 'Multi-run',
            description: 'Run one prompt across several models on OpenCode Manager',
            group: 'OpenCode Manager',
            palette: true,
            slash: { name: MULTI_RUN_COMMAND, arguments: true },
            run: (input) =>
              runMultiRunCommand(
                context,
                {
                  remote: features.remote,
                  showLaunchDialog: features.dialogs.multiRunLaunch,
                  showRunsDialog: features.dialogs.multiRuns,
                },
                input,
              ),
          },
        ],
      }))
      return null
    },
  })
  return () => runPendingWarp()
}

function showInstallNotice(context: Context): void {
  const notice = readInstallNotice()
  if (!notice) return

  context.ui.toast.show({
    variant: 'success',
    title: 'ocm installed',
    message: notice.pathMissing
      ? `Linked at ${notice.link}. Add export PATH="$HOME/.local/bin:$PATH" to your shell rc if ocm is unavailable.`
      : `Linked at ${notice.link}`,
    duration: 10000,
  })
}

async function describeMoveBlocker(transfer: ManagerSessionTransfer, sessionID: string, parentID: string | undefined): Promise<string | null> {
  if (await transfer.sessionExists(sessionID)) {
    return `Session ${sessionID} is already on the Manager, so it cannot be moved again. Nothing was pushed. Run \`ocm\` to attach to it.`
  }
  if (parentID && !(await transfer.sessionExists(parentID))) {
    return `This is a subagent session and its parent ${parentID} is not on the Manager. Move the parent session first. Nothing was pushed.`
  }
  return null
}

function moveConfirmMessage(repoName: string, destination: MoveDestination, localBranch: string): string {
  switch (destination.kind) {
    case 'in-place':
      return `Replace the repo state of ${repoName} (${destination.directory}) with your local working tree and move this session there?`
    case 'existing-worktree':
      return `${repoName} is checked out on another branch; branch ${destination.branch} lives in worktree ${destination.directory}.\n\nReplace that worktree with your local working tree and move this session there?`
    case 'new-worktree': {
      const reasons = destination.reasons.length > 0
        ? `\n\nThe server checkout was not used because:\n${destination.reasons.map((r) => `  - ${r}`).join('\n')}`
        : ''
      const suffix = destination.branch !== localBranch
        ? `\n\n${localBranch} is checked out on the server, so ${destination.branch} is used instead.`
        : ''
      return `The ${repoName} server checkout will not be touched.${reasons}\n\nCreate a new OpenCode worktree for branch ${destination.branch}, push your local working tree there, and move this session?${suffix}`
    }
  }
}

async function runSessionMove(context: Context, setMoveProgress: MoveProgressSetter): Promise<void> {
  try {
    const sessionTarget = requireSessionTarget(context)
    if (!sessionTarget) return
    const { sessionID, directory, session } = sessionTarget

    const auth = await resolveManagerAuth()
    if (!auth.ok) {
      context.ui.toast.show({ variant: 'error', message: auth.message })
      return
    }

    const repos = await fetchRepos(auth.managerUrl, auth.token)
    const plan = await prepareMirror(directory, toRemoteRepoSummaries(repos))

    if (plan.matched.length === 0) {
      context.ui.toast.show({ variant: 'error', message: 'No matching Manager repo; run `ocm push --create` first' })
      return
    }

    const localBranch = getBranchName(plan.repoRoot)
    if (!localBranch) {
      context.ui.toast.show({ variant: 'error', message: 'Check out a branch before moving; a detached HEAD cannot be moved.' })
      return
    }
    const matched = pickMatchedRepo(plan.matched, localBranch)
      ?? await selectDialog(context, 'Move session to Manager repo', plan.matched.map((r) => ({ title: r.name, description: `id=${r.repoId} branch=${r.branch ?? '-'}`, value: r })))
    if (!matched) return
    const matchedRepoId = matched.repoId

    await warmRepoProxy(auth.managerUrl, auth.token, matchedRepoId)

    const transfer = createManagerSessionTransfer(auth.managerUrl, auth.token)
    const blocker = await describeMoveBlocker(transfer, sessionID, session.parentID)
    if (blocker) {
      context.ui.toast.show({ variant: 'error', message: blocker })
      return
    }

    const managerApi = new ManagerApi(auth.managerUrl, auth.token)
    const target = await managerApi.mirrorMoveTarget(matched.repoId, localBranch)
    const destination = chooseMoveDestination(plan.repoRoot, localBranch, target)

    const proceed = await confirmDialog(context, {
      title: 'Move session to Manager',
      message: moveConfirmMessage(matched.name, destination, localBranch),
    })
    if (!proceed) return

    let pushDirectory: string | undefined
    let pushTargetBranch: string | undefined
    if (destination.kind === 'new-worktree') {
      setMoveProgress({ label: `creating worktree ${destination.branch}`, fraction: null })
      const worktree = await managerApi.mirrorCreateWorktree(matched.repoId, destination.branch)
      pushDirectory = worktree.directory
      pushTargetBranch = destination.branch
    } else if (destination.kind === 'existing-worktree') {
      pushDirectory = destination.directory ?? undefined
    }

    const selectedPlan: MirrorPlan = { ...plan, matched: [matched] }
    const pushed = await mirrorUpFast(selectedPlan, {
      api: managerApi,
      force: true,
      requireCurrentBranch: destination.kind !== 'new-worktree',
      directory: pushDirectory,
      targetBranch: pushTargetBranch,
      onPhase: (phase) => setMoveProgress(pushPhaseProgress(phase)),
    })
    const remoteDirectory = pushed.fullPath

    const result = await transferSession(
      { sessionID, localRoot: plan.repoRoot, remoteDirectory },
      {
        exportSession: (id) => context.client.session.export({ sessionID: id }),
        importSession: transfer.importSession,
        onProgress: (transferred, total) => setMoveProgress(importProgress(transferred, total)),
      },
    )

    switch (result.kind) {
      case 'moved': {
        setMoveProgress({ label: 'notifying moved session', fraction: null })
        await transfer.addReminder(result.sessionID, moveReminderText(remoteDirectory)).catch(() => undefined)
        setMoveProgress(null)
        const warp = await confirmDialog(context, { title: 'Attach to moved session?', message: 'Exit this TUI and attach to the moved session on the Manager now?' })
        if (warp) {
          await warmRepoProxy(auth.managerUrl, auth.token, matched.repoId)
          setPendingWarp({
            kind: 'attach',
            target: { managerUrl: auth.managerUrl, token: auth.token, repoId: matched.repoId, sessionID: result.sessionID, repoName: matched.name },
          })
          context.keymap.dispatch('app.exit')
          return
        }
        context.ui.toast.show({ variant: 'success', message: `Session moved to Manager (${result.importedMessages} messages). Local copy kept — run \`ocm\` to attach.` })
        break
      }
      case 'import-failed':
        context.ui.toast.show({ variant: 'error', message: `Session import failed: ${result.message}` })
        break
    }
  } catch (err) {
    context.ui.toast.show({ variant: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    setMoveProgress(null)
  }
}
