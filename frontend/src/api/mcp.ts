import { z } from 'zod'
import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'
import { callOpenCode } from './opencodeApi'
import {
  isMcpServerNotFoundError,
  mcpStatusByName,
  openCodeLocation,
  type McpStatusMap,
} from '@opencode-manager/shared/opencode'

export type { McpServerConfig, McpStatus } from '@opencode-manager/shared/opencode'

const mcpAuthStartResponseSchema = z.object({
  authorizationUrl: z.string(),
  flowId: z.string(),
})

export type McpAuthStartResponse = z.infer<typeof mcpAuthStartResponseSchema>

const mcpOAuthFlowStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('completed'), serverName: z.string() }),
  z.object({ status: z.literal('failed'), error: z.string() }),
  z.object({ status: z.literal('unknown') }),
])

type McpOAuthFlowStatus = z.infer<typeof mcpOAuthFlowStatusSchema>

export const mcpApi = {
  async getStatus(directory?: string, serverId?: string): Promise<McpStatusMap> {
    const { data } = await callOpenCode((api) => api.mcp.list(openCodeLocation(directory)), serverId)
    return mcpStatusByName(data)
  },

  async removeServer(name: string, serverId?: string): Promise<void> {
    await callOpenCode(async (api) => {
      try {
        await api.mcp.remove({ server: name })
      } catch (error) {
        if (!isMcpServerNotFoundError(error)) throw error
      }
    }, serverId)
  },

  async connect(name: string, directory?: string, serverId?: string): Promise<void> {
    await callOpenCode(
      (api) => api.mcp.connect({ server: name, ...openCodeLocation(directory) }),
      serverId,
    )
  },

  async disconnect(name: string, directory?: string, serverId?: string): Promise<void> {
    await callOpenCode(
      (api) => api.mcp.disconnect({ server: name, ...openCodeLocation(directory) }),
      serverId,
    )
  },

  async startAuth(name: string, directory?: string): Promise<McpAuthStartResponse> {
    return fetchWrapper(`${API_BASE_URL}/api/mcp-oauth-proxy/start`, mcpAuthStartResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName: name, directory }),
    })
  },

  async checkFlowStatus(flowId: string): Promise<McpOAuthFlowStatus> {
    try {
      return await fetchWrapper(
        `${API_BASE_URL}/api/mcp-oauth-proxy/status/${encodeURIComponent(flowId)}`,
        mcpOAuthFlowStatusSchema,
      )
    } catch {
      return { status: 'unknown' }
    }
  },

  async removeAuth(name: string, directory?: string): Promise<{ success: true }> {
    return fetchWrapper(
      `${API_BASE_URL}/api/mcp-oauth-proxy/credentials/${encodeURIComponent(name)}`,
      z.object({ success: z.literal(true) }),
      {
      method: 'DELETE',
      params: directory ? { directory } : undefined,
    })
  },
}
