import type { TuiPluginApi } from './tui-types.js'
import { readInstallNotice, readState } from './state.js'
import { getToken } from './keychain.js'
import { fetchRepos, toRemoteRepoSummaries } from './manager-repos.js'
import { ManagerApi, ManagerApiError } from './manager-api.js'
import { prepareMirror, checkPushDivergence, mirrorUpFast } from './mirror.js'
import { transferSession } from './session-move.js'
import { createManagerReplay } from './remote-replay.js'
import { readSessionEvents } from './local-history.js'

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

    if (plan.matched.length > 1) {
      const names = plan.matched.map((r) => `${r.name} (id=${r.repoId})`).join(', ')
      api.ui.toast({ variant: 'error', message: `Multiple Manager repos match: ${names}` })
      return
    }

    const matched = plan.matched[0]!
    const repoId = matched.repoId
    const remoteRepo = repos.find((r) => r.repoId === repoId)
    const remoteDirectory = remoteRepo!.directory

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

    api.ui.toast({ message: 'Pushing repo state…' })
    await mirrorUpFast(plan, { api: managerApi, force: false })

    const result = await transferSession(
      { sessionID, localRoot: plan.repoRoot, remoteDirectory },
      { fetchLocalHistory: () => readSessionEvents(sessionID), replayEvents: createManagerReplay(state.managerUrl, token) },
    )

    switch (result.kind) {
      case 'moved':
        api.ui.toast({ variant: 'success', message: `Session moved to Manager (${result.replayedEvents} events). Local copy kept — run \`ocm\` to attach.` })
        break
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
