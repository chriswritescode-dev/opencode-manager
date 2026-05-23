import type { PluginConfig } from './config.js'
import type { ManagerClient } from './manager-client.js'
import type { WorkspaceAdapterWithList, WorkspaceListedInfo, PluginInput } from './opencode-plugin-types.js'

export function buildWorkspaceName(connectionId: string, repoId: number, localPath: string): string {
  return `manager:${connectionId}:${repoId}:${localPath}`
}

export function createManagerWorkspaceAdapter(
  input: PluginInput,
  config: PluginConfig,
  client: ManagerClient,
): WorkspaceAdapterWithList {
  return {
    name: 'manager',
    description: 'Connect to OpenCode Manager repos as workspaces',

    async list(): Promise<WorkspaceListedInfo[]> {
      return []
    },

    async configure(info) {
      if (!info.extra || typeof info.extra !== 'object') {
        throw new Error('Missing extra metadata in workspace info')
      }
      const extra = info.extra as Record<string, unknown>
      if (typeof extra.repoId !== 'number') {
        throw new Error('Missing or invalid repoId in workspace extra metadata')
      }
      return info
    },

    async create() {
      // No-op for manager workspaces - they exist on the Manager server
    },

    async remove() {
      // Only removes local workspace record, not the remote repo
    },

    async target(info) {
      const extra = info.extra as Record<string, unknown> | null
      if (!extra || typeof extra.repoId !== 'number') {
        throw new Error('Invalid workspace: missing repoId in extra metadata')
      }

      const target = await client.ensureTarget(extra.repoId)

      return {
        type: 'remote',
        url: new URL(target.openCodeUrl, config.managerUrl),
        headers: target.headers,
      }
    },
  }
}

export type { ManagerClient } from './manager-client.js'
