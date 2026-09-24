import { describe, expect, it } from 'vitest'
import {
  MCP_OAUTH_CALLBACK_PATH,
  mcpOAuthRedirectUri,
  mcpServersFromConfig,
  mcpStatusByName,
} from '@opencode-manager/shared/opencode'
import type { McpServer } from '@opencode-manager/shared/opencode'

describe('mcpOAuthRedirectUri', () => {
  it('builds the Manager callback on the given origin', () => {
    expect(mcpOAuthRedirectUri('https://manager.example.com')).toBe(
      `https://manager.example.com${MCP_OAUTH_CALLBACK_PATH}`,
    )
  })
})

describe('mcpServersFromConfig', () => {
  it('returns native servers as-is so every V2 field survives', () => {
    const remote = {
      type: 'remote',
      url: 'https://native.example.com',
      oauth: { client_id: 'client', redirect_uri: `https://manager.example.com${MCP_OAUTH_CALLBACK_PATH}` },
      disabled: true,
      codemode: true,
      protocol: 'auto',
      timeout: { startup: 1000, catalog: 2000, execution: 3000 },
    }
    const local = { type: 'local', command: ['npx', 'server'], cwd: '/tmp', environment: { KEY: 'value' } }

    expect(mcpServersFromConfig({ servers: { remote, local } })).toEqual({ remote, local })
  })

  it('ignores legacy flat entries, the timeout section, and invalid servers', () => {
    expect(
      mcpServersFromConfig({
        timeout: { catalog: 5000 },
        legacy: { type: 'local', command: ['npx', 'legacy'], enabled: false },
        servers: { broken: 'nope', untyped: { url: 'https://example.com' } },
      }),
    ).toEqual({})
  })

  it('returns an empty map for a missing config', () => {
    expect(mcpServersFromConfig(undefined)).toEqual({})
    expect(mcpServersFromConfig({ servers: [] })).toEqual({})
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
