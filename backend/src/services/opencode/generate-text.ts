import type { ModelRef } from '@opencode-manager/shared/opencode'
import { getOpenCodeGlobalConfigPath } from '@opencode-manager/shared/config/env'
import type { OpenCodeClient } from './client'
import { resolveOpenCodeModel } from '../opencode-models'

export class GenerateTextTimeoutError extends Error {
  constructor() {
    super('Text generation timed out')
    this.name = 'GenerateTextTimeoutError'
  }
}

export async function generateTextWithTimeout(
  client: OpenCodeClient,
  input: { prompt: string; model?: ModelRef },
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const abortFromSignal = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason)
    } else {
      signal.addEventListener('abort', abortFromSignal, { once: true })
    }
  }
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new GenerateTextTimeoutError())
    }, timeoutMs)
  })

  try {
    const { text } = await Promise.race([generateText(client, input, controller.signal), timeout])
    return text
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromSignal)
  }
}

async function generateText(
  client: OpenCodeClient,
  input: { prompt: string; model?: ModelRef },
  signal: AbortSignal,
): Promise<{ text: string }> {
  const model = input.model ?? await resolveGenerateModel(client, signal)
  return client.api.generate.text({ prompt: input.prompt, model }, { signal })
}

/** OpenCode serves generation from its global config location, so the model must be resolved there once its catalog has loaded. */
async function resolveGenerateModel(client: OpenCodeClient, signal: AbortSignal): Promise<ModelRef> {
  const { providerID, id, variant } = await resolveOpenCodeModel(client, getOpenCodeGlobalConfigPath(), { signal })
  return variant ? { providerID, id, variant } : { providerID, id }
}
