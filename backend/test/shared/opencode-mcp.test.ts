import { describe, expect, it } from 'vitest'
import {
  MCP_OAUTH_CALLBACK_PATH,
  fromV2McpServerConfig,
  mcpServerConfigFromConfig,
  mcpServersFromConfig,
  mcpStatusByName,
  toV2McpServerConfig,
  type McpServer,
} from '@opencode-manager/shared/opencode'

describe('toV2McpServerConfig', () => {
  it('converts a local server with environment and timeout', () => {
    expect(
      toV2McpServerConfig({
        type: 'local',
        enabled: true,
        command: ['npx', 'server-filesystem', '/tmp'],
        environment: { API_KEY: 'secret' },
        timeout: 5000,
      }),
    ).toEqual({
      type: 'local',
      command: ['npx', 'server-filesystem', '/tmp'],
      environment: { API_KEY: 'secret' },
      disabled: false,
      timeout: { catalog: 5000, execution: 5000 },
    })
  })

  it('omits disabled when enabled is undefined', () => {
    expect(toV2McpServerConfig({ type: 'local', command: ['npx', 'server'] })).toEqual({
      type: 'local',
      command: ['npx', 'server'],
    })
  })

  it('inverts enabled into disabled', () => {
    expect(toV2McpServerConfig({ type: 'local', command: ['npx', 'server'], enabled: false })).toEqual({
      type: 'local',
      command: ['npx', 'server'],
      disabled: true,
    })
  })

  it('keeps a remote server without OAuth unchanged', () => {
    expect(
      toV2McpServerConfig({
        type: 'remote',
        url: 'https://mcp.example.com',
        headers: { Authorization: 'Bearer token' },
      }),
    ).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer token' },
    })
  })

  it('writes the Manager callback for OAuth servers', () => {
    expect(
      toV2McpServerConfig({ type: 'remote', url: 'https://mcp.example.com', oauth: true }, 'http://localhost:5003'),
    ).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com',
      oauth: {
        redirect_uri: `http://localhost:5003${MCP_OAUTH_CALLBACK_PATH}`,
      },
    })
  })

  it('converts OAuth client fields and keeps the Manager callback', () => {
    expect(
      toV2McpServerConfig(
        {
          type: 'remote',
          url: 'https://mcp.example.com',
          oauth: { clientId: 'client-1', clientSecret: 'secret-1', scope: 'read write' },
        },
        'https://manager.example.com',
      ),
    ).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com',
      oauth: {
        client_id: 'client-1',
        client_secret: 'secret-1',
        scope: 'read write',
        redirect_uri: `https://manager.example.com${MCP_OAUTH_CALLBACK_PATH}`,
      },
    })
  })

  it('keeps OAuth disabled as false', () => {
    expect(
      toV2McpServerConfig({ type: 'remote', url: 'https://mcp.example.com', oauth: false }, 'http://localhost:5003'),
    ).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com',
      oauth: false,
    })
  })

  it('omits the callback when no origin is supplied', () => {
    expect(toV2McpServerConfig({ type: 'remote', url: 'https://mcp.example.com', oauth: true })).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com',
      oauth: {},
    })
  })
})

