import { API_BASE_URL } from '@/config'

const API_BASE = API_BASE_URL

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
}

export const mcpApi = {
  async getStatus(): Promise<McpStatusMap> {
    const response = await fetch(`${API_BASE}/api/opencode/mcp`)
    if (!response.ok) {
      throw new Error(`Failed to get MCP status: ${response.statusText}`)
    }
    return response.json()
  },

  async addServer(name: string, config: McpServerConfig): Promise<McpStatusMap> {
    const response = await fetch(`${API_BASE}/api/opencode/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, config }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Failed to add MCP server: ${response.statusText}`)
    }
    return response.json()
  },

  async connect(name: string): Promise<boolean> {
    const response = await fetch(`${API_BASE}/api/opencode/mcp/${encodeURIComponent(name)}/connect`, {
      method: 'POST',
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Failed to connect MCP server: ${response.statusText}`)
    }
    return response.json()
  },

  async disconnect(name: string): Promise<boolean> {
    const response = await fetch(`${API_BASE}/api/opencode/mcp/${encodeURIComponent(name)}/disconnect`, {
      method: 'POST',
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Failed to disconnect MCP server: ${response.statusText}`)
    }
    return response.json()
  },

  async startAuth(name: string): Promise<McpAuthStartResponse> {
    const response = await fetch(`${API_BASE}/api/opencode/mcp/${encodeURIComponent(name)}/auth`, {
      method: 'POST',
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Failed to start MCP auth: ${response.statusText}`)
    }
    return response.json()
  },

  async completeAuth(name: string, code: string): Promise<McpStatus> {
    const response = await fetch(`${API_BASE}/api/opencode/mcp/${encodeURIComponent(name)}/auth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Failed to complete MCP auth: ${response.statusText}`)
    }
    return response.json()
  },

  async authenticate(name: string): Promise<McpStatus> {
    const response = await fetch(`${API_BASE}/api/opencode/mcp/${encodeURIComponent(name)}/auth/authenticate`, {
      method: 'POST',
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Failed to authenticate MCP server: ${response.statusText}`)
    }
    return response.json()
  },

  async removeAuth(name: string): Promise<{ success: true }> {
    const response = await fetch(`${API_BASE}/api/opencode/mcp/${encodeURIComponent(name)}/auth`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Failed to remove MCP auth: ${response.statusText}`)
    }
    return response.json()
  },

  async getStatusFor(directory: string): Promise<McpStatusMap> {
    const response = await fetch(`${API_BASE}/api/opencode/mcp?directory=${encodeURIComponent(directory)}`)
    if (!response.ok) {
      throw new Error(`Failed to get MCP status for directory: ${response.statusText}`)
    }
    return response.json()
  },

  async connectDirectory(name: string, directory: string): Promise<boolean> {
    const response = await fetch(`${API_BASE}/api/settings/mcp/${encodeURIComponent(name)}/connectdirectory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Failed to connect MCP server for directory: ${response.statusText}`)
    }
    return response.json()
  },

  async disconnectDirectory(name: string, directory: string): Promise<boolean> {
    const response = await fetch(`${API_BASE}/api/settings/mcp/${encodeURIComponent(name)}/disconnectdirectory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Failed to disconnect MCP server for directory: ${response.statusText}`)
    }
    return response.json()
  },

  async authenticateDirectory(name: string, directory: string): Promise<McpStatus> {
    const response = await fetch(`${API_BASE}/api/settings/mcp/${encodeURIComponent(name)}/authdirectedir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Failed to authenticate MCP server for directory: ${response.statusText}`)
    }
    return response.json()
  },

  async removeAuthDirectory(name: string, directory: string): Promise<{ success: true }> {
    const response = await fetch(`${API_BASE}/api/settings/mcp/${encodeURIComponent(name)}/authdir`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Failed to remove MCP auth for directory: ${response.statusText}`)
    }
    return response.json()
  },
}
