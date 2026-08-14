import { describe, it, expect } from 'vitest'
import {
  decideSandboxProxyBlock,
  decideSandboxConfigBody,
  decideSandboxMcpAddBody,
  decideSandboxAuthBody,
  decideSandboxMutationBody,
  isSandboxConfigMutation,
  isSandboxMcpAdd,
  isSandboxAuthWrite,
  SANDBOX_CONFIG_MUTATION_REASON_PREFIX,
} from '../../../src/services/opencode/proxy-policy'

describe('sandbox proxy policy', () => {
  it('passes every route through when enforcement is off', () => {
    expect(decideSandboxProxyBlock(false, 'POST', '/session/s1/shell')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(false, 'POST', '/pty')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(false, 'POST', '/session/s1/command')).toEqual({ blocked: false })
  })

  it('forwards the session shell endpoint when enforced', () => {
    expect(decideSandboxProxyBlock(true, 'POST', '/session/ses_1/shell')).toEqual({ blocked: false })
  })

  it('forwards custom slash command execution when enforced', () => {
    expect(decideSandboxProxyBlock(true, 'POST', '/session/ses_1/command')).toEqual({ blocked: false })
  })

  it('blocks PTY creation and connection when enforced', () => {
    expect(decideSandboxProxyBlock(true, 'POST', '/pty').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'GET', '/pty/p1/connect').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'POST', '/pty/p1/connect').blocked).toBe(true)
  })

  it('treats /api-prefixed execution routes identically to unprefixed routes when enforced', () => {
    expect(decideSandboxProxyBlock(true, 'POST', '/api/pty').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'GET', '/api/pty/p1/connect').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'POST', '/api/session/ses_1/shell')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(true, 'POST', '/api/session/ses_1/command')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(true, 'POST', '/api/p%74y').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'GET', '/api/session')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(true, 'GET', '/api/pty/p1')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(true, 'GET', '/api/session/ses_1/message')).toEqual({ blocked: false })
  })

  it('fails closed on encoded separators inside the /api prefix when enforced', () => {
    expect(decideSandboxProxyBlock(true, 'POST', '/api%2Fpty').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'POST', '/api%2Fpty/p1/connect').blocked).toBe(true)
  })

  it('classifies /api-prefixed config, mcp, and auth writes identically when enforced', () => {
    expect(isSandboxConfigMutation(true, 'PATCH', '/api/config')).toBe(true)
    expect(isSandboxConfigMutation(true, 'PATCH', '/api/%63onfig')).toBe(true)
    expect(isSandboxConfigMutation(true, 'PATCH', '/api/config/')).toBe(false)
    expect(isSandboxMcpAdd(true, 'POST', '/api/mcp')).toBe(true)
    expect(isSandboxMcpAdd(true, 'POST', '/api/mcp/')).toBe(false)
    expect(isSandboxAuthWrite(true, 'PUT', '/api/auth/openai')).toBe(true)
    expect(isSandboxAuthWrite(true, 'PUT', '/api/auth/openai/extra')).toBe(false)
  })

  it('leaves non-execution routes reachable when enforced', () => {
    expect(decideSandboxProxyBlock(true, 'GET', '/session')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(true, 'GET', '/session/ses_1/message')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(true, 'GET', '/pty/p1')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(true, 'DELETE', '/pty/p1')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(true, 'GET', '/config')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(true, 'POST', '/session/ses_1/prompt_async')).toEqual({ blocked: false })
  })

  it('ignores methods that do not match a blocked route', () => {
    expect(decideSandboxProxyBlock(true, 'GET', '/session/ses_1/shell')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(true, 'GET', '/pty')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(true, 'GET', '/session/ses_1/command')).toEqual({ blocked: false })
  })

  it('blocks percent-encoded spellings of blocked routes when enforced', () => {
    expect(decideSandboxProxyBlock(true, 'POST', '/%70ty').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'POST', '/pty/%70%31/connect').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'POST', '/p%74y/p1/connect').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'POST', '/p%74y').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'GET', '/p%74y/ses_1/connect').blocked).toBe(true)
  })

  it('fails closed on encoded separators, double-encoded, control, and malformed paths when enforced', () => {
    expect(decideSandboxProxyBlock(true, 'POST', '/pty%2F..').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'POST', '/pty%2Fp1').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'POST', '/pty%5Cx').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'POST', '/%2570ty').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'POST', '/pty%00').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'POST', '/pty%zz').blocked).toBe(true)
    expect(decideSandboxProxyBlock(true, 'POST', '/p%c0%ae').blocked).toBe(true)
  })

  it('passes safely encoded non-execution paths through when enforced', () => {
    expect(decideSandboxProxyBlock(true, 'GET', '/session/ses_1/%6dessage')).toEqual({ blocked: false })
    expect(decideSandboxProxyBlock(true, 'POST', '/session/ses_1/prompt%5Fasync')).toEqual({ blocked: false })
  })

  it('classifies only enforced PATCH /config as a config mutation', () => {
    expect(isSandboxConfigMutation(true, 'PATCH', '/config')).toBe(true)
    expect(isSandboxConfigMutation(true, 'PATCH', '/%63onfig')).toBe(true)
    expect(isSandboxConfigMutation(true, 'PATCH', '/config/')).toBe(false)
    expect(isSandboxConfigMutation(true, 'PATCH', '/project')).toBe(false)
    expect(isSandboxConfigMutation(true, 'POST', '/config')).toBe(false)
    expect(isSandboxConfigMutation(true, 'GET', '/config')).toBe(false)
    expect(isSandboxConfigMutation(false, 'PATCH', '/config')).toBe(false)
  })

  it('passes non-config mutation bodies through untouched', () => {
    expect(decideSandboxConfigBody(true, 'GET', '/config', '')).toEqual({ kind: 'passthrough' })
    expect(decideSandboxConfigBody(true, 'POST', '/config', '{}')).toEqual({ kind: 'passthrough' })
    expect(decideSandboxConfigBody(true, 'PATCH', '/session/s1/message', '{}')).toEqual({ kind: 'passthrough' })
    expect(decideSandboxConfigBody(false, 'PATCH', '/config', '{}')).toEqual({ kind: 'passthrough' })
  })

  it('strips configured plugins from an enforced config mutation', () => {
    const decision = decideSandboxConfigBody(true, 'PATCH', '/config', JSON.stringify({
      theme: 'dark',
      plugin: ['opencode-plugin-npm'],
      mcp: { remote: { type: 'remote', url: 'https://example.com' } },
    }))
    expect(decision.kind).toBe('sanitized')
    if (decision.kind === 'sanitized') {
      const body = JSON.parse(decision.body) as Record<string, unknown>
      expect(body.theme).toBe('dark')
      expect(body.plugin).toBeUndefined()
      expect(body.mcp).toEqual({ remote: { type: 'remote', url: 'https://example.com' } })
    }
  })

  it('strips local MCP servers and formatter config from an enforced config mutation', () => {
    const decision = decideSandboxConfigBody(true, 'PATCH', '/config', JSON.stringify({
      formatter: { command: 'prettier' },
      mcp: { local: { type: 'local', command: ['node', 'server.js'] }, remote: { type: 'remote', url: 'https://example.com' } },
    }))
    expect(decision.kind).toBe('sanitized')
    if (decision.kind === 'sanitized') {
      const body = JSON.parse(decision.body) as Record<string, unknown>
      expect(body.formatter).toBeUndefined()
      expect(body.mcp).toEqual({ remote: { type: 'remote', url: 'https://example.com' } })
    }
  })

  it('leaves a config mutation with no host-execution sections unchanged when enforced', () => {
    const decision = decideSandboxConfigBody(true, 'PATCH', '/config', JSON.stringify({ theme: 'dark' }))
    expect(decision).toEqual({ kind: 'sanitized', body: JSON.stringify({ theme: 'dark' }) })
  })

  it('fails closed on malformed or non-object config mutation bodies when enforced', () => {
    const invalidJson = decideSandboxConfigBody(true, 'PATCH', '/config', '{not json')
    expect(invalidJson.kind).toBe('reject')
    if (invalidJson.kind === 'reject') {
      expect(invalidJson.reason).toContain(SANDBOX_CONFIG_MUTATION_REASON_PREFIX)
    }

    const emptyBody = decideSandboxConfigBody(true, 'PATCH', '/config', '')
    expect(emptyBody.kind).toBe('reject')

    const arrayBody = decideSandboxConfigBody(true, 'PATCH', '/config', '[]')
    expect(arrayBody.kind).toBe('reject')
  })

  it('strips LSP servers and experimental hook commands from an enforced config mutation', () => {
    const decision = decideSandboxConfigBody(true, 'PATCH', '/config', JSON.stringify({
      lsp: { typescript: { command: ['typescript-language-server', '--stdio'] } },
      experimental: {
        hook: { file_edited: [{ command: ['chmod', '+x', 'script.sh'] }] },
        chatMaxRetries: 4,
      },
      model: 'x',
    }))
    expect(decision.kind).toBe('sanitized')
    if (decision.kind === 'sanitized') {
      const body = JSON.parse(decision.body) as Record<string, unknown>
      expect(body.lsp).toBeUndefined()
      expect(body.experimental).toEqual({ chatMaxRetries: 4 })
      expect(body.model).toBe('x')
    }
  })

  it('strips the shell configuration from an enforced config mutation', () => {
    const decision = decideSandboxConfigBody(true, 'PATCH', '/config', JSON.stringify({
      shell: { command: '/repo/bin/evil-shell', args: [] },
      model: 'x',
    }))
    expect(decision.kind).toBe('sanitized')
    if (decision.kind === 'sanitized') {
      const body = JSON.parse(decision.body) as Record<string, unknown>
      expect(body.shell).toBeUndefined()
      expect(body.model).toBe('x')
    }
  })

  it('strips an enabling lsp boolean from an enforced config mutation while keeping an explicit false', () => {
    const enabled = decideSandboxConfigBody(true, 'PATCH', '/config', JSON.stringify({ lsp: true, model: 'x' }))
    expect(enabled.kind).toBe('sanitized')
    if (enabled.kind === 'sanitized') {
      expect(JSON.parse(enabled.body)).toEqual({ model: 'x' })
    }

    const disabled = decideSandboxConfigBody(true, 'PATCH', '/config', JSON.stringify({ lsp: false, model: 'x' }))
    expect(disabled).toEqual({ kind: 'sanitized', body: JSON.stringify({ lsp: false, model: 'x' }) })
  })

  it('drops the experimental section entirely when only its hook carries commands', () => {
    const decision = decideSandboxConfigBody(true, 'PATCH', '/config', JSON.stringify({
      experimental: { hook: { session_completed: [{ command: ['echo', 'done'] }] } },
    }))
    expect(decision.kind).toBe('sanitized')
    if (decision.kind === 'sanitized') {
      const body = JSON.parse(decision.body) as Record<string, unknown>
      expect(body.experimental).toBeUndefined()
    }
  })

  it('classifies only enforced POST /mcp as an MCP add', () => {
    expect(isSandboxMcpAdd(true, 'POST', '/mcp')).toBe(true)
    expect(isSandboxMcpAdd(true, 'POST', '/%6dcp')).toBe(true)
    expect(isSandboxMcpAdd(true, 'POST', '/mcp/')).toBe(false)
    expect(isSandboxMcpAdd(true, 'POST', '/mcp/my-server/connect')).toBe(false)
    expect(isSandboxMcpAdd(true, 'GET', '/mcp')).toBe(false)
    expect(isSandboxMcpAdd(true, 'DELETE', '/mcp')).toBe(false)
    expect(isSandboxMcpAdd(false, 'POST', '/mcp')).toBe(false)
  })

  it('passes non-MCP-add bodies through untouched', () => {
    expect(decideSandboxMcpAddBody(true, 'GET', '/mcp', '')).toEqual({ kind: 'passthrough' })
    expect(decideSandboxMcpAddBody(true, 'POST', '/mcp/my-server/connect', '{}')).toEqual({ kind: 'passthrough' })
    expect(decideSandboxMcpAddBody(false, 'POST', '/mcp', '{}')).toEqual({ kind: 'passthrough' })
  })

  it('rejects a local MCP server add while enforced', () => {
    const decision = decideSandboxMcpAddBody(true, 'POST', '/mcp', JSON.stringify({
      name: 'evil',
      config: { type: 'local', command: ['node', 'server.js'], environment: { TOKEN: 'secret' } },
    }))
    expect(decision.kind).toBe('reject')
    if (decision.kind === 'reject') {
      expect(decision.reason).toContain(SANDBOX_CONFIG_MUTATION_REASON_PREFIX)
      expect(decision.reason).toContain('only remote MCP servers')
    }
  })

  it('rejects a command-bearing MCP add even without an explicit local type while enforced', () => {
    const decision = decideSandboxMcpAddBody(true, 'POST', '/mcp', JSON.stringify({
      name: 'evil',
      config: { command: ['npx', 'evil-server'] },
    }))
    expect(decision.kind).toBe('reject')
  })

  it('passes a provably remote MCP server add through while enforced', () => {
    const decision = decideSandboxMcpAddBody(true, 'POST', '/mcp', JSON.stringify({
      name: 'remote-server',
      config: { type: 'remote', url: 'https://example.com/mcp' },
    }))
    expect(decision).toEqual({ kind: 'passthrough' })
  })

  it('rejects malformed or non-object MCP add bodies while enforced', () => {
    const invalidJson = decideSandboxMcpAddBody(true, 'POST', '/mcp', '{not json')
    expect(invalidJson.kind).toBe('reject')
    if (invalidJson.kind === 'reject') {
      expect(invalidJson.reason).toContain(SANDBOX_CONFIG_MUTATION_REASON_PREFIX)
    }

    const arrayBody = decideSandboxMcpAddBody(true, 'POST', '/mcp', '[]')
    expect(arrayBody.kind).toBe('reject')
  })

  it('dispatches MCP adds before config mutations and leaves other bodies untouched', () => {
    expect(decideSandboxMutationBody(true, 'POST', '/mcp', JSON.stringify({
      name: 'evil',
      config: { type: 'local', command: ['node', 'server.js'] },
    })).kind).toBe('reject')
    expect(decideSandboxMutationBody(true, 'POST', '/mcp', JSON.stringify({
      name: 'remote-server',
      config: { type: 'remote', url: 'https://example.com/mcp' },
    }))).toEqual({ kind: 'passthrough' })
    expect(decideSandboxMutationBody(true, 'PATCH', '/config', JSON.stringify({ theme: 'dark' }))).toEqual({
      kind: 'sanitized',
      body: JSON.stringify({ theme: 'dark' }),
    })
    expect(decideSandboxMutationBody(true, 'POST', '/session/s1/message', '{}')).toEqual({ kind: 'passthrough' })
  })

  it('strips custom provider npm selectors from an enforced config mutation while keeping built-in providers', () => {
    const decision = decideSandboxConfigBody(true, 'PATCH', '/config', JSON.stringify({
      model: 'x',
      provider: {
        'openai-native': { options: { apiKey: 'k' } },
        evil: { npm: 'file:///repo/evil-provider.js', options: { token: 't' } },
        remote: { npm: '@scope/remote-provider', models: { 'm-1': { name: 'M1' } } },
      },
    }))
    expect(decision.kind).toBe('sanitized')
    if (decision.kind === 'sanitized') {
      const body = JSON.parse(decision.body) as Record<string, unknown>
      expect(body.model).toBe('x')
      expect(body.provider).toEqual({ 'openai-native': { options: { apiKey: 'k' } } })
    }
  })

  it('classifies only enforced PUT /auth/{provider} as an auth write', () => {
    expect(isSandboxAuthWrite(true, 'PUT', '/auth/openai')).toBe(true)
    expect(isSandboxAuthWrite(true, 'PUT', '/auth/%6fpenai')).toBe(true)
    expect(isSandboxAuthWrite(true, 'POST', '/auth/openai')).toBe(false)
    expect(isSandboxAuthWrite(true, 'DELETE', '/auth/openai')).toBe(false)
    expect(isSandboxAuthWrite(true, 'GET', '/auth/openai')).toBe(false)
    expect(isSandboxAuthWrite(true, 'PUT', '/auth/openai/extra')).toBe(false)
    expect(isSandboxAuthWrite(false, 'PUT', '/auth/openai')).toBe(false)
  })

  it('passes non-auth-write bodies through untouched', () => {
    expect(decideSandboxAuthBody(true, 'GET', '/auth/openai', '')).toEqual({ kind: 'passthrough' })
    expect(decideSandboxAuthBody(true, 'DELETE', '/auth/openai', '{}')).toEqual({ kind: 'passthrough' })
    expect(decideSandboxAuthBody(true, 'PUT', '/config', '{}')).toEqual({ kind: 'passthrough' })
    expect(decideSandboxAuthBody(false, 'PUT', '/auth/openai', '{}')).toEqual({ kind: 'passthrough' })
  })

  it('rejects a well-known auth write while enforced', () => {
    const decision = decideSandboxAuthBody(true, 'PUT', '/auth/sso.example.com', JSON.stringify({
      type: 'wellknown',
      key: 'SSO_TOKEN',
      token: 't',
    }))
    expect(decision.kind).toBe('reject')
    if (decision.kind === 'reject') {
      expect(decision.reason).toContain(SANDBOX_CONFIG_MUTATION_REASON_PREFIX)
      expect(decision.reason).toContain('well-known')
    }
  })

  it('rejects a malformed or non-object auth write body while enforced', () => {
    const invalidJson = decideSandboxAuthBody(true, 'PUT', '/auth/openai', '{not json')
    expect(invalidJson.kind).toBe('reject')
    if (invalidJson.kind === 'reject') {
      expect(invalidJson.reason).toContain(SANDBOX_CONFIG_MUTATION_REASON_PREFIX)
    }

    const arrayBody = decideSandboxAuthBody(true, 'PUT', '/auth/openai', '[]')
    expect(arrayBody.kind).toBe('reject')
  })

  it('passes api and oauth auth writes through while enforced', () => {
    const api = decideSandboxAuthBody(true, 'PUT', '/auth/anthropic', JSON.stringify({
      type: 'api',
      key: 'sk-test',
    }))
    expect(api).toEqual({ kind: 'passthrough' })

    const oauth = decideSandboxAuthBody(true, 'PUT', '/auth/github', JSON.stringify({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: 1,
    }))
    expect(oauth).toEqual({ kind: 'passthrough' })
  })

  it('dispatches auth writes before config mutations in the combined body decision', () => {
    expect(decideSandboxMutationBody(true, 'PUT', '/auth/evil', JSON.stringify({
      type: 'wellknown',
      key: 'K',
      token: 't',
    })).kind).toBe('reject')
    expect(decideSandboxMutationBody(true, 'PUT', '/auth/openai', JSON.stringify({
      type: 'api',
      key: 'k',
    }))).toEqual({ kind: 'passthrough' })
  })
})
