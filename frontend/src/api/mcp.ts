import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'
import { openCodeApi, toFetchError } from './opencodeApi'
import { isMcpServerNotFoundError } from '@opencode-manager/shared/opencode'
import {
  mcpStatusByName,
  toV2McpServerConfig,
  type McpServerConfig,
  type McpStatusMap,
} from '@opencode-manager/shared/opencode'

export type { McpServerConfig, McpStatus, McpStatusMap } from '@opencode-manager/shared/opencode'

export interface McpAuthStartResponse {
  authorizationUrl: string
  flowId: string
}

export type McpOAuthFlowStatus =
  | { status: 'pending' }
  | { status: 'completed'; serverName: string }
  | { status: 'failed'; error: string }
  | { status: 'unknown' }

function locationInput(directory?: string) {
  return directory ? { location: { directory } } : undefined
}

async function requestV2<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toFetchError(error)
  }
}

export const mcpApi = {
  async getStatus(directory?: string): Promise<McpStatusMap> {
    const { data } = await requestV2(() => openCodeApi.mcp.list(locationInput(directory)))
    return mcpStatusByName(data)
  },

  async addServer(name: string, config: McpServerConfig): Promise<void> {
    await requestV2(() =>
      openCodeApi.mcp.add({
        server: name,
        config: toV2McpServerConfig(config, window.location.origin),
      }),
    )
  },

  async removeServer(name: string): Promise<void> {
    await requestV2(async () => {
      try {
        await openCodeApi.mcp.remove({ server: name })
      } catch (error) {
        if (!isMcpServerNotFoundError(error)) throw error
      }
    })
  },

  async connect(name: string, directory?: string): Promise<void> {
    await requestV2(() =>
      openCodeApi.mcp.connect({
        server: name,
        ...(directory ? { location: { directory } } : {}),
      }),
    )
  },

  async disconnect(name: string, directory?: string): Promise<void> {
    await requestV2(() =>
      openCodeApi.mcp.disconnect({
        server: name,
        ...(directory ? { location: { directory } } : {}),
      }),
    )
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
