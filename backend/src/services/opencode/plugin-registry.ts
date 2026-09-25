import { promises as fs } from 'fs'
import { join } from 'path'
import { writeFileAtomic } from '../../utils/fs-safe'
import { buildGhEnvPluginSource } from '../opencode-gh-env-plugin'
import { buildManagerToolPluginSource } from '../opencode-manager-tool-plugin'
import { buildSandboxPluginSource } from '../opencode-sandbox-plugin'
import { getOpenCodeServiceSettingsPath } from '../opencode-service-mode'
import { ensureSandboxShellShim } from '../sandbox/shell-shim'

const MANAGED_OPENCODE_PLUGIN_IDS = {
  ghEnv: 'ocm.gh-env',
  manager: 'ocm.manager',
  sandbox: 'ocm.sandbox',
} as const

type ManagedOpenCodePlugin = {
  id: string
  filename: string
  buildSource: (context: { id: string; shellShimPath: string; serviceSettingsPath: string }) => string
}

const MANAGED_OPENCODE_PLUGINS: readonly ManagedOpenCodePlugin[] = [
  {
    id: MANAGED_OPENCODE_PLUGIN_IDS.ghEnv,
    filename: 'ocm-gh-env.js',
    buildSource: ({ id }) => buildGhEnvPluginSource(id),
  },
  {
    id: MANAGED_OPENCODE_PLUGIN_IDS.manager,
    filename: 'ocm-manager.js',
    buildSource: ({ id }) => buildManagerToolPluginSource(id),
  },
  {
    id: MANAGED_OPENCODE_PLUGIN_IDS.sandbox,
    filename: 'ocm-sandbox.js',
    buildSource: ({ id, shellShimPath, serviceSettingsPath }) => buildSandboxPluginSource(id, shellShimPath, serviceSettingsPath),
  },
]

export function getOpenCodePluginDir(configHome: string): string {
  return join(configHome, 'opencode', 'plugins')
}

export async function installManagedPlugins(configHome: string): Promise<void> {
  const shellShimPath = await ensureSandboxShellShim(configHome)
  const serviceSettingsPath = getOpenCodeServiceSettingsPath()
  const dir = getOpenCodePluginDir(configHome)
  const legacyDir = join(configHome, 'opencode', 'plugin')
  for (const plugin of MANAGED_OPENCODE_PLUGINS) {
    await writeFileAtomic(join(dir, plugin.filename), plugin.buildSource({ id: plugin.id, shellShimPath, serviceSettingsPath }))
    await fs.rm(join(legacyDir, plugin.filename), { force: true })
  }
}
