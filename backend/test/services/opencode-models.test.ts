import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { resolveOpenCodeModel } from '../../src/services/opencode-models'

describe('resolveOpenCodeModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the preferred model when it is available', async () => {
    const mockClient = {
      getJson: vi.fn().mockImplementation((path: string) => {
        if (path === '/config') {
          return Promise.resolve({ model: 'openai/gpt-5' })
        }
        if (path === '/config/providers') {
          return Promise.resolve({
            providers: [
              { id: 'openai', models: { 'gpt-5': {}, 'gpt-5-mini': {} } },
            ],
            default: { openai: 'gpt-5-mini' },
          })
        }
        throw new Error(`Unexpected path: ${path}`)
      }),
    } as unknown as OpenCodeClient

    const result = await resolveOpenCodeModel(mockClient, '/workspace/repos/sample-project', {
      preferredModel: 'openai/gpt-5',
    })

    expect(result).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5',
      model: 'openai/gpt-5',
    })
  })

  it('falls back to the provider default when the preferred model is unavailable', async () => {
    const mockClient = {
      getJson: vi.fn().mockImplementation((path: string) => {
        if (path === '/config') {
          return Promise.resolve({ model: 'openai/gpt-5.4' })
        }
        if (path === '/config/providers') {
          return Promise.resolve({
            providers: [
              { id: 'openai', models: { 'gpt-5.3-codex-spark': {}, 'gpt-5-mini': {} } },
            ],
            default: { openai: 'gpt-5.3-codex-spark' },
          })
        }
        throw new Error(`Unexpected path: ${path}`)
      }),
    } as unknown as OpenCodeClient

    const result = await resolveOpenCodeModel(mockClient, '/workspace/repos/sample-project', {
      preferredModel: 'openai/gpt-5.4',
    })

    expect(result).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5.3-codex-spark',
      model: 'openai/gpt-5.3-codex-spark',
    })
  })

  it('prefers the configured small model when requested', async () => {
    const mockClient = {
      getJson: vi.fn().mockImplementation((path: string) => {
        if (path === '/config') {
          return Promise.resolve({
            model: 'openai/gpt-5',
            small_model: 'openai/gpt-5-mini',
          })
        }
        if (path === '/config/providers') {
          return Promise.resolve({
            providers: [
              { id: 'openai', models: { 'gpt-5': {}, 'gpt-5-mini': {} } },
            ],
            default: { openai: 'gpt-5' },
          })
        }
        throw new Error(`Unexpected path: ${path}`)
      }),
    } as unknown as OpenCodeClient

    const result = await resolveOpenCodeModel(mockClient, '/workspace/repos/sample-project', {
      preferSmallModel: true,
    })

    expect(result).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5-mini',
      model: 'openai/gpt-5-mini',
    })
  })

  it('falls back to config.model when small_model is unavailable', async () => {
    const mockClient = {
      getJson: vi.fn().mockImplementation((path: string) => {
        if (path === '/config') {
          return Promise.resolve({
            model: 'openai/gpt-5',
            small_model: 'openai/gpt-5-unavailable',
          })
        }
        if (path === '/config/providers') {
          return Promise.resolve({
            providers: [
              { id: 'openai', models: { 'gpt-5': {}, 'gpt-5-mini': {} } },
            ],
            default: { openai: 'gpt-5-mini' },
          })
        }
        throw new Error(`Unexpected path: ${path}`)
      }),
    } as unknown as OpenCodeClient

    const result = await resolveOpenCodeModel(mockClient, '/workspace/repos/sample-project', {
      preferSmallModel: true,
    })

    expect(result).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5',
      model: 'openai/gpt-5',
    })
  })

  it('falls back to provider default only after all configured candidates fail', async () => {
    const mockClient = {
      getJson: vi.fn().mockImplementation((path: string) => {
        if (path === '/config') {
          return Promise.resolve({
            model: 'openai/gpt-5-configured',
            small_model: 'openai/gpt-5-small-unavailable',
          })
        }
        if (path === '/config/providers') {
          return Promise.resolve({
            providers: [
              { id: 'openai', models: { 'gpt-5-mini': {}, 'gpt-5-turbo': {}, 'gpt-5-configured': {} } },
            ],
            default: { openai: 'gpt-5-mini' },
          })
        }
        throw new Error(`Unexpected path: ${path}`)
      }),
    } as unknown as OpenCodeClient

    const result = await resolveOpenCodeModel(mockClient, '/workspace/repos/sample-project', {
      preferSmallModel: true,
    })

    expect(result).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5-configured',
      model: 'openai/gpt-5-configured',
    })
  })

  it('falls back to provider default when both small_model and model are unavailable', async () => {
    const mockClient = {
      getJson: vi.fn().mockImplementation((path: string) => {
        if (path === '/config') {
          return Promise.resolve({
            model: 'openai/gpt-5-unavailable',
            small_model: 'openai/gpt-5-also-unavailable',
          })
        }
        if (path === '/config/providers') {
          return Promise.resolve({
            providers: [
              { id: 'openai', models: { 'gpt-5-mini': {}, 'gpt-5-turbo': {} } },
            ],
            default: { openai: 'gpt-5-mini' },
          })
        }
        throw new Error(`Unexpected path: ${path}`)
      }),
    } as unknown as OpenCodeClient

    const result = await resolveOpenCodeModel(mockClient, '/workspace/repos/sample-project', {
      preferSmallModel: true,
    })

    expect(result).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5-mini',
      model: 'openai/gpt-5-mini',
    })
  })

  it('falls back to the first available model when defaults are missing', async () => {
    const mockClient = {
      getJson: vi.fn().mockImplementation((path: string) => {
        if (path === '/config') {
          return Promise.resolve({})
        }
        if (path === '/config/providers') {
          return Promise.resolve({
            providers: [
              { id: 'anthropic', models: { 'claude-sonnet-4': {}, 'claude-haiku-4': {} } },
            ],
          })
        }
        throw new Error(`Unexpected path: ${path}`)
      }),
    } as unknown as OpenCodeClient

    const result = await resolveOpenCodeModel(mockClient, '/workspace/repos/sample-project')

    expect(result).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4',
      model: 'anthropic/claude-sonnet-4',
    })
  })

  it('throws when no configured models are available', async () => {
    const mockClient = {
      getJson: vi.fn().mockImplementation((path: string) => {
        if (path === '/config') {
          return Promise.resolve({ model: 'openai/gpt-5' })
        }
        if (path === '/config/providers') {
          return Promise.resolve({ providers: [], default: {} })
        }
        throw new Error(`Unexpected path: ${path}`)
      }),
    } as unknown as OpenCodeClient

    await expect(resolveOpenCodeModel(mockClient, '/workspace/repos/sample-project')).rejects.toThrow(
      'No configured OpenCode models are available',
    )
  })
})
