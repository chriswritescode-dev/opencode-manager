import type { PluginConfig } from './config.js'
import type { ManagerWorkspaceSummary, EnsureOpenCodeTargetResponse } from './opencode-plugin-types.js'

export class ManagerClient {
  private baseUrl: string
  private token: string

  constructor(config: PluginConfig) {
    this.baseUrl = config.managerUrl
    this.token = config.managerToken
  }

  async listWorkspaces(): Promise<ManagerWorkspaceSummary[]> {
    const response = await fetch(`${this.baseUrl}/api/internal/opencode-workspaces`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to list workspaces: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as { workspaces: ManagerWorkspaceSummary[] }
    return data.workspaces
  }

  async ensureTarget(repoId: number): Promise<EnsureOpenCodeTargetResponse> {
    const response = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/opencode-target`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to ensure target: ${response.status} ${response.statusText}`)
    }

    return response.json() as Promise<EnsureOpenCodeTargetResponse>
  }
}
