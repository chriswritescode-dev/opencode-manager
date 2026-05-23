import type { PluginConfig } from './config.js'
import type { ManagerWorkspace } from './opencode-plugin-types.js'

export class ManagerClient {
  private baseUrl: string
  private token: string

  constructor(config: PluginConfig) {
    this.baseUrl = config.managerUrl
    this.token = config.managerToken
  }

  async listWorkspaces(): Promise<ManagerWorkspace[]> {
    const response = await fetch(`${this.baseUrl}/api/internal/opencode-workspaces`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to list workspaces: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as { workspaces: ManagerWorkspace[] }
    return data.workspaces
  }
}
