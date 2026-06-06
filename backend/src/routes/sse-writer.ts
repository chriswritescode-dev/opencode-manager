export interface QueuedSSEWriterInput {
  write: (chunk: Uint8Array) => Promise<unknown> | void
  onError: (error: unknown) => void
}

export interface QueuedSSEWriter {
  writeSSE: (event: string, data: string) => void
  close: () => void
}

export function createQueuedSSEWriter(input: QueuedSSEWriterInput): QueuedSSEWriter {
  const encoder = new TextEncoder()
  let chain = Promise.resolve()
  let closed = false

  const writeSSE = (event: string, data: string) => {
    if (closed) return

    const lines: string[] = []
    if (event) lines.push(`event: ${event}`)
    lines.push(`data: ${data}`)
    lines.push('')
    lines.push('')
    const encoded = encoder.encode(lines.join('\n'))

    chain = chain
      .then(async () => {
        if (closed) return
        await input.write(encoded)
      })
      .catch((error) => {
        if (!closed) {
          closed = true
          input.onError(error)
        }
      })
  }

  const close = () => {
    closed = true
  }

  return { writeSSE, close }
}
