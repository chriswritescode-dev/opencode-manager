import type { TuiPluginApi } from './tui-types.js'
import { readInstallNotice, readState } from './state.js'
import { getToken } from './keychain.js'
import { fetchRepos, toRemoteRepoSummaries } from './manager-repos.js'
import { ManagerApi, ManagerApiError } from './manager-api.js'
import { prepareMirror, checkPushDivergence, mirrorUpFast } from './mirror.js'
import type { MirrorPlan, MirrorUpFastPhase } from './mirror.js'
import { formatBytes } from './progress.js'
import { transferSession, moveReminderText } from './session-move.js'
import { createManagerReplay, createManagerPromptAsync } from './remote-replay.js'
import { readSessionEvents } from './local-history.js'
import { confirmDialog, selectDialog } from './tui-dialogs.js'
import { setPendingWarp, runPendingWarp } from './warp.js'

export async function setupOcm(api: TuiPluginApi): Promise<void> {
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
        run: () => runSessionMove(api),
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

function pushPhaseMessage(phase: MirrorUpFastPhase): string {
  switch (phase.kind) {
    case 'bundling':
      return 'Pushing repo state: creating git bundle…'
    case 'uploading':
      return `Pushing repo state: uploading ${formatBytes(phase.bytesSent)} / ${formatBytes(phase.totalBytes)}…`
    case 'processing':
      return 'Pushing repo state: waiting for server to import bundle…'
    case 'patching':
      return 'Pushing repo state: applying local changes…'
  }
}

function createPushPhaseToaster(api: TuiPluginApi): (phase: MirrorUpFastPhase) => void {
  let lastUploadToastAt = 0
  return (phase) => {
    if (phase.kind === 'uploading') {
      const now = Date.now()
      if (now - lastUploadToastAt < 1000) return
      lastUploadToastAt = now
    }
    api.ui.toast({ message: pushPhaseMessage(phase) })
  }
}

async function runSessionMove(api: TuiPluginApi): Promise<void> {
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

    const token = getToken(state.managerUrl)
    if (!token) {
      api.ui.toast({ variant: 'error', message: `No token in Keychain. Run \`ocm login ${state.managerUrl}\`.` })
      return
    }

    const repos = await fetchRepos(state.managerUrl, token)
    const plan = await prepareMirror(session.directory, toRemoteRepoSummaries(repos))

    if (plan.matched.length === 0) {
      api.ui.toast({ variant: 'error', message: 'No matching Manager repo; run `ocm push --create` first' })
      return
    }

    let matched = plan.matched[0]!
    if (plan.matched.length > 1) {
      const chosen = await selectDialog(api, 'Move session to Manager repo', plan.matched.map((r) => ({ title: r.name, description: `id=${r.repoId}`, value: r })))
      if (!chosen) return
      matched = chosen
    }
    const repoId = matched.repoId
    const remoteRepo = repos.find((r) => r.repoId === repoId)
    const remoteDirectory = remoteRepo!.directory

    const proceed = await confirmDialog(api, { title: 'Move session to Manager', message: `Push repo state and move this session to ${matched.name} (${remoteDirectory})?` })
    if (!proceed) return

    const managerApi = new ManagerApi(state.managerUrl, token)

    try {
      const divergence = await checkPushDivergence(plan.repoRoot, managerApi, repoId)
      if (divergence.diverged || divergence.serverDirty) {
        api.ui.toast({ variant: 'error', title: 'Remote has diverged', message: 'Remote has diverged; resolve with `ocm push --force` first' })
        return
      }
    } catch (error) {
      if (!(error instanceof ManagerApiError && error.status === 404)) throw error
    }

    const selectedPlan: MirrorPlan = { ...plan, matched: [matched] }
    await mirrorUpFast(selectedPlan, {
      api: managerApi,
      force: false,
      onPhase: createPushPhaseToaster(api),
    })

    const result = await transferSession(
      { sessionID, localRoot: plan.repoRoot, remoteDirectory },
      {
        fetchLocalHistory: () => readSessionEvents(sessionID),
        replayEvents: createManagerReplay(state.managerUrl, token),
        onProgress: (replayed, total) => api.ui.toast({ message: `Moving session… ${replayed}/${total} events`, duration: 2000 }),
      },
    )

    switch (result.kind) {
      case 'moved': {
        await createManagerPromptAsync(state.managerUrl, token)(remoteDirectory, result.sessionID, moveReminderText(remoteDirectory)).catch(() => undefined)
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
  }
}

export { readRemoteContext } from './remote-context.js'
