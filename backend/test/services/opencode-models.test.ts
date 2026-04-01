import { beforeEach, describe, expect, it, vi } from 'vitest'

const { proxyToOpenCodeWithDirectory } = vi.hoisted(() => ({
  proxyToOpenCodeWithDirectory: vi.fn(),
}))

vi.mock('../../src/services/proxy', () => ({
  proxyToOpenCodeWithDirectory,
}))

import { resolveOpenCodeModel } from '../../src/services/opencode-models'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('resolveOpenCodeModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the preferred model when it is available', async () => {
    proxyToOpenCodeWithDirectory.mockImplementation((path: string) => {
      if (path === '/config') {
        return Promise.resolve(jsonResponse({ model: 'openai/gpt-5' }))
      }

      return Promise.resolve(jsonResponse({
        providers: [
          { id: 'openai', models: { 'gpt-5': {}, 'gpt-5-mini': {} } },
        ],
        default: { openai: 'gpt-5-mini' },
      }))
    })

    const result = await resolveOpenCodeModel('/workspace/repos/sample-project', {
      preferredModel: 'openai/gpt-5',
    })

    expect(result).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5',
      model: 'openai/gpt-5',
    })
  })

  it('falls back to the provider default when the preferred model is unavailable', async () => {
    proxyToOpenCodeWithDirectory.mockImplementation((path: string) => {
      if (path === '/config') {
        return Promise.resolve(jsonResponse({ model: 'openai/gpt-5.4' }))
      }

      return Promise.resolve(jsonResponse({
        providers: [
          { id: 'openai', models: { 'gpt-5.3-codex-spark': {}, 'gpt-5-mini': {} } },
        ],
        default: { openai: 'gpt-5.3-codex-spark' },
      }))
    })

    const result = await resolveOpenCodeModel('/workspace/repos/sample-project', {
      preferredModel: 'openai/gpt-5.4',
    })

    expect(result).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5.3-codex-spark',
      model: 'openai/gpt-5.3-codex-spark',
    })
  })

  it('prefers the configured small model when requested', async () => {
    proxyToOpenCodeWithDirectory.mockImplementation((path: string) => {
      if (path === '/config') {
        return Promise.resolve(jsonResponse({
          model: 'openai/gpt-5',
          small_model: 'openai/gpt-5-mini',
        }))
      }

      return Promise.resolve(jsonResponse({
        providers: [
          { id: 'openai', models: { 'gpt-5': {}, 'gpt-5-mini': {} } },
        ],
        default: { openai: 'gpt-5' },
      }))
    })

    const result = await resolveOpenCodeModel('/workspace/repos/sample-project', {
      preferSmallModel: true,
    })

    expect(result).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5-mini',
      model: 'openai/gpt-5-mini',
    })
  })

  it('falls back to the first available model when defaults are missing', async () => {
    proxyToOpenCodeWithDirectory.mockImplementation((path: string) => {
      if (path === '/config') {
        return Promise.resolve(jsonResponse({}))
      }

      return Promise.resolve(jsonResponse({
        providers: [
          { id: 'anthropic', models: { 'claude-sonnet-4': {}, 'claude-haiku-4': {} } },
        ],
      }))
    })

    const result = await resolveOpenCodeModel('/workspace/repos/sample-project')

    expect(result).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4',
      model: 'anthropic/claude-sonnet-4',
    })
  })

  it('throws when no configured models are available', async () => {
    proxyToOpenCodeWithDirectory.mockImplementation((path: string) => {
      if (path === '/config') {
        return Promise.resolve(jsonResponse({ model: 'openai/gpt-5' }))
      }

      return Promise.resolve(jsonResponse({ providers: [], default: {} }))
    })

    await expect(resolveOpenCodeModel('/workspace/repos/sample-project')).rejects.toThrow(
      'No configured OpenCode models are available',
    )
  })
})
