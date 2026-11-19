import type { McpServer } from '@opencode/client'
import { z } from 'zod'
import type { OpenCodeConfigInfo } from './config'
import { JsonValueSchema, type JsonValue } from '../utils/json'

export const MCP_OAUTH_CALLBACK_PATH = '/api/mcp-oauth-proxy/callback'

type McpConfig = NonNullable<OpenCodeConfigInfo['mcp']>

export type McpServerConfig = NonNullable<McpConfig['servers']>[string]

export type McpTimeoutConfig = NonNullable<McpServerConfig['timeout']>

export type McpStatus = McpServer['status'] & Pick<McpServer, 'integrationID'>

export type McpStatusMap = Record<string, McpStatus>

const McpServerConfigSchema = z.union([
  z.looseObject({
    type: z.literal('local'),
    command: z.array(z.string()),
  }),
  z.looseObject({
    type: z.literal('remote'),
    url: z.string(),
  }),
])

const McpConfigDocumentSchema = z.looseObject({
  servers: z.record(z.string(), JsonValueSchema).optional(),
})

export function mcpOAuthRedirectUri(origin: string): string {
  return new URL(MCP_OAUTH_CALLBACK_PATH, origin).toString()
}

export function mcpServersFromConfig(mcp: JsonValue | undefined): Record<string, McpServerConfig> {
  const document = McpConfigDocumentSchema.safeParse(mcp)
  if (!document.success || document.data.servers === undefined) return {}
  return Object.fromEntries(
    Object.entries(document.data.servers).flatMap(([name, entry]) => {
      const config = McpServerConfigSchema.safeParse(entry)
      return config.success ? [[name, config.data] as const] : []
    }),
  )
}

export interface McpServerView {
  name: string
  type: 'local' | 'remote'
  command?: string[]
  url?: string
  enabled: boolean
}

function toMcpServerView(name: string, config: McpServerConfig, enabled: boolean): McpServerView {
  if (config.type === 'local') {
    return { name, type: config.type, command: config.command, enabled }
  }
  return { name, type: config.type, url: config.url, enabled }
}

export function mcpServerViewsFromConfig(mcp: JsonValue | undefined): McpServerView[] {
  return Object.entries(mcpServersFromConfig(mcp))
    .map(([name, config]) => toMcpServerView(name, config, config.disabled !== true))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function mcpStatusByName(servers: McpServer[]): McpStatusMap {
  return Object.fromEntries(
    servers.map((server) => {
      const status: McpStatus = { ...server.status }
      if (server.integrationID) status.integrationID = server.integrationID
      return [server.name, status]
    }),
  )
}