describe('fromV2McpServerConfig', () => {
  it('converts a native local server back to the form model', () => {
    expect(
      fromV2McpServerConfig({
        type: 'local',
        command: ['npx', 'server'],
        environment: { API_KEY: 'secret' },
        disabled: false,
        timeout: { catalog: 5000, execution: 9000 },
      }),
    ).toEqual({
      type: 'local',
      enabled: true,
      command: ['npx', 'server'],
      environment: { API_KEY: 'secret' },
      timeout: 5000,
    })
  })

  it('inverts disabled into enabled', () => {
    expect(fromV2McpServerConfig({ type: 'local', command: ['npx', 'server'], disabled: true })).toEqual({
      type: 'local',
      enabled: false,
      command: ['npx', 'server'],
    })
  })

  it('omits enabled when the native config omits disabled', () => {
    expect(fromV2McpServerConfig({ type: 'local', command: ['npx', 'server'] })).toEqual({
      type: 'local',
      command: ['npx', 'server'],
    })
  })

  it('converts a native remote OAuth server back to the form model', () => {
    expect(
      fromV2McpServerConfig({
        type: 'remote',
        url: 'https://mcp.example.com',
        oauth: { client_id: 'client-1', client_secret: 'secret-1', scope: 'read' },
      }),
    ).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com',
      oauth: { clientId: 'client-1', clientSecret: 'secret-1', scope: 'read' },
    })
  })

  it('keeps OAuth disabled as false', () => {
    expect(fromV2McpServerConfig({ type: 'remote', url: 'https://mcp.example.com', oauth: false })).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com',
      oauth: false,
    })
  })

  it('falls back to the execution timeout when catalog is absent', () => {
    expect(
      fromV2McpServerConfig({ type: 'remote', url: 'https://mcp.example.com', timeout: { execution: 9000 } }),
    ).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com',
      timeout: 9000,
    })
  })
})

describe('mcpServersFromConfig', () => {
  it('reads native servers and keeps legacy entries', () => {
    expect(
      mcpServersFromConfig({
        servers: {
          native: { type: 'remote', url: 'https://native.example.com', disabled: true },
        },
        legacy: { type: 'local', command: ['npx', 'legacy'], enabled: false },
      }),
    ).toEqual({
      native: { type: 'remote', url: 'https://native.example.com', enabled: false },
      legacy: { type: 'local', command: ['npx', 'legacy'], enabled: false },
    })
  })

  it('ignores timeout entries and non-server values', () => {
    expect(mcpServersFromConfig({ timeout: { catalog: 5000 }, broken: 'nope' })).toEqual({})
  })

  it('returns an empty map for a missing config', () => {
    expect(mcpServersFromConfig(undefined)).toEqual({})
  })
})

describe('mcpServerConfigFromConfig', () => {
  it('returns the native entry as-is so unknown fields survive', () => {
    const native = {
      type: 'remote',
      url: 'https://native.example.com',
      oauth: { redirect_uri: 'https://manager.example.com/api/mcp-oauth-proxy/callback' },
      protocol: 'auto',
    }

    expect(mcpServerConfigFromConfig({ servers: { native } }, 'native')).toEqual(native)
  })

  it('converts a legacy entry to the native shape', () => {
    expect(
      mcpServerConfigFromConfig({ legacy: { type: 'local', command: ['npx', 'legacy'], timeout: 5000 } }, 'legacy'),
    ).toEqual({
      type: 'local',
      command: ['npx', 'legacy'],
      timeout: { catalog: 5000, execution: 5000 },
    })
  })

  it('returns undefined for unknown servers and missing config', () => {
    expect(mcpServerConfigFromConfig({ servers: {} }, 'missing')).toBeUndefined()
    expect(mcpServerConfigFromConfig(undefined, 'missing')).toBeUndefined()
  })
})

describe('mcpStatusByName', () => {
  it('maps every V2 status onto the Manager status map', () => {
    const servers: McpServer[] = [
      { name: 'connected-server', status: { status: 'connected' }, integrationID: 'int-1' },
      { name: 'pending-server', status: { status: 'pending' } },
      { name: 'disabled-server', status: { status: 'disabled' } },
      { name: 'failed-server', status: { status: 'failed', error: 'connect failed' } },
      { name: 'auth-server', status: { status: 'needs_auth', error: 'login required' } },
    ]

    expect(mcpStatusByName(servers)).toEqual({
      'connected-server': { status: 'connected', integrationID: 'int-1' },
      'pending-server': { status: 'pending' },
      'disabled-server': { status: 'disabled' },
      'failed-server': { status: 'failed', error: 'connect failed' },
      'auth-server': { status: 'needs_auth', error: 'login required' },
    })
  })

  it('returns an empty map for no servers', () => {
    expect(mcpStatusByName([])).toEqual({})
  })
})
