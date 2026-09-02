import type { TuiPluginApi } from './tui-types.js'
import { readInstallNotice, readState } from './state.js'
import { getToken } from './internal-token-store.js'
import { TokenStoreError } from './token-store.js'
import { fetchRepos, toRemoteRepoSummaries } from './manager-repos.js'
import { ManagerApi, ManagerApiError } from './manager-api.js'
import type { MirrorTargetPlanResponse } from '@opencode-manager/shared/schemas'
import { prepareMirror, checkPushDivergence, describePushDivergence, mirrorUpFast, pickMatchedRepo } from './mirror.js'
import type { MirrorPlan, RemoteRepoSummary } from './mirror.js'
import { getBranchName } from './local-repo.js'
import { transferSession, moveReminderText } from './session-move.js'
import { createManagerReplay, createManagerPromptAsync } from './remote-replay.js'
import { readSessionEvents } from './local-history.js'
import { confirmDialog, selectDialog } from './tui-dialogs.js'
import { setPendingWarp, runPendingWarp } from './warp.js'
import { pushPhaseProgress, replayProgress } from './move-progress.js'
import type { MoveProgress } from './move-progress.js'

export type MoveProgressSetter = (progress: MoveProgress | null) => void

export async function setupOcm(api: TuiPluginApi, setMoveProgress: MoveProgressSetter): Promise<void> {
  showInstallNotice(api)
  api.keymap.registerLayer({
    commands: [
      {
        name: 'ocm.session.move',
        title: 'Move session to Manager',
        desc: 'Push repo state and move this session to OpenCode Manager',
        category: 'OpenCode Manager',
        namespace: 'palette',
        slashName: 'ocm-move',
        run: () => runSessionMove(api, setMoveProgress),
      },
    ],
  })
  api.lifecycle.onDispose(() => runPendingWarp())
}

function showInstallNotice(api: TuiPluginApi): void {
  const notice = readInstallNotice()
  if (!notice) return

  api.ui.toast({
    variant: 'success',
    title: 'ocm installed',
    message: notice.pathMissing
      ? `Linked at ${notice.link}. Add export PATH="$HOME/.local/bin:$PATH" to your shell rc if ocm is unavailable.`
      : `Linked at ${notice.link}`,
    duration: 10000,
  })
}

async function describeRemoteDiscard(repoRoot: string, managerApi: ManagerApi, repoId: number): Promise<string[]> {
  try {
    return describePushDivergence(await checkPushDivergence(repoRoot, managerApi, repoId))
  } catch (error) {
    if (error instanceof ManagerApiError && error.status === 404) return []
    throw error
  }
}

function describeMoveTarget(repoName: string, target: MirrorTargetPlanResponse): string {
  switch (target.kind) {
    case 'in-place':
      return `Replace the repo state of ${repoName} (${target.fullPath}) with your local working tree and move this session there?`
    case 'existing':
      return `${repoName} is checked out on ${target.currentBranch ?? 'another branch'}; branch ${target.branch} lives in worktree ${target.localPath} (${target.fullPath}).\n\nReplace that worktree with your local working tree and move this session there?`
    case 'new':
      return `${repoName} is checked out on ${target.currentBranch ?? 'another branch'}; it will not be touched.\n\nCreate worktree ${target.localPath} (${target.fullPath}) for branch ${target.branch}, push your local working tree there, and move this session?`
  }
}

function moveConfirmMessage(repoName: string, target: MirrorTargetPlanResponse, discardReasons: string[]): string {
  const base = describeMoveTarget(repoName, target)
  if (discardReasons.length === 0) return base
  return `${base}\n\nThis discards server-side work:\n${discardReasons.map((r) => `  - ${r}`).join('\n')}`
}

async function resolveMoveTarget(managerApi: ManagerApi, matched: RemoteRepoSummary, remoteDirectory: string, localBranch: string | null): Promise<MirrorTargetPlanResponse> {
  if (!localBranch) {
    return { kind: 'in-place', repoId: matched.repoId, fullPath: remoteDirectory, localPath: remoteDirectory, branch: '', currentBranch: null }
  }
  return managerApi.mirrorTargetPlan(matched.repoId, localBranch)
}

