import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'

export type McpStatus = 
  | { status: 'connected' }
  | { status: 'disabled' }
  | { status: 'failed'; error: string }
  | { status: 'needs_auth' }
  | { status: 'needs_client_registration'; error: string }

export type McpStatusMap = Record<string, McpStatus>

export interface McpServerConfig {
  type: 'local' | 'remote'
  enabled?: boolean
  command?: string[]
  url?: string
  environment?: Record<string, string>
  headers?: Record<string, string>
  timeout?: number
  oauth?: boolean | {
    clientId?: string
    clientSecret?: string
    scope?: string
  }
}

export interface AddMcpServerRequest {
  name: string
  config: McpServerConfig
}

export interface McpAuthStartResponse {
  authorizationUrl: string
  flowId: string
}

export type McpOAuthFlowStatus = 
  | { status: 'pending' }
  | { status: 'completed'; serverName: string }
  | { status: 'failed'; error: string }
  | { status: 'unknown' }

export const mcpApi = {
  async getStatus(): Promise<McpStatusMap> {
    return fetchWrapper(`${API_BASE_URL}/api/opencode/mcp`)
  },

  async addServer(name: string, config: McpServerConfig): Promise<McpStatusMap> {
    return fetchWrapper(`${API_BASE_URL}/api/opencode/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, config }),
    })
  },

  async connect(name: string): Promise<boolean> {
    return fetchWrapper(`${API_BASE_URL}/api/opencode/mcp/${encodeURIComponent(name)}/connect`, {
      method: 'POST',
    })
  },

  async disconnect(name: string): Promise<boolean> {
    return fetchWrapper(`${API_BASE_URL}/api/opencode/mcp/${encodeURIComponent(name)}/disconnect`, {
      method: 'POST',
    })
  },

  async startAuth(name: string, serverUrl: string, scope?: string, clientId?: string, clientSecret?: string, directory?: string): Promise<McpAuthStartResponse> {
    return fetchWrapper(`${API_BASE_URL}/api/mcp-oauth-proxy/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName: name, serverUrl, scope, clientId, clientSecret, directory }),
    })
  },

  async checkFlowStatus(flowId: string): Promise<McpOAuthFlowStatus> {
    try {
      return await fetchWrapper(`${API_BASE_URL}/api/mcp-oauth-proxy/status/${encodeURIComponent(flowId)}`)
    } catch {
      return { status: 'unknown' }
    }
  },

  async completeAuth(name: string, code: string): Promise<McpStatus> {
    return fetchWrapper(`${API_BASE_URL}/api/opencode/mcp/${encodeURIComponent(name)}/auth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
  },

  async authenticate(name: string): Promise<McpStatus> {
    return fetchWrapper(`${API_BASE_URL}/api/opencode/mcp/${encodeURIComponent(name)}/auth/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
  },

  async removeAuth(name: string): Promise<{ success: true }> {
    return fetchWrapper(`${API_BASE_URL}/api/opencode/mcp/${encodeURIComponent(name)}/auth`, {
      method: 'DELETE',
    })
  },

  async getStatusFor(directory: string): Promise<McpStatusMap> {
    return fetchWrapper(`${API_BASE_URL}/api/opencode/mcp`, {
      params: { directory },
    })
  },

  async getConfigForDirectory(directory: string): Promise<Record<string, unknown>> {
    return fetchWrapper(`${API_BASE_URL}/api/opencode/config`, {
      params: { directory },
    })
  },

  async connectDirectory(name: string, directory: string): Promise<boolean> {
    return fetchWrapper(`${API_BASE_URL}/api/settings/mcp/${encodeURIComponent(name)}/connectdirectory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory }),
    })
  },

  async disconnectDirectory(name: string, directory: string): Promise<boolean> {
    return fetchWrapper(`${API_BASE_URL}/api/settings/mcp/${encodeURIComponent(name)}/disconnectdirectory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory }),
    })
  },

  async authenticateDirectory(name: string, directory: string): Promise<McpStatus> {
    return fetchWrapper(`${API_BASE_URL}/api/settings/mcp/${encodeURIComponent(name)}/authdirectedir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory }),
    })
  },

  async removeAuthDirectory(name: string, directory: string): Promise<{ success: true }> {
    return fetchWrapper(`${API_BASE_URL}/api/settings/mcp/${encodeURIComponent(name)}/authdir`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory }),
    })
  },
}
