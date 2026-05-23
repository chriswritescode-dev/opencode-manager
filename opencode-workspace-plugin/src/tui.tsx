/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from '@opencode-ai/plugin/tui'
import { resolveConfig, type PluginConfig } from './config.js'
import { ManagerClient } from './manager-client.js'
import { buildWorkspaceName } from './adapter.js'
import { PLUGIN_ID, WORKSPACE_ADAPTER_TYPE } from './index.js'
import type { ManagerWorkspaceSummary } from './opencode-plugin-types.js'

const COMMAND_VALUE = 'manager.workspace.open'
const DEFAULT_KEYBIND = '<leader>w'
const SLASH_NAME = 'manager'

type WorkspaceListEntry = {
  id?: string
  name?: string
  type?: string
  extra?: { repoId?: number } | null
}

type WorkspaceListResponse = { data?: WorkspaceListEntry[] } | undefined

async function listExistingWorkspaces(api: TuiPluginApi): Promise<WorkspaceListEntry[]> {
  const workspaceApi = api.client.experimental?.workspace
  if (!workspaceApi || typeof workspaceApi.list !== 'function') return []
  try {
    const result = (await workspaceApi.list()) as WorkspaceListResponse
    return result?.data ?? []
  } catch {
    return []
  }
}

function findExistingWorkspaceForRepo(
  workspaces: WorkspaceListEntry[],
  repoId: number,
): WorkspaceListEntry | undefined {
  return workspaces.find(
    (workspace) => workspace.type === WORKSPACE_ADAPTER_TYPE && workspace.extra?.repoId === repoId,
  )
}

async function createWorkspaceForRepo(
  api: TuiPluginApi,
  config: PluginConfig,
  repo: ManagerWorkspaceSummary,
): Promise<string | null> {
  const workspaceApi = api.client.experimental?.workspace
  if (!workspaceApi || typeof workspaceApi.create !== 'function') {
    api.ui.toast({
      message: 'experimental.workspace.create not available on this opencode version',
      variant: 'error',
      duration: 5000,
    })
    return null
  }

  const result = await workspaceApi.create({
    type: WORKSPACE_ADAPTER_TYPE,
    branch: repo.branch,
    extra: {
      repoId: repo.repoId,
      managerUrl: config.managerUrl,
      connectionId: config.connectionId,
      localPath: repo.extra.localPath,
      fullPath: repo.extra.fullPath,
      desiredName: buildWorkspaceName(config.connectionId, repo.repoId, repo.extra.localPath),
    },
  })

  if (result && typeof result === 'object' && 'error' in result && result.error) {
    api.ui.toast({
      message: `Failed to create workspace: ${JSON.stringify(result.error)}`,
      variant: 'error',
      duration: 5000,
    })
    return null
  }

  const data = result && typeof result === 'object' && 'data' in result ? result.data : result
  if (data && typeof data === 'object' && 'id' in data && typeof data.id === 'string') {
    if (typeof workspaceApi.syncList === 'function') {
      await workspaceApi.syncList().catch(() => undefined)
    }
    return data.id
  }

  return null
}

async function warpIntoWorkspace(
  api: TuiPluginApi,
  workspaceId: string,
  sessionID: string,
): Promise<boolean> {
  const workspaceApi = api.client.experimental?.workspace
  if (!workspaceApi || typeof workspaceApi.warp !== 'function') {
    api.ui.toast({
      message: 'experimental.workspace.warp not available',
      variant: 'error',
      duration: 5000,
    })
    return false
  }
  const result = await workspaceApi.warp({
    id: workspaceId,
    sessionID,
    copyChanges: false,
  })
  if (result && typeof result === 'object' && 'error' in result && result.error) {
    api.ui.toast({
      message: `Warp failed: ${JSON.stringify(result.error)}`,
      variant: 'error',
      duration: 5000,
    })
    return false
  }
  return true
}

function resolveSessionID(api: TuiPluginApi): string | null {
  const route = api.route.current
  if (route.name !== 'session') return null
  const params = (route as { params?: { sessionID?: string } }).params
  return params?.sessionID ?? null
}

function describeRepo(repo: ManagerWorkspaceSummary): string {
  const branch = repo.branch ? ` (${repo.branch})` : ''
  return `${repo.name}${branch} \u2022 ${repo.cloneStatus}`
}

async function openManagerPicker(
  api: TuiPluginApi,
  config: PluginConfig,
  client: ManagerClient,
): Promise<void> {
  const sessionID = resolveSessionID(api)
  if (!sessionID) {
    api.ui.toast({
      message: 'Open a session before warping into a Manager workspace',
      variant: 'info',
      duration: 3000,
    })
    return
  }

  let repos: ManagerWorkspaceSummary[]
  try {
    repos = await client.listWorkspaces()
  } catch (err) {
    api.ui.toast({
      message: `Failed to load Manager repos: ${err instanceof Error ? err.message : String(err)}`,
      variant: 'error',
      duration: 5000,
    })
    return
  }

  if (repos.length === 0) {
    api.ui.toast({
      message: 'No repos available in Manager',
      variant: 'info',
      duration: 4000,
    })
    return
  }

  const existing = await listExistingWorkspaces(api)

  const options = repos.map((repo) => {
    const existingWs = findExistingWorkspaceForRepo(existing, repo.repoId)
    const description = describeRepo(repo) + (existingWs ? ' \u2022 connected' : '')
    return {
      title: repo.name,
      value: repo.repoId,
      description,
    }
  })

  api.ui.dialog.setSize('medium')
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="Open Manager Workspace"
      placeholder="Search repos..."
      options={options}
      onSelect={async (option) => {
        api.ui.dialog.clear()
        const repoId = option.value as number
        const repo = repos.find((entry) => entry.repoId === repoId)
        if (!repo) return

        const existingWs = findExistingWorkspaceForRepo(existing, repoId)
        let workspaceId = existingWs?.id ?? null
        if (!workspaceId) {
          api.ui.toast({
            message: `Connecting to ${repo.name}...`,
            variant: 'info',
            duration: 2000,
          })
          workspaceId = await createWorkspaceForRepo(api, config, repo)
        }
        if (!workspaceId) return

        const warped = await warpIntoWorkspace(api, workspaceId, sessionID)
        if (warped) {
          api.ui.toast({
            message: `Warped into ${repo.name}`,
            variant: 'success',
            duration: 3000,
          })
        }
      }}
    />
  ))
}

const tui: TuiPlugin = async (api, options) => {
  let config: PluginConfig
  try {
    config = resolveConfig(options)
  } catch (err) {
    api.ui.toast({
      message: `Manager plugin TUI disabled: ${err instanceof Error ? err.message : String(err)}`,
      variant: 'warning',
      duration: 6000,
    })
    return
  }

  const client = new ManagerClient(config)

  if (!api.command) return

  api.command.register(() => [
    {
      title: 'Manager: Open workspace',
      value: COMMAND_VALUE,
      description: 'Pick a Manager repo to warp the current session into',
      category: 'Manager',
      keybind: DEFAULT_KEYBIND,
      slash: { name: SLASH_NAME },
      onSelect: async () => {
        await openManagerPicker(api, config, client)
      },
    },
  ])
}

const pluginModule: TuiPluginModule & { id: string } = {
  id: PLUGIN_ID,
  tui,
}

export default pluginModule