async function runSessionMove(api: TuiPluginApi, setMoveProgress: MoveProgressSetter): Promise<void> {
  try {
    const current = api.route.current
    if (current.name !== 'session' || !current.params) {
      api.ui.toast({ variant: 'error', message: 'Not in a session' })
      return
    }
    const sessionID = String(current.params.sessionID)

    const session = api.state.session.get(sessionID)
    if (!session?.directory) {
      api.ui.toast({ variant: 'error', message: 'Session has no directory' })
      return
    }

    const state = readState()
    if (!state?.managerUrl) {
      api.ui.toast({ variant: 'error', message: 'No manager configured. Run `ocm login <url>` first.' })
      return
    }

    let token: string | null
    try {
      token = await getToken(state.managerUrl)
    } catch (err) {
      const reason = err instanceof TokenStoreError ? err.message : String(err)
      api.ui.toast({ variant: 'error', message: `Token store unavailable: ${reason}` })
      return
    }
    if (!token) {
      api.ui.toast({ variant: 'error', message: `No token stored. Run \`ocm login ${state.managerUrl}\`.` })
      return
    }

    const repos = await fetchRepos(state.managerUrl, token)
    const plan = await prepareMirror(session.directory, toRemoteRepoSummaries(repos))

    if (plan.matched.length === 0) {
      api.ui.toast({ variant: 'error', message: 'No matching Manager repo; run `ocm push --create` first' })
      return
    }

    const localBranch = getBranchName(plan.repoRoot)
    const matched = pickMatchedRepo(plan.matched, localBranch)
      ?? await selectDialog(api, 'Move session to Manager repo', plan.matched.map((r) => ({ title: r.name, description: `id=${r.repoId} branch=${r.branch ?? '-'}`, value: r })))
    if (!matched) return
    const matchedRepoId = matched.repoId
    const remoteRepo = repos.find((r) => r.repoId === matchedRepoId)!

    const managerApi = new ManagerApi(state.managerUrl, token)
    const target = await resolveMoveTarget(managerApi, matched, remoteRepo.directory, localBranch)
    const discardReasons = target.repoId === null ? [] : await describeRemoteDiscard(plan.repoRoot, managerApi, target.repoId)

    const proceed = await confirmDialog(api, {
      title: 'Move session to Manager',
      message: moveConfirmMessage(matched.name, target, discardReasons),
    })
    if (!proceed) return

    let targetRepoId = target.repoId
    if (targetRepoId === null) {
      setMoveProgress({ label: `creating worktree ${target.localPath}`, fraction: null })
      targetRepoId = (await managerApi.mirrorEnsureTarget(matched.repoId, target.branch)).repoId
    }
    const selectedPlan: MirrorPlan = { ...plan, matched: [{ ...matched, repoId: targetRepoId }] }
    const pushed = await mirrorUpFast(selectedPlan, {
      api: managerApi,
      force: true,
      requireCurrentBranch: true,
      onPhase: (phase) => setMoveProgress(pushPhaseProgress(phase)),
    })
    const remoteDirectory = pushed.fullPath

    const result = await transferSession(
      { sessionID, localRoot: plan.repoRoot, remoteDirectory },
      {
        fetchLocalHistory: () => readSessionEvents(sessionID),
        replayEvents: createManagerReplay(state.managerUrl, token),
        onProgress: (replayed, total) => setMoveProgress(replayProgress(replayed, total)),
      },
    )

    switch (result.kind) {
      case 'moved': {
        setMoveProgress({ label: 'notifying moved session', fraction: null })
        await createManagerPromptAsync(state.managerUrl, token)(remoteDirectory, result.sessionID, moveReminderText(remoteDirectory)).catch(() => undefined)
        setMoveProgress(null)
        const warp = await confirmDialog(api, { title: 'Attach to moved session?', message: 'Exit this TUI and attach to the moved session on the Manager now?' })
        if (warp) {
          await fetch(`${state.managerUrl}/api/opencode-proxy/session?directory=${encodeURIComponent(remoteDirectory)}`, { headers: { authorization: `Bearer ${token}` } }).catch(() => undefined)
          setPendingWarp({ managerUrl: state.managerUrl, token, directory: remoteDirectory, sessionID: result.sessionID, repoName: matched.name })
          api.keymap.dispatchCommand('app.exit')
          return
        }
        api.ui.toast({ variant: 'success', message: `Session moved to Manager (${result.replayedEvents} events). Local copy kept — run \`ocm\` to attach.` })
        break
      }
      case 'not-found':
        api.ui.toast({ variant: 'error', message: 'No durable history found for this session' })
        break
      case 'corrupt-history':
        api.ui.toast({ variant: 'error', message: `Session history has a gap at sequence ${result.missingSeq}` })
        break
      case 'replay-failed':
        api.ui.toast({ variant: 'error', message: `Replay failed: ${result.message}` })
        break
    }
  } catch (err) {
    api.ui.toast({ variant: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    setMoveProgress(null)
  }
}

export { readRemoteContext } from './remote-context.js'
