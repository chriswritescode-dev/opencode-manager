import type { Context } from '@opencode/plugin/tui/context'
import { resolveOpenCodeProjectId } from '@opencode-manager/shared/project-id'
import { resolveManagerAuth } from './manager-auth.js'
import { fetchRepos } from './manager-repos.js'
import type { ManagerRepo } from './manager-repos.js'
import { warmRepoProxy } from './repo-proxy.js'
import { readState, writeState } from './state.js'
import { confirmDialog, selectDialog } from './tui-dialogs.js'
import { setPendingWarp } from './warp.js'
import type { RemoteContext } from './remote-context.js'

export type OcmSwitchDeps = {
  remote: RemoteContext | undefined
  cwd?: string
}

type SwitchChoice = { kind: 'repo'; repo: ManagerRepo } | { kind: 'local' }

const MATCH_CATEGORY = 'Matches this directory'
const REPO_CATEGORY = 'Manager repos'
const LOCAL_CATEGORY = 'Local'

/** Switches this TUI to another server: a Manager repo, or back to local opencode when attached. */
export async function runOcmSwitch(context: Context, deps: OcmSwitchDeps): Promise<void> {
  try {
    const auth = await resolveManagerAuth(deps.remote?.managerUrl)
    if (!auth.ok) {
      context.ui.toast.show({ variant: 'error', message: auth.message })
      return
    }

    const repos = (await fetchRepos(auth.managerUrl, auth.token)).filter((repo) => repo.cloneStatus === 'ready')
    const choice = deps.remote
      ? await chooseFromRemote(context, repos, deps.remote)
      : await chooseFromLocal(context, repos, auth.managerUrl, deps.cwd ?? localDirectory(context))
    if (!choice) return

    if (choice.kind === 'local') {
      setPendingWarp({ kind: 'local' })
      context.keymap.dispatch('app.exit')
      return
    }

    await warmRepoProxy(auth.managerUrl, auth.token, choice.repo.repoId)
    rememberLastRepo(choice.repo)
    setPendingWarp({
      kind: 'attach',
      target: { managerUrl: auth.managerUrl, token: auth.token, repoId: choice.repo.repoId, repoName: choice.repo.name },
    })
    context.keymap.dispatch('app.exit')
  } catch (error) {
    context.ui.toast.show({ variant: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

async function chooseFromLocal(
  context: Context,
  repos: ManagerRepo[],
  managerUrl: string,
  directory: string,
): Promise<SwitchChoice | undefined> {
  const projectId = await resolveOpenCodeProjectId(directory)
  const matches = projectId ? repos.filter((repo) => repo.projectId === projectId) : []

  if (matches.length === 1) {
    const repo = matches[0]!
    const confirmed = await confirmDialog(context, {
      title: 'Switch to OpenCode Manager',
      message: `Exit this TUI and attach to ${repo.name} on ${new URL(managerUrl).host}?\n\nThe current session stays local. Use /ocm-move to bring it along.`,
    })
    return confirmed ? { kind: 'repo', repo } : undefined
  }

  if (repos.length === 0) {
    context.ui.toast.show({ variant: 'error', message: 'The Manager has no ready repos. Run `ocm push --create` first.' })
    return undefined
  }

  const matchIds = new Set(matches.map((repo) => repo.repoId))
  return selectDialog<SwitchChoice>(context, 'Switch to Manager repo', [
    ...matches.map((repo) => repoOption(repo, MATCH_CATEGORY)),
    ...repos.filter((repo) => !matchIds.has(repo.repoId)).map((repo) => repoOption(repo, REPO_CATEGORY)),
  ])
}

async function chooseFromRemote(context: Context, repos: ManagerRepo[], remote: RemoteContext): Promise<SwitchChoice | undefined> {
  return selectDialog<SwitchChoice>(context, 'Switch server', [
    { title: 'Local opencode', description: 'Leave the Manager and run opencode on this machine', value: { kind: 'local' }, category: LOCAL_CATEGORY },
    ...repos.map((repo) => ({
      ...repoOption(repo, REPO_CATEGORY),
      ...(repo.repoId === remote.repoId ? { description: 'Current', disabled: true } : {}),
    })),
  ])
}

function repoOption(repo: ManagerRepo, category: string) {
  return {
    title: repo.name,
    description: [repo.isWorktree ? 'worktree' : null, repo.branch].filter(Boolean).join(' · ') || undefined,
    value: { kind: 'repo' as const, repo },
    category,
  }
}

function localDirectory(context: Context): string {
  const route = context.ui.router.current()
  const sessionDirectory = route.type === 'session' ? context.data.session.get(route.sessionID)?.location.directory : undefined
  return sessionDirectory ?? process.cwd()
}

function rememberLastRepo(repo: ManagerRepo): void {
  const state = readState()
  if (!state) return
  writeState({ ...state, lastRepoId: repo.repoId, lastRepoName: repo.name, lastRepoDir: repo.directory, lastRepoBranch: repo.branch })
}
