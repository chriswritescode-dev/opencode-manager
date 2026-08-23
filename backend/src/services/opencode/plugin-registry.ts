import { join } from 'path'
import { writeFileAtomic } from '../../utils/fs-safe'
import { buildGhEnvPluginSource } from '../opencode-gh-env-plugin'
import { buildSandboxPluginSource } from '../opencode-sandbox-plugin'
import { ensureSandboxShellShim } from '../sandbox/shell-shim'

type ManagedOpenCodePlugin = {
  filename: string
  buildSource: (context: { shellShimPath: string }) => string
}

const MANAGED_OPENCODE_PLUGINS: readonly ManagedOpenCodePlugin[] = [
  { filename: 'ocm-gh-env.js', buildSource: () => buildGhEnvPluginSource() },
  { filename: 'ocm-sandbox.js', buildSource: ({ shellShimPath }) => buildSandboxPluginSource(shellShimPath) },
]

export function getOpenCodePluginDir(configHome: string): string {
  return join(configHome, 'opencode', 'plugin')
}

export async function installManagedPlugins(configHome: string): Promise<void> {
  const shellShimPath = await ensureSandboxShellShim(configHome)
  const dir = getOpenCodePluginDir(configHome)
  for (const plugin of MANAGED_OPENCODE_PLUGINS) {
    await writeFileAtomic(join(dir, plugin.filename), plugin.buildSource({ shellShimPath }))
  }
}
