import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigEntry, ModelInfo, OpenCodeApi } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import {
  MODEL_LOAD_POLL_MS,
  MODEL_LOAD_TIMEOUT_MS,
  resolveOpenCodeModel,
} from '../../src/services/opencode-models'
import { createStubOpenCodeClient, modelInfo } from '../helpers/stub-opencode-client'

const DIR = '/workspace/repos/sample-project'
const LOCATION = { directory: DIR }

function model(providerID: string, id: string, enabled: boolean = true): ModelInfo {
  return modelInfo({ providerID, id, modelID: id, enabled })
}

function configEntry(modelRef: string): ConfigEntry {
  return { type: 'document', info: { model: modelRef } }
}

interface ClientStubInput {
  models: ModelInfo[]
  defaultModel?: ModelInfo | null
  configEntries?: ConfigEntry[]
  listError?: Error
  defaultError?: Error
  configError?: Error
}

function createdClient(input: ClientStubInput): OpenCodeClient {
  return createStubOpenCodeClient({
    api: {
      model: {
        list: vi.fn<OpenCodeApi['model']['list']>(async () => {
          if (input.listError) throw input.listError
          return { location: LOCATION, data: input.models }
        }),
        default: vi.fn<OpenCodeApi['model']['default']>(async () => {
          if (input.defaultError) throw input.defaultError
          return { location: LOCATION, data: input.defaultModel ?? null }
        }),
      },
      config: {
        get: vi.fn<OpenCodeApi['config']['get']>(async () => {
          if (input.configError) throw input.configError
          return input.configEntries ?? []
        }),
      },
    },
  })
}

function createStalledListClient(): OpenCodeClient {
  return createStubOpenCodeClient({
    api: {
      model: {
        list: vi.fn<OpenCodeApi['model']['list']>((_input, requestOptions) =>
          new Promise((_resolve, reject) => {
            const signal = requestOptions?.signal
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })),
        default: vi.fn<OpenCodeApi['model']['default']>(async () => ({ location: LOCATION, data: null })),
      },
      config: {
        get: vi.fn<OpenCodeApi['config']['get']>(async () => []),
      },
    },
  })
}

