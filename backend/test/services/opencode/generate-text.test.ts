import { describe, it, expect, vi, afterEach } from 'vitest'
import { getOpenCodeGlobalConfigPath } from '@opencode-manager/shared/config/env'
import type { ModelInfo, ModelRef } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../../src/services/opencode/client'
import { GenerateTextTimeoutError, generateTextWithTimeout } from '../../../src/services/opencode/generate-text'
import { MODEL_LOAD_POLL_MS } from '../../../src/services/opencode-models'

interface GenerateCall {
  input: { prompt: string; model?: ModelRef }
  signal: AbortSignal | undefined
}

const CATALOG_MODEL = { providerID: 'openai', id: 'gpt-5-mini', enabled: true } as ModelInfo

function makeClient(
  impl: (call: GenerateCall) => Promise<{ text: string }>,
  catalogs: ModelInfo[][] = [[CATALOG_MODEL]],
): {
  client: OpenCodeClient
  calls: GenerateCall[]
  modelList: ReturnType<typeof vi.fn>
} {
  const calls: GenerateCall[] = []
  let listCall = 0
  const catalogAt = () => catalogs[Math.min(listCall, catalogs.length - 1)] ?? []
  const modelList = vi.fn(async () => {
    const data = catalogAt()
    listCall += 1
    return { data }
  })
  const client = {
    api: {
      config: { get: vi.fn(async () => []) },
      model: {
        list: modelList,
        default: vi.fn(async () => ({ data: catalogs[Math.min(listCall - 1, catalogs.length - 1)]?.[0] ?? null })),
      },
      generate: {
        text: async (input: GenerateCall['input'], options?: { signal?: AbortSignal }) => {
          const call: GenerateCall = { input, signal: options?.signal }
          calls.push(call)
          return impl(call)
        },
      },
    },
  } as unknown as OpenCodeClient

  return { client, calls, modelList }
}

describe('generateTextWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves a model from the global config catalog when none is provided', async () => {
    const { client, calls, modelList } = makeClient(async () => ({ text: 'hello' }))

    await expect(generateTextWithTimeout(client, { prompt: 'write' }, 1000)).resolves.toBe('hello')

    expect(modelList).toHaveBeenCalledWith({ location: { directory: getOpenCodeGlobalConfigPath() } }, expect.anything())
    expect(calls).toHaveLength(1)
    expect(calls[0]?.input).toEqual({ prompt: 'write', model: { providerID: 'openai', id: 'gpt-5-mini' } })
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('waits for the model catalog to load before generating', async () => {
    vi.useFakeTimers()
    const { client, calls } = makeClient(async () => ({ text: 'hello' }), [[], [CATALOG_MODEL]])

    const promise = generateTextWithTimeout(client, { prompt: 'write' }, 10_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(MODEL_LOAD_POLL_MS)
    await expect(promise).resolves.toBe('hello')
    expect(calls[0]?.input.model).toEqual({ providerID: 'openai', id: 'gpt-5-mini' })
  })

  it('forwards the model when provided without reading the catalog', async () => {
    const { client, calls, modelList } = makeClient(async () => ({ text: 'hello' }))
    const model: ModelRef = { providerID: 'anthropic', id: 'claude-sonnet-4' }

    await generateTextWithTimeout(client, { prompt: 'write', model }, 1000)

    expect(calls[0]?.input).toEqual({ prompt: 'write', model })
    expect(modelList).not.toHaveBeenCalled()
  })

  it('rejects with GenerateTextTimeoutError and aborts the request after the timeout', async () => {
    vi.useFakeTimers()
    const { client, calls } = makeClient(() => new Promise<never>(() => {}))

    const promise = generateTextWithTimeout(client, { prompt: 'slow' }, 50)
    const assertion = expect(promise).rejects.toBeInstanceOf(GenerateTextTimeoutError)

    await vi.advanceTimersByTimeAsync(50)
    await assertion

    expect(calls[0]?.signal?.aborted).toBe(true)
  })

  it('times out while the model catalog is still loading', async () => {
    vi.useFakeTimers()
    const { client, calls } = makeClient(async () => ({ text: 'never' }), [[]])

    const promise = generateTextWithTimeout(client, { prompt: 'write' }, 50)
    const assertion = expect(promise).rejects.toBeInstanceOf(GenerateTextTimeoutError)

    await vi.advanceTimersByTimeAsync(50)
    await assertion

    expect(calls).toHaveLength(0)
  })

  it('propagates a client error without waiting for the timeout', async () => {
    const { client } = makeClient(async () => {
      throw new Error('model unavailable')
    })

    await expect(generateTextWithTimeout(client, { prompt: 'write' }, 1000)).rejects.toThrow('model unavailable')
  })

  it('clears the timeout once the client resolves', async () => {
    vi.useFakeTimers()
    const { client, calls } = makeClient(async () => ({ text: 'done' }))

    await expect(generateTextWithTimeout(client, { prompt: 'write' }, 50)).resolves.toBe('done')

    await vi.advanceTimersByTimeAsync(100)

    expect(calls[0]?.signal?.aborted).toBe(false)
  })
})
