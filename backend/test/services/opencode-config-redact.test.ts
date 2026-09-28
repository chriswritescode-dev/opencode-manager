import { describe, expect, it } from 'vitest'
import { redactOpenCodeConfigFile } from '../../src/services/opencode-config-redact'
import type { OpenCodeConfigFile } from '../../src/types/settings'

function buildConfig(content: Record<string, unknown>): OpenCodeConfigFile {
  return {
    path: '/config/opencode.jsonc',
    content,
    rawContent: JSON.stringify(content),
    isValid: true,
    updatedAt: 1,
    sources: [
      {
        name: 'opencode.jsonc',
        path: '/config/opencode.jsonc',
        content,
        rawContent: JSON.stringify(content),
        isValid: true,
        updatedAt: 1,
      },
    ],
    revision: 'revision',
  }
}

describe('redactOpenCodeConfigFile', () => {
  it('redacts secret-keyed values and every header and environment value while keeping keys', () => {
    const redacted = redactOpenCodeConfigFile(
      buildConfig({
        theme: 'dark',
        providers: { example: { apiKey: 'secret-key', label: 'Example' } },
        mcp: {
          servers: {
            linear: {
              type: 'remote',
              url: 'https://linear.example.com',
              headers: { Authorization: 'Bearer secret', 'X-Trace': 'trace' },
            },
            local: { type: 'local', command: ['npx', 'server'], environment: { GITHUB_TOKEN: 'token', NODE_ENV: 'production' } },
          },
        },
      }),
    )

    expect(redacted.content).toEqual({
      theme: 'dark',
      providers: { example: { apiKey: '<redacted>', label: 'Example' } },
      mcp: {
        servers: {
          linear: {
            type: 'remote',
            url: 'https://linear.example.com',
            headers: { Authorization: '<redacted>', 'X-Trace': '<redacted>' },
          },
          local: {
            type: 'local',
            command: ['npx', 'server'],
            environment: { GITHUB_TOKEN: '<redacted>', NODE_ENV: '<redacted>' },
          },
        },
      },
    })
    expect(redacted.redactedPaths).toEqual([
      'mcp.servers.linear.headers.Authorization',
      'mcp.servers.linear.headers.X-Trace',
      'mcp.servers.local.environment.GITHUB_TOKEN',
      'mcp.servers.local.environment.NODE_ENV',
      'providers.example.apiKey',
    ])
  })

  it('drops the raw source text and redacts each source content', () => {
    const redacted = redactOpenCodeConfigFile(buildConfig({ providers: { example: { apiKey: 'secret' } } }))
    const [source] = redacted.sources

    expect('rawContent' in redacted).toBe(false)
    expect(redacted.content).toEqual({ providers: { example: { apiKey: '<redacted>' } } })
    expect(redacted.redactedPaths).toEqual(['providers.example.apiKey'])
    expect(source?.content).toEqual({ providers: { example: { apiKey: '<redacted>' } } })
    expect(source && 'rawContent' in source).toBe(false)
  })

  it('leaves a config without secrets unchanged', () => {
    const redacted = redactOpenCodeConfigFile(buildConfig({ theme: 'dark', plugin: ['/plugins/probe'] }))

    expect(redacted.content).toEqual({ theme: 'dark', plugin: ['/plugins/probe'] })
    expect(redacted.redactedPaths).toEqual([])
  })

  it('leaves numeric token settings untouched', () => {
    const redacted = redactOpenCodeConfigFile(
      buildConfig({ maxTokens: 8192, budgetTokens: 4096, max_tokens: 2048 }),
    )

    expect(redacted.content).toEqual({ maxTokens: 8192, budgetTokens: 4096, max_tokens: 2048 })
    expect(redacted.redactedPaths).toEqual([])
  })

  it('does not mask server, provider, or model names that look like secret keys', () => {
    const redacted = redactOpenCodeConfigFile(
      buildConfig({
        mcp: {
          servers: {
            'github-token': {
              type: 'remote',
              url: 'https://github.example.com',
              headers: { Authorization: 'Bearer secret' },
            },
          },
        },
        provider: {
          'secret-provider': {
            apiKey: 'provider-secret',
            models: { 'token-model': { name: 'gpt' } },
          },
        },
      }),
    )

    expect(redacted.content).toEqual({
      mcp: {
        servers: {
          'github-token': {
            type: 'remote',
            url: 'https://github.example.com',
            headers: { Authorization: '<redacted>' },
          },
        },
      },
      provider: {
        'secret-provider': {
          apiKey: '<redacted>',
          models: { 'token-model': { name: 'gpt' } },
        },
      },
    })
    expect(redacted.redactedPaths).toEqual([
      'mcp.servers.github-token.headers.Authorization',
      'provider.secret-provider.apiKey',
    ])
  })

  it('leaves non-string secret-keyed values untouched', () => {
    const redacted = redactOpenCodeConfigFile(
      buildConfig({ password: 1234, token: true, secret: null }),
    )

    expect(redacted.content).toEqual({ password: 1234, token: true, secret: null })
    expect(redacted.redactedPaths).toEqual([])
  })
})
