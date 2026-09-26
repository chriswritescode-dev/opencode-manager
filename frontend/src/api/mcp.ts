import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'
import { callOpenCode } from './opencodeApi'
import {
  isMcpServerNotFoundError,
  mcpStatusByName,
  openCodeLocation,
  type McpServerConfig,
  type McpStatusMap,
} from '@opencode-manager/shared/opencode'

export type { McpServerConfig, McpStatus } from '@opencode-manager/shared/opencode'

export interface McpAuthStartResponse {
  authorizationUrl: string
  flowId: string
}

type McpOAuthFlowStatus =
  | { status: 'pending' }
  | { status: 'completed'; serverName: string }
  | { status: 'failed'; error: string }
  | { status: 'unknown' }

export const mcpApi = {
  async getStatus(directory?: string): Promise<McpStatusMap> {
    const { data } = await callOpenCode((api) => api.mcp.list(openCodeLocation(directory)))
    return mcpStatusByName(data)
  },

  async addServer(name: string, config: McpServerConfig): Promise<void> {
    await callOpenCode((api) => api.mcp.add({ server: name, config }))
  },

  async removeServer(name: string): Promise<void> {
    await callOpenCode(async (api) => {
      try {
        await api.mcp.remove({ server: name })
      } catch (error) {
        if (!isMcpServerNotFoundError(error)) throw error
      }
    })
  },

  async connect(name: string, directory?: string): Promise<void> {
    await callOpenCode((api) => api.mcp.connect({ server: name, ...openCodeLocation(directory) }))
  },

  async disconnect(name: string, directory?: string): Promise<void> {
    await callOpenCode((api) => api.mcp.disconnect({ server: name, ...openCodeLocation(directory) }))
  },

  async startAuth(name: string, directory?: string): Promise<McpAuthStartResponse> {
    return fetchWrapper(`${API_BASE_URL}/api/mcp-oauth-proxy/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName: name, directory }),
    })
  },

  async checkFlowStatus(flowId: string): Promise<McpOAuthFlowStatus> {
    try {
      return await fetchWrapper(`${API_BASE_URL}/api/mcp-oauth-proxy/status/${encodeURIComponent(flowId)}`)
    } catch {
      return { status: 'unknown' }
    }
  },

  async removeAuth(name: string, directory?: string): Promise<{ success: true }> {
    return fetchWrapper(`${API_BASE_URL}/api/mcp-oauth-proxy/credentials/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      params: directory ? { directory } : undefined,
    })
  },
}
