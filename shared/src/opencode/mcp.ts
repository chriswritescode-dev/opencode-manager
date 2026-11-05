import type { McpServer } from '@opencode/client'
import type { OpenCodeConfigInfo } from './config'
import { isRecord } from '../utils/record'

export const MCP_OAUTH_CALLBACK_PATH = '/api/mcp-oauth-proxy/callback'

type McpConfig = NonNullable<OpenCodeConfigInfo['mcp']>

export type McpServerConfig = NonNullable<McpConfig['servers']>[string]

export type McpTimeoutConfig = NonNullable<McpServerConfig['timeout']>

export type McpStatus = McpServer['status'] & Pick<McpServer, 'integrationID'>

export type McpStatusMap = Record<string, McpStatus>

export function mcpOAuthRedirectUri(origin: string): string {
  return new URL(MCP_OAUTH_CALLBACK_PATH, origin).toString()
}

function isMcpServerConfig(value: unknown): value is McpServerConfig {
  return isRecord(value) && (value.type === 'local' || value.type === 'remote')
}

export function mcpServersFromConfig(mcp: unknown): Record<string, McpServerConfig> {
  if (!isRecord(mcp) || !isRecord(mcp.servers)) return {}
  return Object.fromEntries(Object.entries(mcp.servers).filter((entry): entry is [string, McpServerConfig] => isMcpServerConfig(entry[1])))
}

export interface McpServerView {
  name: string
  type: 'local' | 'remote'
  command?: string[]
  url?: string
  enabled: boolean
}

/**
 * Maps a config server to its UI-facing view, exposing `command` for local servers and `url` for
 * remote ones so the view never carries both. `enabled` reflects the absence of `disabled: true`.
 */
function toMcpServerView(name: string, config: McpServerConfig, enabled: boolean): McpServerView {
  return {
    name,
    type: config.type,
    ...(config.type === 'local' ? { command: config.command } : { url: config.url }),
    enabled,
  }
}

export function mcpServerViewsFromConfig(mcp: unknown): McpServerView[] {
  return Object.entries(mcpServersFromConfig(mcp))
    .map(([name, config]) => toMcpServerView(name, config, config.disabled !== true))
    .sort((left, right) => left.name.localeCompare(right.name))
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
