import { resolveOpenCodeProjectId } from '@opencode-manager/shared/project-id'
import { resolveManagerAuth } from './manager-auth.js'
import type { ManagerAuth } from './manager-auth.js'
import { fetchRepos } from './manager-repos.js'
import type { ManagerRepo } from './manager-repos.js'
import { warmRepoProxy } from './repo-proxy.js'
import { readState, writeState, type OcmState } from './state.js'
import { confirmDialog, selectDialog } from './tui-dialogs.js'
import { setPendingWarp } from './warp.js'
import type { PendingWarp } from './warp.js'
import type { RemoteContext } from './remote-context.js'
import type { OcmTuiContext } from './tui-context.js'

export interface OcmSwitchRuntime {
  resolveManagerAuth: (managerUrl?: string) => Promise<ManagerAuth>
  fetchRepos: (managerUrl: string, token: string) => Promise<ManagerRepo[]>
  resolveProjectId: (directory: string) => Promise<string | null>
  warmRepoProxy: (managerUrl: string, token: string, repoId: number) => Promise<void>
  readState: () => OcmState | null
  writeState: (state: OcmState) => void
  setPendingWarp: (warp: PendingWarp) => void
}

export const ocmSwitchRuntime: OcmSwitchRuntime = {
  resolveManagerAuth,
  fetchRepos,
  resolveProjectId: resolveOpenCodeProjectId,
  warmRepoProxy,
  readState,
  writeState,
  setPendingWarp,
}

export type OcmSwitchDeps = {
  remote: RemoteContext | undefined
  cwd?: string
  runtime?: OcmSwitchRuntime
}

type SwitchChoice = { kind: 'repo'; repo: ManagerRepo } | { kind: 'local' }

const MATCH_CATEGORY = 'Matches this directory'
const REPO_CATEGORY = 'Manager repos'
const LOCAL_CATEGORY = 'Local'

export async function runOcmSwitch(context: OcmTuiContext, deps: OcmSwitchDeps): Promise<void> {
  const runtime = deps.runtime ?? ocmSwitchRuntime
  try {
    const auth = await runtime.resolveManagerAuth(deps.remote?.managerUrl)
    if (!auth.ok && !deps.remote) {
      context.ui.toast.show({ variant: 'error', message: auth.message })
      return
    }

    let repos: ManagerRepo[] = []
    if (auth.ok) {
      try {
        repos = (await runtime.fetchRepos(auth.managerUrl, auth.token)).filter((repo) => repo.cloneStatus === 'ready')
      } catch (error) {
        if (!deps.remote) throw error
      }
    }
    const choice = deps.remote
      ? await chooseFromRemote(context, repos, deps.remote)
      : auth.ok
        ? await chooseFromLocal(context, repos, auth.managerUrl, deps.cwd ?? localDirectory(context), runtime)
        : undefined
    if (!choice) return

    if (choice.kind === 'local') {
      runtime.setPendingWarp({ kind: 'local' })
      context.keymap.dispatch('app.exit')
      return
    }

    if (!auth.ok) return

    await runtime.warmRepoProxy(auth.managerUrl, auth.token, choice.repo.repoId)
    rememberLastRepo(choice.repo, runtime)
    runtime.setPendingWarp({
      kind: 'attach',
      target: { managerUrl: auth.managerUrl, token: auth.token, repoId: choice.repo.repoId, repoName: choice.repo.name },
    })
    context.keymap.dispatch('app.exit')
  } catch (error) {
    context.ui.toast.show({ variant: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

async function chooseFromLocal(
  context: OcmTuiContext,
  repos: ManagerRepo[],
  managerUrl: string,
  directory: string,
  runtime: OcmSwitchRuntime,
): Promise<SwitchChoice | undefined> {
  const projectId = await runtime.resolveProjectId(directory)
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

async function chooseFromRemote(context: OcmTuiContext, repos: ManagerRepo[], remote: RemoteContext): Promise<SwitchChoice | undefined> {
  return selectDialog<SwitchChoice>(context, 'Switch server', [
    { title: 'Local opencode', description: 'Leave the Manager and run opencode on this machine', value: { kind: 'local' }, category: LOCAL_CATEGORY },
    ...repos.map((repo) => {
      const option = repoOption(repo, REPO_CATEGORY)
      if (repo.repoId === remote.repoId) return { ...option, description: 'Current', disabled: true }
      return option
    }),
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

function localDirectory(context: OcmTuiContext): string {
  const route = context.ui.router.current()
  const sessionDirectory = route.type === 'session' ? context.data.session.get(route.sessionID)?.location.directory : undefined
  return sessionDirectory ?? process.cwd()
}

function rememberLastRepo(repo: ManagerRepo, runtime: OcmSwitchRuntime): void {
  const state = runtime.readState()
  if (!state) return
  runtime.writeState({ ...state, lastRepoId: repo.repoId, lastRepoName: repo.name, lastRepoDir: repo.directory, lastRepoBranch: repo.branch })
}
