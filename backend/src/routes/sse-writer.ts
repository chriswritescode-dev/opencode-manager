export interface QueuedSSEWriterInput {
  write: (chunk: Uint8Array) => Promise<unknown> | void
  onError: (error: unknown) => void
}

export interface QueuedSSEWriter {
  writeSSE: (event: string, data: string) => void
  writeFrame: (frame: Uint8Array) => void
  close: () => void
}

const sharedEncoder = new TextEncoder()

export function encodeSSEFrame(event: string, data: string): Uint8Array {
  const head = event ? `event: ${event}\n` : ''
  return sharedEncoder.encode(`${head}data: ${data}\n\n`)
}

export function createQueuedSSEWriter(input: QueuedSSEWriterInput): QueuedSSEWriter {
  let chain = Promise.resolve()
  let closed = false

  const writeFrame = (frame: Uint8Array) => {
    if (closed) return

    chain = chain
      .then(async () => {
        if (closed) return
        await input.write(frame)
      })
      .catch((error) => {
        if (!closed) {
          closed = true
          input.onError(error)
        }
      })
  }

  const writeSSE = (event: string, data: string) => {
    if (closed) return
    writeFrame(encodeSSEFrame(event, data))
  }

  const close = () => {
    closed = true
  }

  return { writeSSE, writeFrame, close }
}
