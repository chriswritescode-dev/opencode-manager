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
const MAX_QUEUED_FRAMES = 1024

export function encodeSSEFrame(event: string, data: string): Uint8Array {
  const head = event ? `event: ${event}\n` : ''
  return sharedEncoder.encode(`${head}data: ${data}\n\n`)
}

export function createQueuedSSEWriter(input: QueuedSSEWriterInput): QueuedSSEWriter {
  const queue: Uint8Array[] = []
  let draining = false
  let closed = false

  const pump = async () => {
    if (draining || closed) return
    draining = true
    try {
      while (queue.length > 0 && !closed) {
        const frame = queue.shift() as Uint8Array
        await input.write(frame)
      }
    } catch (error) {
      if (!closed) {
        closed = true
        input.onError(error)
      }
    } finally {
      draining = false
    }
  }

  const writeFrame = (frame: Uint8Array) => {
    if (closed) return
    if (queue.length >= MAX_QUEUED_FRAMES) {
      return
    }
    queue.push(frame)
    void pump()
  }

  const writeSSE = (event: string, data: string) => {
    if (closed) return
    writeFrame(encodeSSEFrame(event, data))
  }

  const close = () => {
    closed = true
    queue.length = 0
  }

  return { writeSSE, writeFrame, close }
}
