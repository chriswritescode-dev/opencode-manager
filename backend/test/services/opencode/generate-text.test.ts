import { describe, it, expect, vi, afterEach } from 'vitest'
import { getOpenCodeGlobalConfigPath } from '@opencode-manager/shared/config/env'
import type { ModelInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../../src/services/opencode/client'
import { GenerateTextTimeoutError, generateTextWithTimeout } from '../../../src/services/opencode/generate-text'
import { MODEL_LOAD_POLL_MS } from '../../../src/services/opencode-models'
import { createStubOpenCodeClient, modelInfo } from '../../helpers/stub-opencode-client'

type GenerateTextInput = Parameters<OpenCodeClient['api']['generate']['text']>[0]
type GenerateTextOptions = Parameters<OpenCodeClient['api']['generate']['text']>[1]
type GenerateTextOutput = Awaited<ReturnType<OpenCodeClient['api']['generate']['text']>>

interface GenerateCall {
  input: GenerateTextInput
  signal: AbortSignal | undefined
}

interface StubGenerateClient {
  client: OpenCodeClient
  calls: GenerateCall[]
  modelDirectories: Array<string | null>
}

const CATALOG_MODEL = modelInfo({ providerID: 'openai', id: 'gpt-5-mini', enabled: true })

function makeClient(
  impl: (call: GenerateCall) => Promise<GenerateTextOutput>,
  catalogs: ModelInfo[][] = [[CATALOG_MODEL]],
): StubGenerateClient {
  const calls: GenerateCall[] = []
  const modelDirectories: Array<string | null> = []
  let listCall = 0
  let currentCatalog: ModelInfo[] = []

  const client = createStubOpenCodeClient({
    api: {
      config: { get: vi.fn(async () => []) },
      model: {
        list: vi.fn(async (input?: { location?: { directory?: string } }) => {
          modelDirectories.push(input?.location?.directory ?? null)
          currentCatalog = catalogs[Math.min(listCall, catalogs.length - 1)] ?? []
          listCall += 1
          return { location: { directory: input?.location?.directory ?? '' }, data: currentCatalog }
        }),
        default: vi.fn(async () => ({
          location: { directory: getOpenCodeGlobalConfigPath() },
          data: currentCatalog[0] ?? null,
        })),
      },
      generate: {
        text: async (input: GenerateTextInput, options?: GenerateTextOptions) => {
          const call: GenerateCall = { input, signal: options?.signal }
          calls.push(call)
          return await impl(call)
        },
      },
    },
  })

  return { client, calls, modelDirectories }
}

describe('generateTextWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves a model from the global config catalog when none is provided', async () => {
    const { client, calls, modelDirectories } = makeClient(async () => ({ text: 'hello' }))

    await expect(generateTextWithTimeout(client, { prompt: 'write' }, 1000)).resolves.toBe('hello')

    expect(modelDirectories).toEqual([getOpenCodeGlobalConfigPath()])
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
