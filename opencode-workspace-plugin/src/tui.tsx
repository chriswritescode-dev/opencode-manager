/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from '@opencode-ai/plugin/tui'
import { resolveConfig, type PluginConfig } from './config.js'
import { ManagerClient } from './manager-client.js'
import { PLUGIN_ID } from './index.js'
import type { ManagerWorkspace } from './opencode-plugin-types.js'
import { readState, writeState } from './state.js'

const COMMAND_VALUE = 'manager.workspace.open'
const DEFAULT_KEYBIND = '<leader>w'
const SLASH_NAME = 'manager'

function describeRepo(repo: ManagerWorkspace): string {
  const branch = repo.branch ? ` (${repo.branch})` : ''
  return `${repo.name}${branch} \u2022 ${repo.cloneStatus}`
}

async function openManagerPicker(
  api: TuiPluginApi,
  config: PluginConfig,
  client: ManagerClient,
): Promise<void> {
  let repos: ManagerWorkspace[]
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

  const options = repos.map((repo) => ({
    title: repo.name,
    value: repo.repoId,
    description: describeRepo(repo),
  }))

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
        if (!repo || !repo.directory) return

        try {
          const existing = readState()
          writeState({
            ...existing,
            managerUrl: config.managerUrl,
            lastRepoId: repo.repoId,
            lastRepoName: repo.name,
            lastRepoDir: repo.directory,
            lastRepoBranch: repo.branch ?? null,
          })
        } catch (err) {
          api.ui.toast({
            message: `Failed to save state: ${err instanceof Error ? err.message : String(err)}`,
            variant: 'error',
            duration: 5000,
          })
          return
        }

        api.ui.toast({
          message: `Selected ${repo.name}. Exiting \u2014 run \`ocm\` to attach.`,
          variant: 'success',
          duration: 4000,
        })

        setTimeout(() => {
          api.command?.trigger('app_exit')
        }, 400)
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
      description: 'Pick a Manager repo and re-attach opencode to it',
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
