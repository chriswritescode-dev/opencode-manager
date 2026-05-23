import { resolveConfig } from './config.js'
import { ManagerClient } from './manager-client.js'
import { createManagerWorkspaceAdapter } from './adapter.js'
import type { PluginInput, PluginOptions } from './opencode-plugin-types.js'

export default async function OpenCodeManagerWorkspacePlugin(
  input: PluginInput,
  options?: PluginOptions,
) {
  const config = resolveConfig(options)
  const client = new ManagerClient(config)

  const adapter = createManagerWorkspaceAdapter(input, config, client)
  input.experimental_workspace.register('manager', adapter)

  return {}
}
