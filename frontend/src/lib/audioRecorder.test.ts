import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import { AudioRecorder, downsampleAndConvert, encodeWavFromInt16 } from './audioRecorder'

describe('downsampleAndConvert', () => {
  it('should produce correct output length for 48kHz to 16kHz', () => {
    const inputLength = 4800
    const input = new Float32Array(inputLength)
    const output = downsampleAndConvert(input, 48000, 16000)
    
    const expectedLength = Math.floor(inputLength * 16000 / 48000)
    expect(output.length).toBe(expectedLength)
    expect(output.length).toBe(inputLength / 3)
  })

  it('should produce correct output length for 44.1kHz to 16kHz', () => {
    const inputLength = 4410
    const input = new Float32Array(inputLength)
    const output = downsampleAndConvert(input, 44100, 16000)
    
    const expectedLength = Math.floor(inputLength * 16000 / 44100)
    expect(output.length).toBeCloseTo(expectedLength, 0)
  })

  it('should clamp values in range [-1, 1] to Int16 range', () => {
    const input = new Float32Array([1.0, -1.0, 0.5, -0.5, 0.0])
    const output = downsampleAndConvert(input, 16000, 16000)
    
    expect(output[0]).toBe(32767)
    expect(output[1]).toBe(-32768)
    expect(output[2]).toBeCloseTo(16383, 0)
    expect(output[3]).toBeCloseTo(-16384, 0)
    expect(output[4]).toBe(0)
  })

  it('should clamp values outside [-1, 1] range', () => {
    const input = new Float32Array([1.5, -1.5, 2.0, -2.0])
    const output = downsampleAndConvert(input, 16000, 16000)
    
    expect(output[0]).toBe(32767)
    expect(output[1]).toBe(-32768)
    expect(output[2]).toBe(32767)
    expect(output[3]).toBe(-32768)
  })

  it('should return Int16Array type', () => {
    const input = new Float32Array(100)
    const output = downsampleAndConvert(input, 48000, 16000)
    
    expect(output instanceof Int16Array).toBe(true)
  })
})

describe('encodeWavFromInt16', () => {
  beforeAll(() => {
    if (typeof Blob.prototype.arrayBuffer !== 'function') {
      Blob.prototype.arrayBuffer = async function arrayBuffer() {
        const reader = new FileReader()
        return new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.onerror = reject
          reader.readAsArrayBuffer(this)
        })
      }
    }
  })

  it('should create a Blob with audio/wav type', () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 1)
    
    expect(blob.type).toBe('audio/wav')
  })

  it('should have RIFF header at offset 0', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 1)
    const arrayBuffer = await blob.arrayBuffer()
    const view = new DataView(arrayBuffer)
    
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    )
    expect(riff).toBe('RIFF')
  })

  it('should have WAVE identifier at offset 8', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 1)
    const arrayBuffer = await blob.arrayBuffer()
    const view = new DataView(arrayBuffer)
    
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    )
    expect(wave).toBe('WAVE')
  })

  it('should have sample rate at offset 24', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 1)
    const arrayBuffer = await blob.arrayBuffer()
    const view = new DataView(arrayBuffer)
    
    const sampleRate = view.getUint32(24, true)
    expect(sampleRate).toBe(16000)
  })

  it('should have data identifier at offset 36', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 1)
    const arrayBuffer = await blob.arrayBuffer()
    const view = new DataView(arrayBuffer)
    
    const data = String.fromCharCode(
      view.getUint8(36),
      view.getUint8(37),
      view.getUint8(38),
      view.getUint8(39)
    )
    expect(data).toBe('data')
  })

  it('should have correct file size for 1000 samples', () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 1)
    
    expect(blob.size).toBe(44 + 1000 * 2)
  })

  it('should handle different sample rates', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 44100, 1)
    const arrayBuffer = await blob.arrayBuffer()
    const view = new DataView(arrayBuffer)
    
    const sampleRate = view.getUint32(24, true)
    expect(sampleRate).toBe(44100)
  })

  it('should handle stereo channels', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 2)
    const arrayBuffer = await blob.arrayBuffer()
    const view = new DataView(arrayBuffer)
    
    const channels = view.getUint16(22, true)
    expect(channels).toBe(2)
  })
})

describe('AudioRecorder.isSupported', () => {
  it('should return boolean without throwing', () => {
    expect(() => {
      const result = AudioRecorder.isSupported()
      expect(typeof result).toBe('boolean')
    }).not.toThrow()
  })
})

