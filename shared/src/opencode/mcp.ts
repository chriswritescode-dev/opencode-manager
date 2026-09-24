import type { ConfigEntry, McpServer } from '@opencode/client'

export const MCP_OAUTH_CALLBACK_PATH = '/api/mcp-oauth-proxy/callback'

type ConfigDocumentInfo = Extract<ConfigEntry, { type: 'document' }>['info']

type McpConfig = NonNullable<ConfigDocumentInfo['mcp']>

export type McpServerConfig = NonNullable<McpConfig['servers']>[string]

export type McpTimeoutConfig = NonNullable<McpServerConfig['timeout']>

export type McpStatus = McpServer['status'] & Pick<McpServer, 'integrationID'>

export type McpStatusMap = Record<string, McpStatus>

export function mcpOAuthRedirectUri(origin: string): string {
  return new URL(MCP_OAUTH_CALLBACK_PATH, origin).toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMcpServerConfig(value: unknown): value is McpServerConfig {
  return isRecord(value) && (value.type === 'local' || value.type === 'remote')
}

export function mcpServersFromConfig(mcp: unknown): Record<string, McpServerConfig> {
  if (!isRecord(mcp) || !isRecord(mcp.servers)) return {}
  return Object.fromEntries(Object.entries(mcp.servers).filter((entry): entry is [string, McpServerConfig] => isMcpServerConfig(entry[1])))
}

export function mcpStatusByName(servers: McpServer[]): McpStatusMap {
  return Object.fromEntries(
    servers.map((server) => [
      server.name,
      {
        ...server.status,
        ...(server.integrationID ? { integrationID: server.integrationID } : {}),
      },
    ]),
  )
}
