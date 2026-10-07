import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ModelRef } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../../src/services/opencode/client'
import { GenerateTextTimeoutError, generateTextWithTimeout } from '../../../src/services/opencode/generate-text'

interface GenerateCall {
  input: { prompt: string; model?: ModelRef }
  signal: AbortSignal | undefined
}

function makeClient(impl: (call: GenerateCall) => Promise<{ text: string }>): {
  client: OpenCodeClient
  calls: GenerateCall[]
} {
  const calls: GenerateCall[] = []
  const client = {
    api: {
      generate: {
        text: async (input: GenerateCall['input'], options?: { signal?: AbortSignal }) => {
          const call: GenerateCall = { input, signal: options?.signal }
          calls.push(call)
          return impl(call)
        },
      },
    },
  } as unknown as OpenCodeClient

  return { client, calls }
}

describe('generateTextWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the generated text and passes the prompt with an abort signal', async () => {
    const { client, calls } = makeClient(async () => ({ text: 'hello' }))

    await expect(generateTextWithTimeout(client, { prompt: 'write' }, 1000)).resolves.toBe('hello')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.input).toEqual({ prompt: 'write' })
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('forwards the model when provided', async () => {
    const { client, calls } = makeClient(async () => ({ text: 'hello' }))
    const model: ModelRef = { providerID: 'anthropic', id: 'claude-sonnet-4' }

    await generateTextWithTimeout(client, { prompt: 'write', model }, 1000)

    expect(calls[0]?.input).toEqual({ prompt: 'write', model })
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
