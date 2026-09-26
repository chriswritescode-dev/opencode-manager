import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { resolveOpenCodeModel } from '../../src/services/opencode-models'

function model(providerID: string, id: string, enabled: boolean = true): ModelInfo {
  return { providerID, id, enabled } as ModelInfo
}

function createClientStub(input: {
  models: ModelInfo[]
  defaultModel?: ModelInfo | null
  listError?: Error
  defaultError?: Error
}): OpenCodeClient {
  return {
    api: {
      model: {
        list: vi.fn(async () => {
          if (input.listError) throw input.listError
          return { location: { directory: '/workspace/repos/sample-project' }, data: input.models }
        }),
        default: vi.fn(async () => {
          if (input.defaultError) throw input.defaultError
          return { location: { directory: '/workspace/repos/sample-project' }, data: input.defaultModel ?? null }
        }),
      },
    },
  } as unknown as OpenCodeClient
}

describe('resolveOpenCodeModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the preferred model when it is available', async () => {
    const client = createClientStub({
      models: [model('openai', 'gpt-5'), model('openai', 'gpt-5-mini')],
      defaultModel: model('openai', 'gpt-5-mini'),
    })

    const result = await resolveOpenCodeModel(client, '/workspace/repos/sample-project', {
      preferredModel: 'openai/gpt-5',
    })

    expect(result).toEqual({
      providerID: 'openai',
      id: 'gpt-5',
      model: 'openai/gpt-5',
    })
  })

  it('preserves the variant of a preferred model reference', async () => {
    const client = createClientStub({
      models: [model('openai', 'gpt-5')],
    })

    const result = await resolveOpenCodeModel(client, '/workspace/repos/sample-project', {
      preferredModel: 'openai/gpt-5#high',
    })

    expect(result).toEqual({
      providerID: 'openai',
      id: 'gpt-5',
      variant: 'high',
      model: 'openai/gpt-5#high',
    })
  })

  it('keeps slashes inside the model id when parsing the preferred model', async () => {
    const client = createClientStub({
      models: [model('openrouter', 'anthropic/claude-sonnet-4')],
    })

    const result = await resolveOpenCodeModel(client, '/workspace/repos/sample-project', {
      preferredModel: 'openrouter/anthropic/claude-sonnet-4',
    })

    expect(result).toEqual({
      providerID: 'openrouter',
      id: 'anthropic/claude-sonnet-4',
      model: 'openrouter/anthropic/claude-sonnet-4',
    })
  })

  it('falls back to the OpenCode default model when the preferred model is unavailable', async () => {
    const client = createClientStub({
      models: [model('openai', 'gpt-5'), model('openai', 'gpt-5-mini')],
      defaultModel: model('openai', 'gpt-5-mini'),
    })

    const result = await resolveOpenCodeModel(client, '/workspace/repos/sample-project', {
      preferredModel: 'openai/retired',
    })

    expect(result).toEqual({
      providerID: 'openai',
      id: 'gpt-5-mini',
      model: 'openai/gpt-5-mini',
    })
  })

  it('falls back to the first enabled model when the default model is unavailable', async () => {
    const client = createClientStub({
      models: [model('openai', 'gpt-5'), model('anthropic', 'claude-sonnet-4')],
      defaultModel: model('openai', 'retired'),
    })

    const result = await resolveOpenCodeModel(client, '/workspace/repos/sample-project', {
      preferredModel: 'openai/retired',
    })

    expect(result).toEqual({
      providerID: 'openai',
      id: 'gpt-5',
      model: 'openai/gpt-5',
    })
  })

  it('skips disabled models when choosing the first enabled entry', async () => {
    const client = createClientStub({
      models: [model('openai', 'gpt-5', false), model('anthropic', 'claude-sonnet-4')],
    })

    const result = await resolveOpenCodeModel(client, '/workspace/repos/sample-project')

    expect(result).toEqual({
      providerID: 'anthropic',
      id: 'claude-sonnet-4',
      model: 'anthropic/claude-sonnet-4',
    })
  })

  it('throws when no enabled models are available', async () => {
    const client = createClientStub({ models: [model('openai', 'gpt-5', false)] })

    await expect(resolveOpenCodeModel(client, '/workspace/repos/sample-project')).rejects.toThrow(
      'No configured OpenCode models are available',
    )
  })

  it('ignores a malformed preferred model reference and falls back to the default', async () => {
    const client = createClientStub({
      models: [model('openai', 'gpt-5')],
      defaultModel: model('openai', 'gpt-5'),
    })

    const result = await resolveOpenCodeModel(client, '/workspace/repos/sample-project', {
      preferredModel: 'openai',
    })

    expect(result).toEqual({
      providerID: 'openai',
      id: 'gpt-5',
      model: 'openai/gpt-5',
    })
  })
})