describe('resolveOpenCodeModel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the preferred model when it is available', async () => {
    const client = createdClient({
      models: [model('openai', 'gpt-5'), model('openai', 'gpt-5-mini')],
      defaultModel: model('openai', 'gpt-5-mini'),
    })

    const result = await resolveOpenCodeModel(client, DIR, { preferredModel: 'openai/gpt-5' })

    expect(result).toEqual({ providerID: 'openai', id: 'gpt-5', model: 'openai/gpt-5' })
  })

  it('preserves the variant of a preferred model reference', async () => {
    const client = createdClient({ models: [model('openai', 'gpt-5')] })

    const result = await resolveOpenCodeModel(client, DIR, { preferredModel: 'openai/gpt-5#high' })

    expect(result).toEqual({ providerID: 'openai', id: 'gpt-5', variant: 'high', model: 'openai/gpt-5#high' })
  })

  it('keeps slashes inside the model id when parsing the preferred model', async () => {
    const client = createdClient({ models: [model('openrouter', 'anthropic/claude-sonnet-4')] })

    const result = await resolveOpenCodeModel(client, DIR, {
      preferredModel: 'openrouter/anthropic/claude-sonnet-4',
    })

    expect(result).toEqual({
      providerID: 'openrouter',
      id: 'anthropic/claude-sonnet-4',
      model: 'openrouter/anthropic/claude-sonnet-4',
    })
  })

  it('falls back to the OpenCode default model when the preferred model is unavailable', async () => {
    const client = createdClient({
      models: [model('openai', 'gpt-5'), model('openai', 'gpt-5-mini')],
      defaultModel: model('openai', 'gpt-5-mini'),
    })

    const promise = resolveOpenCodeModel(client, DIR, { preferredModel: 'openai/retired' })
    const assertion = expect(promise).resolves.toEqual({
      providerID: 'openai',
      id: 'gpt-5-mini',
      model: 'openai/gpt-5-mini',
    })
    await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS + MODEL_LOAD_POLL_MS)
    await assertion
  })

  it('falls back to the first enabled model when the default model is unavailable', async () => {
    const client = createdClient({
      models: [model('openai', 'gpt-5'), model('anthropic', 'claude-sonnet-4')],
      defaultModel: model('openai', 'retired'),
    })

    const promise = resolveOpenCodeModel(client, DIR, { preferredModel: 'openai/retired' })
    const assertion = expect(promise).resolves.toEqual({
      providerID: 'openai',
      id: 'gpt-5',
      model: 'openai/gpt-5',
    })
    await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS + MODEL_LOAD_POLL_MS)
    await assertion
  })

  it('skips disabled models when choosing the first enabled entry', async () => {
    const client = createdClient({
      models: [model('openai', 'gpt-5', false), model('anthropic', 'claude-sonnet-4')],
    })

    const result = await resolveOpenCodeModel(client, DIR)

    expect(result).toEqual({ providerID: 'anthropic', id: 'claude-sonnet-4', model: 'anthropic/claude-sonnet-4' })
  })

  it('throws when no enabled models are available', async () => {
    const client = createdClient({ models: [model('openai', 'gpt-5', false)] })

    const promise = resolveOpenCodeModel(client, DIR)
    const assertion = expect(promise).rejects.toThrow('No configured OpenCode models are available')
    await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS + MODEL_LOAD_POLL_MS)
    await assertion
  })

  it('waits for the preferred model while the server loads the directory catalog', async () => {
    let listCalls = 0
    const client = createStubOpenCodeClient({
      api: {
        model: {
          list: vi.fn<OpenCodeApi['model']['list']>(async () => {
            listCalls += 1
            return {
              location: LOCATION,
              data: listCalls === 1
                ? [model('opencode', 'longcat-2.5-preview-free')]
                : [model('opencode', 'longcat-2.5-preview-free'), model('GreatScott', 'deepseek-v4.1-flash')],
            }
          }),
          default: vi.fn<OpenCodeApi['model']['default']>(async () => ({ location: LOCATION, data: null })),
        },
        config: { get: vi.fn<OpenCodeApi['config']['get']>(async () => []) },
      },
    })

    const promise = resolveOpenCodeModel(client, DIR, { preferredModel: 'GreatScott/deepseek-v4.1-flash' })
    const assertion = expect(promise).resolves.toEqual({
      providerID: 'GreatScott',
      id: 'deepseek-v4.1-flash',
      model: 'GreatScott/deepseek-v4.1-flash',
    })
    await vi.advanceTimersByTimeAsync(MODEL_LOAD_POLL_MS)
    await assertion
    expect(listCalls).toBe(2)
  })

  it('awaits the configured model while an empty then partial catalog loads', async () => {
    let listCalls = 0
    const client = createStubOpenCodeClient({
      api: {
        model: {
          list: vi.fn<OpenCodeApi['model']['list']>(async () => {
            listCalls += 1
            const catalogs: ModelInfo[][] = [
              [],
              [model('opencode', 'longcat-2.5-preview-free')],
              [model('opencode', 'longcat-2.5-preview-free'), model('GreatScott', 'deepseek-v4.1-flash')],
            ]
            return { location: LOCATION, data: catalogs[Math.min(listCalls, catalogs.length) - 1] ?? [] }
          }),
          default: vi.fn<OpenCodeApi['model']['default']>(async () => ({
            location: LOCATION,
            data: model('opencode', 'longcat-2.5-preview-free'),
          })),
        },
        config: { get: vi.fn<OpenCodeApi['config']['get']>(async () => [configEntry('GreatScott/deepseek-v4.1-flash')]) },
      },
    })

    const promise = resolveOpenCodeModel(client, DIR)
    const assertion = expect(promise).resolves.toEqual({
      providerID: 'GreatScott',
      id: 'deepseek-v4.1-flash',
      model: 'GreatScott/deepseek-v4.1-flash',
    })
    await vi.advanceTimersByTimeAsync(MODEL_LOAD_POLL_MS * 2)
    await assertion
    expect(listCalls).toBe(3)
  })

  it('resolves an object configured model and preserves its variant', async () => {
    const client = createdClient({
      models: [model('openai', 'gpt-5')],
      configEntries: [
        { type: 'document', info: { model: { providerID: 'openai', model: 'gpt-5', variant: 'high' } } },
      ],
    })

    const result = await resolveOpenCodeModel(client, DIR)

    expect(result).toEqual({
      providerID: 'openai',
      id: 'gpt-5',
      variant: 'high',
      model: 'openai/gpt-5#high',
    })
  })

  it('does not resolve a same-provider fallback before the target model loads', async () => {
    const client = createdClient({
      models: [model('openai', 'gpt-4')],
      defaultModel: model('openai', 'gpt-4'),
    })

    const promise = resolveOpenCodeModel(client, DIR, { preferredModel: 'openai/gpt-5' })
    let settled = false
    void promise.then(() => { settled = true }, () => { settled = true })

    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    const assertion = expect(promise).resolves.toEqual({ providerID: 'openai', id: 'gpt-4', model: 'openai/gpt-4' })
    await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS + MODEL_LOAD_POLL_MS)
    await assertion
  })

  it('falls back to the default when the configured target never loads', async () => {
    const client = createdClient({
      models: [model('openai', 'gpt-5')],
      defaultModel: model('openai', 'gpt-5'),
      configEntries: [configEntry('missing/model')],
    })

    const promise = resolveOpenCodeModel(client, DIR)
    let settled = false
    void promise.then(() => { settled = true }, () => { settled = true })

    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    const assertion = expect(promise).resolves.toEqual({ providerID: 'openai', id: 'gpt-5', model: 'openai/gpt-5' })
    await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS + MODEL_LOAD_POLL_MS)
    await assertion
  })

  it('waits for the catalog to populate when nothing is preferred or configured', async () => {
    let listCalls = 0
    const client = createStubOpenCodeClient({
      api: {
        model: {
          list: vi.fn<OpenCodeApi['model']['list']>(async () => {
            listCalls += 1
            return {
              location: LOCATION,
              data: listCalls === 1 ? [] : [model('anthropic', 'claude-sonnet-4')],
            }
          }),
          default: vi.fn<OpenCodeApi['model']['default']>(async () => ({ location: LOCATION, data: null })),
        },
        config: { get: vi.fn<OpenCodeApi['config']['get']>(async () => []) },
      },
    })

    const promise = resolveOpenCodeModel(client, DIR)
    const assertion = expect(promise).resolves.toEqual({
      providerID: 'anthropic',
      id: 'claude-sonnet-4',
      model: 'anthropic/claude-sonnet-4',
    })
    await vi.advanceTimersByTimeAsync(MODEL_LOAD_POLL_MS)
    await assertion
  })

  it('falls back to the cached catalog when a later poll stalls until the deadline', async () => {
    let listCalls = 0
    const client = createStubOpenCodeClient({
      api: {
        model: {
          list: vi.fn<OpenCodeApi['model']['list']>((_input, requestOptions) => {
            listCalls += 1
            if (listCalls === 1) {
              return Promise.resolve({ location: LOCATION, data: [model('openai', 'gpt-5')] })
            }
            return new Promise((_resolve, reject) => {
              const signal = requestOptions?.signal
              signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
            })
          }),
          default: vi.fn<OpenCodeApi['model']['default']>(async () => ({ location: LOCATION, data: null })),
        },
        config: { get: vi.fn<OpenCodeApi['config']['get']>(async () => [configEntry('missing/model')]) },
      },
    })

    const promise = resolveOpenCodeModel(client, DIR)
    const assertion = expect(promise).resolves.toEqual({ providerID: 'openai', id: 'gpt-5', model: 'openai/gpt-5' })
    await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS + MODEL_LOAD_POLL_MS)
    await assertion
    expect(listCalls).toBe(2)
  })

  it('times out an abortable stalled catalog request', async () => {
    const client = createStalledListClient()

    const promise = resolveOpenCodeModel(client, DIR)
    const assertion = expect(promise).rejects.toThrow(
      'Timed out waiting for the OpenCode model catalog to load',
    )
    await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS + 1)
    await assertion
  })

  it('rejects when the external signal aborts a stalled request', async () => {
    const client = createStalledListClient()
    const controller = new AbortController()

    const promise = resolveOpenCodeModel(client, DIR, { signal: controller.signal })
    const assertion = expect(promise).rejects.toThrow('cancelled')
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new Error('cancelled'))
    await vi.advanceTimersByTimeAsync(0)
    await assertion
  })

  it('rejects immediately when the external signal is already aborted', async () => {
    const client = createdClient({ models: [model('openai', 'gpt-5')] })
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    await expect(resolveOpenCodeModel(client, DIR, { signal: controller.signal })).rejects.toThrow('cancelled')
  })

  it('rejects when the external signal aborts as the default model request fulfills', async () => {
    const controller = new AbortController()
    const client = createStubOpenCodeClient({
      api: {
        model: {
          list: vi.fn<OpenCodeApi['model']['list']>(async () => ({ location: LOCATION, data: [model('openai', 'gpt-5')] })),
          default: vi.fn<OpenCodeApi['model']['default']>(async () => {
            controller.abort(new Error('cancelled'))
            return { location: LOCATION, data: model('openai', 'gpt-5') }
          }),
        },
        config: { get: vi.fn<OpenCodeApi['config']['get']>(async () => []) },
      },
    })

    await expect(
      resolveOpenCodeModel(client, DIR, { signal: controller.signal }),
    ).rejects.toThrow('cancelled')
  })

  it('propagates a catalog list error', async () => {
    const client = createdClient({ models: [], listError: new Error('list failed') })

    await expect(resolveOpenCodeModel(client, DIR)).rejects.toThrow('list failed')
  })

  it('propagates a default model error', async () => {
    const client = createdClient({
      models: [model('openai', 'gpt-5')],
      defaultError: new Error('default failed'),
    })

    await expect(resolveOpenCodeModel(client, DIR)).rejects.toThrow('default failed')
  })

  it('propagates a configured model read error', async () => {
    const client = createdClient({
      models: [model('openai', 'gpt-5')],
      defaultModel: model('openai', 'gpt-5'),
      configError: new Error('config failed'),
    })

    await expect(resolveOpenCodeModel(client, DIR)).rejects.toThrow('config failed')
  })

  it('ignores a malformed preferred model reference and falls back to the default', async () => {
    const client = createdClient({
      models: [model('openai', 'gpt-5')],
      defaultModel: model('openai', 'gpt-5'),
    })

    const result = await resolveOpenCodeModel(client, DIR, { preferredModel: 'openai' })

    expect(result).toEqual({ providerID: 'openai', id: 'gpt-5', model: 'openai/gpt-5' })
  })
})
