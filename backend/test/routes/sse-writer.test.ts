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
})
