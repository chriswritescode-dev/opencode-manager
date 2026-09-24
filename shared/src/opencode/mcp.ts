import type { McpServer } from '@opencode/client'

export const MCP_OAUTH_CALLBACK_PATH = '/api/mcp-oauth-proxy/callback'

export type McpStatusName = 'connected' | 'pending' | 'disabled' | 'failed' | 'needs_auth'

export interface McpStatus {
  status: McpStatusName
  error?: string
  integrationID?: string
}

export type McpStatusMap = Record<string, McpStatus>

export interface McpOAuthConfig {
  clientId?: string
  clientSecret?: string
  scope?: string
}

export interface McpServerConfig {
  type: 'local' | 'remote'
  enabled?: boolean
  command?: string[]
  url?: string
  environment?: Record<string, string>
  headers?: Record<string, string>
  timeout?: number
  oauth?: boolean | McpOAuthConfig
}

export interface V2McpTimeoutConfig {
  catalog?: number
  execution?: number
}

export interface V2McpOAuthConfig {
  client_id?: string
  client_secret?: string
  scope?: string
  callback_port?: number
  redirect_uri?: string
  auth_server_metadata_url?: string
}

export interface V2McpLocalConfig {
  type: 'local'
  command: string[]
  cwd?: string
  environment?: Record<string, string>
  disabled?: boolean
  timeout?: V2McpTimeoutConfig
}

export interface V2McpRemoteConfig {
  type: 'remote'
  url: string
  headers?: Record<string, string>
  oauth?: V2McpOAuthConfig | false
  disabled?: boolean
  timeout?: V2McpTimeoutConfig
}

export type V2McpServerConfig = V2McpLocalConfig | V2McpRemoteConfig

export function mcpOAuthRedirectUri(origin: string): string {
  return new URL(MCP_OAUTH_CALLBACK_PATH, origin).toString()
}

function toV2Timeout(timeout: number | undefined): V2McpTimeoutConfig | undefined {
  return timeout === undefined ? undefined : { catalog: timeout, execution: timeout }
}

function toV2OAuth(oauth: boolean | McpOAuthConfig, origin: string | undefined): V2McpOAuthConfig | false {
  if (oauth === false) return false
  const config = typeof oauth === 'object' ? oauth : {}
  return {
    ...(config.clientId ? { client_id: config.clientId } : {}),
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
    ...(config.scope ? { scope: config.scope } : {}),
    ...(origin ? { redirect_uri: mcpOAuthRedirectUri(origin) } : {}),
  }
}

function toV2Disabled(enabled: boolean | undefined): boolean | undefined {
  return enabled === undefined ? undefined : !enabled
}

export function toV2McpServerConfig(config: McpServerConfig, origin?: string): V2McpServerConfig {
  const disabled = toV2Disabled(config.enabled)
  const timeout = toV2Timeout(config.timeout)

  if (config.type === 'local') {
    return {
      type: 'local',
      command: config.command ?? [],
      ...(config.environment ? { environment: config.environment } : {}),
      ...(disabled === undefined ? {} : { disabled }),
      ...(timeout === undefined ? {} : { timeout }),
    }
  }

  return {
    type: 'remote',
    url: config.url ?? '',
    ...(config.headers ? { headers: config.headers } : {}),
    ...(config.oauth === undefined ? {} : { oauth: toV2OAuth(config.oauth, origin) }),
    ...(disabled === undefined ? {} : { disabled }),
    ...(timeout === undefined ? {} : { timeout }),
  }
}

function fromV2Timeout(timeout: V2McpTimeoutConfig | undefined): number | undefined {
  return timeout?.catalog ?? timeout?.execution
}

function fromV2OAuth(oauth: V2McpOAuthConfig | false | undefined): boolean | McpOAuthConfig | undefined {
  if (oauth === undefined) return undefined
  if (oauth === false) return false
  return {
    ...(oauth.client_id ? { clientId: oauth.client_id } : {}),
    ...(oauth.client_secret ? { clientSecret: oauth.client_secret } : {}),
    ...(oauth.scope ? { scope: oauth.scope } : {}),
  }
}

export function fromV2McpServerConfig(config: V2McpServerConfig): McpServerConfig {
  const enabled = config.disabled === undefined ? undefined : !config.disabled
  const timeout = fromV2Timeout(config.timeout)

  if (config.type === 'local') {
    return {
      type: 'local',
      ...(enabled === undefined ? {} : { enabled }),
      command: [...config.command],
      ...(config.environment ? { environment: config.environment } : {}),
      ...(timeout === undefined ? {} : { timeout }),
    }
  }

  return {
    type: 'remote',
    ...(enabled === undefined ? {} : { enabled }),
    url: config.url,
    ...(config.headers ? { headers: config.headers } : {}),
    ...(config.oauth === undefined ? {} : { oauth: fromV2OAuth(config.oauth) }),
    ...(timeout === undefined ? {} : { timeout }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDirectMcpServerEntry(value: unknown): boolean {
  return isRecord(value) && (value.type === 'local' || value.type === 'remote')
}

export function mcpServersFromConfig(mcp: unknown): Record<string, McpServerConfig> {
  if (!isRecord(mcp)) return {}

  const servers: Record<string, McpServerConfig> = {}
  for (const [name, value] of Object.entries(mcp)) {
    if (!isRecord(value)) continue

    if (name === 'servers' && !isDirectMcpServerEntry(value)) {
      for (const [serverName, server] of Object.entries(value)) {
        if (isRecord(server) && isDirectMcpServerEntry(server)) {
          servers[serverName] = fromV2McpServerConfig(server as unknown as V2McpServerConfig)
        }
      }
      continue
    }

    if (name === 'timeout' && !isDirectMcpServerEntry(value)) continue
    if (isDirectMcpServerEntry(value)) {
      servers[name] = value as unknown as McpServerConfig
    }
  }

  return servers
}

export function mcpServerConfigFromConfig(mcp: unknown, name: string): V2McpServerConfig | undefined {
  if (!isRecord(mcp)) return undefined

  const servers = mcp.servers
  if (isRecord(servers)) {
    const native = servers[name]
    if (isRecord(native) && isDirectMcpServerEntry(native)) return native as unknown as V2McpServerConfig
  }

  const legacy = mcp[name]
  if (isRecord(legacy) && isDirectMcpServerEntry(legacy)) {
    return toV2McpServerConfig(legacy as unknown as McpServerConfig)
  }

  return undefined
}

export function mcpStatusByName(servers: McpServer[]): McpStatusMap {
  return Object.fromEntries(
    servers.map((server) => [
      server.name,
      {
        status: server.status.status,
        ...('error' in server.status ? { error: server.status.error } : {}),
        ...(server.integrationID ? { integrationID: server.integrationID } : {}),
      },
    ]),
  )
}
