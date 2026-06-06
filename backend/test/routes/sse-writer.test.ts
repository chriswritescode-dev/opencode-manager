import { describe, it, expect, vi } from 'vitest'
import { createQueuedSSEWriter, encodeSSEFrame } from '../../src/routes/sse-writer'

describe('encodeSSEFrame', () => {
  const decoder = new TextDecoder()

  it('encodes an event frame', () => {
    expect(decoder.decode(encodeSSEFrame('message', '{"n":1}'))).toBe('event: message\ndata: {"n":1}\n\n')
  })

  it('omits the event line when event is empty', () => {
    expect(decoder.decode(encodeSSEFrame('', '{"n":1}'))).toBe('data: {"n":1}\n\n')
  })
})

describe('createQueuedSSEWriter', () => {
  describe('writeFrame', () => {
    it('writes a pre-encoded frame through the serialized chain', async () => {
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
  })

  describe('serializes frames in enqueue order', () => {
    it('should not execute second write until first resolves', async () => {
      let firstWriteResolve!: () => void
      const writes: Uint8Array[] = []
      const write = vi.fn((chunk: Uint8Array) => {
        writes.push(chunk)
        if (writes.length === 1) {
          return new Promise<void>((resolve) => {
            firstWriteResolve = resolve
          })
        }
      })
      const onError = vi.fn()

      const writer = createQueuedSSEWriter({ write, onError })

      writer.writeSSE('message', '{"n":1}')
      writer.writeSSE('message', '{"n":2}')

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(write).toHaveBeenCalledTimes(1)
      expect(onError).not.toHaveBeenCalled()

      firstWriteResolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(write).toHaveBeenCalledTimes(2)

      const decoder = new TextDecoder()
      expect(decoder.decode(writes[0])).toBe('event: message\ndata: {"n":1}\n\n')
      expect(decoder.decode(writes[1])).toBe('event: message\ndata: {"n":2}\n\n')
    })
  })

  describe('stops writing after a write failure', () => {
    it('should call onError and skip subsequent writes', async () => {
      const write = vi.fn().mockRejectedValueOnce(new Error('write failed'))
      const onError = vi.fn()

      const writer = createQueuedSSEWriter({ write, onError })

      writer.writeSSE('message', '{"n":1}')

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1)
      })
      expect(onError).toHaveBeenCalledWith(new Error('write failed'))
      expect(write).toHaveBeenCalledTimes(1)

      writer.writeSSE('message', '{"n":2}')

      await vi.waitFor(() => {
        expect(write).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('FIFO order across many frames', () => {
    it('preserves FIFO order across many frames', async () => {
      const order: number[] = []
      const write = vi.fn((chunk: Uint8Array) => {
        const decoded = new TextDecoder().decode(chunk)
        const match = decoded.match(/"n":(\d+)/)
        if (match) order.push(Number(match[1]))
      })
      const onError = vi.fn()
      const writer = createQueuedSSEWriter({ write, onError })

      for (let i = 1; i <= 50; i++) {
        writer.writeSSE('message', `{"n":${i}}`)
      }

      await vi.waitFor(() => {
        expect(write).toHaveBeenCalledTimes(50)
      })

      expect(order).toHaveLength(50)
      for (let i = 0; i < 50; i++) {
        expect(order[i]).toBe(i + 1)
      }
      expect(onError).not.toHaveBeenCalled()
    })
  })

  describe('serialization (no overlap)', () => {
    it('serializes writes (no overlap)', async () => {
      let concurrent = 0
      let maxConcurrent = 0
      const deferreds: (() => void)[] = []

      const write = vi.fn(() => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        return new Promise<void>((resolve) => {
          deferreds.push(() => {
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

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(write).toHaveBeenCalledTimes(1)
      expect(maxConcurrent).toBe(1)

      deferreds[0]!()
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
      expect(maxConcurrent).toBe(1)

      deferreds[1]!()
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3))
      expect(maxConcurrent).toBe(1)

      expect(onError).not.toHaveBeenCalled()
    })
  })

  describe('frame dropping at queue capacity', () => {
    it('drops frames beyond MAX_QUEUED_FRAMES when write is blocked', async () => {
      const deferreds: (() => void)[] = []
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const write = vi.fn((_chunk: Uint8Array) => {
        return new Promise<void>((resolve) => {
          deferreds.push(resolve)
        })
      })
      const onError = vi.fn()
      const writer = createQueuedSSEWriter({ write, onError })

      writer.writeSSE('message', '{"n":1}')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(deferreds).toHaveLength(1)

      for (let i = 2; i <= 1100; i++) {
        writer.writeSSE('message', `{"n":${i}}`)
      }

      while (deferreds.length > 0) {
        deferreds.shift()!()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      expect(write.mock.calls.length).toBeLessThanOrEqual(1025)
      expect(write.mock.calls.length).toBeLessThan(1100)

      const decoder = new TextDecoder()
      const calls = write.mock.calls as [Uint8Array][]
      calls.forEach(([chunk], i) => {
        expect(decoder.decode(chunk)).toBe(`event: message\ndata: {"n":${i + 1}}\n\n`)
      })
      expect(onError).not.toHaveBeenCalled()
    })
  })

  describe('close behavior', () => {
    it('no-ops after close()', async () => {
      const write = vi.fn()
      const onError = vi.fn()
      const writer = createQueuedSSEWriter({ write, onError })

      writer.close()
      writer.writeSSE('message', '{"n":1}')
      writer.writeFrame(new Uint8Array([1, 2, 3]))

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(write).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    })
  })

  describe('write rejection', () => {
    it('calls onError once on write rejection', async () => {
      const write = vi.fn().mockRejectedValue(new Error('boom'))
      const onError = vi.fn()
      const writer = createQueuedSSEWriter({ write, onError })

      writer.writeSSE('message', '{"n":1}')

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1)
      })
      expect(onError).toHaveBeenCalledWith(new Error('boom'))

      writer.writeSSE('message', '{"n":2}')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(write).toHaveBeenCalledTimes(1)
    })
  })
})
