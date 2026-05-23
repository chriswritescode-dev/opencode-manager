import { resolveConfig } from './config.js'
import { ManagerClient } from './manager-client.js'
import { createManagerWorkspaceAdapter } from './adapter.js'
import type { PluginInput, PluginOptions } from './opencode-plugin-types.js'

export const PLUGIN_ID = 'opencode-workspace-manager'
export const WORKSPACE_ADAPTER_TYPE = 'manager'

async function serverPlugin(input: PluginInput, options?: PluginOptions) {
  const config = resolveConfig(options)
  const client = new ManagerClient(config)

  const adapter = createManagerWorkspaceAdapter(input, config, client)
  input.experimental_workspace.register(WORKSPACE_ADAPTER_TYPE, adapter)

  return {}
}

const pluginModule = {
  id: PLUGIN_ID,
  server: serverPlugin,
}

export default pluginModule
