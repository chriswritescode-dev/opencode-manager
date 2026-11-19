import { describe, expect, it, vi } from 'vitest'
import { createQueuedSSEWriter } from '../../src/routes/sse-writer'
import { encodeSSEFrame } from '../../src/utils/sse-frame'

const decoder = new TextDecoder()

describe('encodeSSEFrame', () => {
  it('encodes an event frame', () => {
    expect(decoder.decode(encodeSSEFrame('message', '{"n":1}'))).toBe('event: message\ndata: {"n":1}\n\n')
  })

  it('omits the event line when event is empty', () => {
    expect(decoder.decode(encodeSSEFrame('', '{"n":1}'))).toBe('data: {"n":1}\n\n')
  })
})

describe('createQueuedSSEWriter', () => {
  it('writes a pre-encoded frame', async () => {
    const writes: Uint8Array[] = []
    const write = vi.fn((chunk: Uint8Array) => { writes.push(chunk) })
    const onError = vi.fn()

    const writer = createQueuedSSEWriter({ write, onError })
    const frame = encodeSSEFrame('message', '{"shared":true}')
    writer.writeFrame(frame)

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(writes[0]).toBe(frame)
    expect(onError).not.toHaveBeenCalled()
  })

  it('preserves FIFO order across many frames', async () => {
    const order: number[] = []
    const write = vi.fn((chunk: Uint8Array) => {
      const match = decoder.decode(chunk).match(/"n":(\d+)/)
      if (match) order.push(Number(match[1]))
    })
    const onError = vi.fn()
    const writer = createQueuedSSEWriter({ write, onError })

    for (let i = 1; i <= 50; i++) {
      writer.writeSSE('message', `{"n":${i}}`)
    }

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(50))

    expect(order).toEqual(Array.from({ length: 50 }, (_value, index) => index + 1))
    expect(onError).not.toHaveBeenCalled()
  })

  it('serializes writes without overlap', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const pending: Array<() => void> = []

    const write = vi.fn(() => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      return new Promise<void>((resolve) => {
        pending.push(() => {
          concurrent--
          resolve()
        })
      })
    })
    const onError = vi.fn()
    const writer = createQueuedSSEWriter({ write, onError })

    writer.writeSSE('message', '{"n":1}')
    writer.writeSSE('message', '{"n":2}')
    writer.writeSSE('message', '{"n":3}')

    await vi.waitFor(() => expect(pending).toHaveLength(1))
    expect(write).toHaveBeenCalledTimes(1)
    expect(maxConcurrent).toBe(1)

    pending.shift()?.()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(maxConcurrent).toBe(1)

    pending.shift()?.()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3))

    expect(maxConcurrent).toBe(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('drops frames beyond the queue capacity while a write is blocked', async () => {
    const pending: Array<() => void> = []
    let notifyNextWrite = () => {}
    const nextWrite = () => new Promise<void>((resolve) => {
      notifyNextWrite = resolve
    })
    const write = vi.fn((_chunk: Uint8Array) => new Promise<void>((resolve) => {
      pending.push(resolve)
      notifyNextWrite()
    }))
    const onError = vi.fn()
    const writer = createQueuedSSEWriter({ write, onError })

    writer.writeSSE('message', '{"n":1}')
    expect(pending).toHaveLength(1)

    for (let i = 2; i <= 1100; i++) {
      writer.writeSSE('message', `{"n":${i}}`)
    }

    const expectedWrites = 1025
    while (pending.length > 0) {
      const writeStarted = nextWrite()
      pending.shift()?.()
      if (write.mock.calls.length < expectedWrites) {
        await writeStarted
      }
    }

    expect(write).toHaveBeenCalledTimes(expectedWrites)
    write.mock.calls.forEach(([chunk], index) => {
      expect(decoder.decode(chunk)).toBe(`event: message\ndata: {"n":${index + 1}}\n\n`)
    })
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports a write failure once and skips every later frame', async () => {
    const failure = new Error('write failed')
    const write = vi.fn().mockRejectedValueOnce(failure)
    const onError = vi.fn()
    const writer = createQueuedSSEWriter({ write, onError })

    writer.writeSSE('message', '{"n":1}')

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError).toHaveBeenCalledWith(failure)
    expect(write).toHaveBeenCalledTimes(1)

    writer.writeSSE('message', '{"n":2}')

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('no-ops after close', async () => {
    const write = vi.fn()
    const onError = vi.fn()
    const writer = createQueuedSSEWriter({ write, onError })

    writer.close()
    writer.writeSSE('message', '{"n":1}')
    writer.writeFrame(new Uint8Array([1, 2, 3]))

    await vi.waitFor(() => expect(write).not.toHaveBeenCalled())
    expect(onError).not.toHaveBeenCalled()
  })
})
