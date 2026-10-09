import type { ModelRef } from '@opencode-manager/shared/opencode'
import { formatOpenCodeModelRef } from '@opencode-manager/shared/opencode'
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
): Promise<string> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
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
  }
}

async function generateText(
  client: OpenCodeClient,
  input: { prompt: string; model?: ModelRef },
  signal: AbortSignal,
): Promise<{ text: string }> {
  if (input.model) {
    await waitForGenerateModel(client, input.model, signal)
    return client.api.generate.text({ prompt: input.prompt, model: input.model }, { signal })
  }

  const model = await resolveGenerateModel(client, signal)
  return client.api.generate.text({ prompt: input.prompt, model }, { signal })
}

/**
 * Waits for an explicitly requested model to appear in OpenCode's global config-location catalog, which loads lazily after OpenCode starts.
 * Generation proceeds even if the wait times out or the model stays unconfigured, so OpenCode can surface its own error; an abort still propagates.
 */
async function waitForGenerateModel(
  client: OpenCodeClient,
  model: ModelRef,
  signal: AbortSignal,
): Promise<void> {
  try {
    await resolveOpenCodeModel(client, getOpenCodeGlobalConfigPath(), {
      signal,
      preferredModel: formatOpenCodeModelRef(model),
    })
  } catch {
    signal.throwIfAborted()
  }
}

/** OpenCode serves generation from its global config location, so the model must be resolved there once its catalog has loaded. */
async function resolveGenerateModel(client: OpenCodeClient, signal: AbortSignal): Promise<ModelRef> {
  const { providerID, id, variant } = await resolveOpenCodeModel(client, getOpenCodeGlobalConfigPath(), { signal })
  return variant ? { providerID, id, variant } : { providerID, id }
}