describe('AudioRecorder lifecycle', () => {
  class FakeAudioWorklet {
    addModule = vi.fn(async (_url: string) => undefined)
  }

  class FakeAudioWorkletNode {
    port = {
      onmessage: null as ((e: MessageEvent<Int16Array>) => void) | null,
      postMessage: vi.fn(),
    }
    disconnect = vi.fn()
  }

  class FakeAudioContext {
    state: 'suspended' | 'running' | 'closed' = 'suspended'
    sampleRate = 16000
    audioWorklet = new FakeAudioWorklet()
    resume = vi.fn(async () => {
      this.state = 'running'
    })
    suspend = vi.fn(async () => {
      this.state = 'suspended'
    })
    close = vi.fn(async () => {
      this.state = 'closed'
    })
    createMediaStreamSource = vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }))
  }

  class FakeMediaStreamTrack {
    enabled = true
    stop = vi.fn()
  }

  let getUserMediaMock: ReturnType<typeof vi.fn>
  let originalAudioContext: typeof AudioContext | undefined
  let originalAudioWorkletNode: typeof AudioWorkletNode | undefined
  let originalMediaDevices: MediaDevices | undefined

  beforeEach(() => {
    vi.clearAllMocks()

    const track1 = new FakeMediaStreamTrack()
    const track2 = new FakeMediaStreamTrack()
    const getTracks = () => [track1, track2]
    const fakeStream = { getTracks }

    getUserMediaMock = vi.fn(async () => fakeStream)
    originalMediaDevices = (navigator as any).mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: getUserMediaMock },
      writable: true,
      configurable: true,
    })

    originalAudioContext = globalThis.AudioContext
    originalAudioWorkletNode = globalThis.AudioWorkletNode

    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext
    globalThis.AudioWorkletNode = FakeAudioWorkletNode as unknown as typeof AudioWorkletNode
  })

  afterEach(() => {
    if (originalAudioContext) {
      globalThis.AudioContext = originalAudioContext
    }
    if (originalAudioWorkletNode) {
      globalThis.AudioWorkletNode = originalAudioWorkletNode
    }
    if (originalMediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: originalMediaDevices,
        writable: true,
        configurable: true,
      })
    }
  })

  it('prepare() creates a suspended AudioContext and loads the worklet without calling getUserMedia', async () => {
    const recorder = new AudioRecorder()
    await recorder.prepare()

    const ctx = (recorder as unknown as { audioContext: FakeAudioContext }).audioContext
    expect(ctx).toBeDefined()
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledTimes(1)
    expect(getUserMediaMock).not.toHaveBeenCalled()
    expect(ctx.state).toBe('suspended')
  })

  it('prepare() is idempotent across multiple calls (single addModule)', async () => {
    const recorder = new AudioRecorder()
    await recorder.prepare()
    await recorder.prepare()

    const ctx = (recorder as unknown as { audioContext: FakeAudioContext }).audioContext
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledTimes(1)
  })

  it('start() after prepare() resumes context and calls getUserMedia exactly once', async () => {
    const recorder = new AudioRecorder()
    await recorder.prepare()
    await recorder.start()

    const ctx = (recorder as unknown as { audioContext: FakeAudioContext }).audioContext
    expect(ctx.resume).toHaveBeenCalledTimes(1)
    expect(getUserMediaMock).toHaveBeenCalledTimes(1)
    expect(ctx.state).toBe('running')
  })

  it('stop() suspends context instead of closing it', async () => {
    const recorder = new AudioRecorder()
    await recorder.prepare()
    await recorder.start()
    await recorder.stop()

    const ctx = (recorder as unknown as { audioContext: FakeAudioContext }).audioContext
    expect(ctx.suspend).toHaveBeenCalled()
    expect(ctx.close).not.toHaveBeenCalled()
    expect(ctx).toBeDefined()
  })

  it('start() after stop() reuses the same AudioContext and MediaStream', async () => {
    const recorder = new AudioRecorder()
    await recorder.prepare()
    await recorder.start()
    await recorder.stop()

    const ctx = (recorder as unknown as { audioContext: FakeAudioContext }).audioContext
    const addModuleCount = ctx.audioWorklet.addModule.mock.calls.length
    const getUserMediaCount = getUserMediaMock.mock.calls.length

    await recorder.start()

    expect(ctx.audioWorklet.addModule).toHaveBeenCalledTimes(addModuleCount)
    expect(getUserMediaMock).toHaveBeenCalledTimes(getUserMediaCount)
  })

  it('stop() sets all MediaStream tracks enabled = false', async () => {
    const recorder = new AudioRecorder()
    await recorder.prepare()
    await recorder.start()
    await recorder.stop()

    const mediaStream = (recorder as unknown as { mediaStream: { getTracks: () => FakeMediaStreamTrack[] } }).mediaStream
    const tracks = mediaStream.getTracks()
    expect(tracks[0].enabled).toBe(false)
    expect(tracks[1].enabled).toBe(false)
  })

  it('releaseStream() stops all tracks and nulls stream but keeps AudioContext suspended', async () => {
    const recorder = new AudioRecorder()
    await recorder.prepare()
    await recorder.start()
    await recorder.stop()

    const ctx = (recorder as unknown as { audioContext: FakeAudioContext }).audioContext
    const initialContextState = ctx.state

    recorder.releaseStream()

    const mediaStream = (recorder as unknown as { mediaStream: { getTracks: () => FakeMediaStreamTrack[] } | null }).mediaStream
    expect(mediaStream).toBeNull()
    expect(ctx.state).toBe(initialContextState)

    await recorder.start()
    expect(getUserMediaMock).toHaveBeenCalledTimes(2)
  })

  it('dispose() closes context and stops tracks', async () => {
    const recorder = new AudioRecorder()
    await recorder.prepare()
    await recorder.start()
    await recorder.stop()

    const ctxBefore = (recorder as unknown as { audioContext: FakeAudioContext }).audioContext

    recorder.dispose()

    expect(ctxBefore.close).toHaveBeenCalled()
    expect(ctxBefore.state).toBe('closed')
  })

  it('start() after dispose() rebuilds context and re-acquires getUserMedia', async () => {
    const recorder = new AudioRecorder()
    await recorder.prepare()
    await recorder.start()
    await recorder.stop()

    const ctxBefore = (recorder as unknown as { audioContext: FakeAudioContext }).audioContext
    const getUserMediaCountBefore = getUserMediaMock.mock.calls.length

    recorder.dispose()

    await recorder.start()

    const ctxAfter = (recorder as unknown as { audioContext: FakeAudioContext }).audioContext
    expect(ctxAfter).not.toBe(ctxBefore)
    expect(ctxAfter.audioWorklet.addModule).toHaveBeenCalledTimes(1)
    expect(getUserMediaMock).toHaveBeenCalledTimes(getUserMediaCountBefore + 1)
  })
})
