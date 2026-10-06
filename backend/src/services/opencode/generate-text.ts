import type { ModelRef } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from './client'

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
    const { text } = await Promise.race([
      client.api.generate.text(input, { signal: controller.signal }),
      timeout,
    ])
    return text
  } finally {
    if (timer) clearTimeout(timer)
  }
}
