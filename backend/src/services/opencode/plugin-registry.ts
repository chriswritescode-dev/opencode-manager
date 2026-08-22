import { join } from 'path'
import { writeFileAtomic } from '../../utils/fs-safe'
import { buildGhEnvPluginSource } from '../opencode-gh-env-plugin'
import { buildSandboxPluginSource } from '../opencode-sandbox-plugin'

export type ManagedOpenCodePlugin = {
  filename: string
  buildSource: () => string
}

export const MANAGED_OPENCODE_PLUGINS: readonly ManagedOpenCodePlugin[] = [
  { filename: 'ocm-gh-env.js', buildSource: buildGhEnvPluginSource },
  { filename: 'ocm-sandbox.js', buildSource: buildSandboxPluginSource },
]

export const TRUSTED_OPENCODE_PLUGIN_FILENAMES: readonly string[] = MANAGED_OPENCODE_PLUGINS.map((plugin) => plugin.filename)

export function getOpenCodePluginDir(configHome: string): string {
  return join(configHome, 'opencode', 'plugin')
}

export async function installManagedPlugins(configHome: string): Promise<void> {
  const dir = getOpenCodePluginDir(configHome)
  for (const plugin of MANAGED_OPENCODE_PLUGINS) {
    await writeFileAtomic(join(dir, plugin.filename), plugin.buildSource())
  }
}
