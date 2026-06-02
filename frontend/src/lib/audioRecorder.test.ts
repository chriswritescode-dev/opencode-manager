import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { AudioRecorder } from './audioRecorder'

class FakeMediaRecorder {
  static _instances: FakeMediaRecorder[] = []
  static _supportedTypes = new Set<string>([
    'audio/webm;codecs=opus',
    'audio/webm',
  ])

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder._supportedTypes.has(type)
  }

  state: 'inactive' | 'recording' = 'inactive'
  stream: MediaStream
  mimeType: string
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    this.stream = stream
    this.mimeType = options?.mimeType ?? ''
    FakeMediaRecorder._instances.push(this)
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    this.onstop?.()
  }
}

function createMockTrack(): MediaStreamTrack {
  return { stop: vi.fn(), kind: 'audio' } as unknown as MediaStreamTrack
}

function createMockStream(tracks: MediaStreamTrack[] = [createMockTrack()]): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
    getVideoTracks: () => [],
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    clone: vi.fn(),
    getTrackById: vi.fn(),
    active: true,
    id: 'mock-stream',
    onaddtrack: null,
    onremovetrack: null,
  } as unknown as MediaStream
}

describe('AudioRecorder.isSupported', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (Blob.prototype as { arrayBuffer?: unknown }).arrayBuffer
  })

  it('returns true when navigator.mediaDevices.getUserMedia and window.MediaRecorder exist', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      writable: true,
      configurable: true,
    })
    Object.defineProperty(window, 'MediaRecorder', {
      value: FakeMediaRecorder,
      writable: true,
      configurable: true,
    })
    expect(AudioRecorder.isSupported()).toBe(true)
  })

  it('returns false when navigator.mediaDevices.getUserMedia is missing', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {},
      writable: true,
      configurable: true,
    })
    Object.defineProperty(window, 'MediaRecorder', {
      value: FakeMediaRecorder,
      writable: true,
      configurable: true,
    })
    expect(AudioRecorder.isSupported()).toBe(false)
  })

  it('returns false when window.MediaRecorder is undefined', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      writable: true,
      configurable: true,
    })
    Object.defineProperty(window, 'MediaRecorder', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    expect(AudioRecorder.isSupported()).toBe(false)
  })
})

describe('AudioRecorder start', () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>
  let mockTrack: ReturnType<typeof createMockTrack>
  let mockStream: MediaStream
  let recorder: AudioRecorder
  let onStateChange: ReturnType<typeof vi.fn>
  let onError: ReturnType<typeof vi.fn>
  let onDataAvailable: ReturnType<typeof vi.fn>
  let onNoSpeech: ReturnType<typeof vi.fn>

  beforeEach(() => {
    FakeMediaRecorder._instances = []
    FakeMediaRecorder._supportedTypes = new Set([
      'audio/webm;codecs=opus',
      'audio/webm',
    ])
    Object.defineProperty(window, 'MediaRecorder', {
      value: FakeMediaRecorder,
      writable: true,
      configurable: true,
    })

    mockTrack = createMockTrack()
    mockStream = createMockStream([mockTrack])
    mockGetUserMedia = vi.fn().mockResolvedValue(mockStream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
      configurable: true,
    })

    onStateChange = vi.fn()
    onError = vi.fn()
    onDataAvailable = vi.fn()
    onNoSpeech = vi.fn()

    recorder = new AudioRecorder()
    recorder.setOnStateChange(onStateChange)
    recorder.setOnError(onError)
    recorder.setOnDataAvailable(onDataAvailable)
    recorder.setOnNoSpeech(onNoSpeech)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests microphone with echoCancellation, noiseSuppression, and autoGainControl', async () => {
    await recorder.start()
    expect(mockGetUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  })

  it('selects the first supported MIME type from the preferred list', async () => {
    await recorder.start()
    const mr = FakeMediaRecorder._instances[0]
    expect(mr.mimeType).toBe('audio/webm;codecs=opus')
  })

  it('selects a lower-priority MIME when higher ones are unsupported', async () => {
    FakeMediaRecorder._supportedTypes = new Set(['audio/ogg;codecs=opus'])
    await recorder.start()
    const mr = FakeMediaRecorder._instances[0]
    expect(mr.mimeType).toBe('audio/ogg;codecs=opus')
  })

  it('constructs MediaRecorder without options when no MIME type is supported', async () => {
    FakeMediaRecorder._supportedTypes = new Set()
    await recorder.start()
    const mr = FakeMediaRecorder._instances[0]
    expect(mr.mimeType).toBe('')
  })

  it('transitions to recording state', async () => {
    await recorder.start()
    expect(recorder.getState()).toBe('recording')
    expect(onStateChange).toHaveBeenCalledWith('recording')
  })

})

describe('AudioRecorder stop', () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>
  let mockTrack: ReturnType<typeof createMockTrack>
  let mockStream: MediaStream
  let recorder: AudioRecorder
  let onStateChange: ReturnType<typeof vi.fn>
  let onDataAvailable: ReturnType<typeof vi.fn>
  let onNoSpeech: ReturnType<typeof vi.fn>

  beforeEach(() => {
    FakeMediaRecorder._instances = []
    FakeMediaRecorder._supportedTypes = new Set(['audio/webm;codecs=opus'])
    Object.defineProperty(window, 'MediaRecorder', {
      value: FakeMediaRecorder,
      writable: true,
      configurable: true,
    })

    mockTrack = createMockTrack()
    mockStream = createMockStream([mockTrack])
    mockGetUserMedia = vi.fn().mockResolvedValue(mockStream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
      configurable: true,
    })

    onStateChange = vi.fn()
    onDataAvailable = vi.fn()
    onNoSpeech = vi.fn()

    recorder = new AudioRecorder()
    recorder.setOnStateChange(onStateChange)
    recorder.setOnDataAvailable(onDataAvailable)
    recorder.setOnNoSpeech(onNoSpeech)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits one combined blob via setOnDataAvailable and transitions to stopped', async () => {
    await recorder.start()

    const mr = FakeMediaRecorder._instances[0]
    const chunk1 = new Blob(['part1'], { type: 'audio/webm;codecs=opus' })
    const chunk2 = new Blob(['part2'], { type: 'audio/webm;codecs=opus' })
    mr.ondataavailable?.({ data: chunk1 } as BlobEvent)
    mr.ondataavailable?.({ data: chunk2 } as BlobEvent)

    recorder.stop()

    expect(mockTrack.stop).toHaveBeenCalled()
    expect(recorder.getState()).toBe('stopped')
    expect(onStateChange).toHaveBeenCalledWith('stopped')

    expect(onDataAvailable).toHaveBeenCalledTimes(1)
    const emittedBlob = onDataAvailable.mock.calls[0][0] as Blob
    expect(emittedBlob).toBeInstanceOf(Blob)
    expect(emittedBlob.type).toBe('audio/webm;codecs=opus')
  })

  it('stops all tracks after stopping', async () => {
    const track2 = createMockTrack()
    const stream2 = createMockStream([mockTrack, track2])
    mockGetUserMedia.mockResolvedValue(stream2)

    await recorder.start()
    recorder.stop()

    expect(mockTrack.stop).toHaveBeenCalledTimes(1)
    expect(track2.stop).toHaveBeenCalledTimes(1)
  })

  it('does nothing when not recording', async () => {
    recorder.stop()
    expect(onDataAvailable).not.toHaveBeenCalled()
    expect(onNoSpeech).not.toHaveBeenCalled()
    expect(recorder.getState()).toBe('idle')
  })

  it('uses first chunk type as fallback when no MIME type is configured or available', async () => {
    FakeMediaRecorder._supportedTypes = new Set()
    await recorder.start()

    const mr = FakeMediaRecorder._instances[0]
    expect(mr.mimeType).toBe('')

    const chunk1 = new Blob(['audio-data'], { type: 'audio/ogg' })
    mr.ondataavailable?.({ data: chunk1 } as BlobEvent)

    recorder.stop()

    expect(onDataAvailable).toHaveBeenCalledTimes(1)
    const emittedBlob = onDataAvailable.mock.calls[0][0] as Blob
    expect(emittedBlob.type).toBe('audio/ogg')
  })
})

describe('AudioRecorder no-speech', () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>
  let mockTrack: ReturnType<typeof createMockTrack>
  let recorder: AudioRecorder
  let onDataAvailable: ReturnType<typeof vi.fn>
  let onNoSpeech: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    FakeMediaRecorder._instances = []
    FakeMediaRecorder._supportedTypes = new Set(['audio/webm;codecs=opus'])
    Object.defineProperty(window, 'MediaRecorder', {
      value: FakeMediaRecorder,
      writable: true,
      configurable: true,
    })

    mockTrack = createMockTrack()
    mockGetUserMedia = vi.fn().mockResolvedValue(createMockStream([mockTrack]))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
      configurable: true,
    })

    onDataAvailable = vi.fn()
    onNoSpeech = vi.fn()

    recorder = new AudioRecorder()
    recorder.setOnDataAvailable(onDataAvailable)
    recorder.setOnNoSpeech(onNoSpeech)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls setOnNoSpeech when no chunks were collected', async () => {
    await recorder.start()
    recorder.stop()

    expect(onNoSpeech).toHaveBeenCalledTimes(1)
    expect(onDataAvailable).not.toHaveBeenCalled()
  })

  it('calls setOnNoSpeech when the combined blob is zero size', async () => {
    await recorder.start()

    const mr = FakeMediaRecorder._instances[0]
    mr.ondataavailable?.({ data: new Blob([], { type: 'audio/webm;codecs=opus' }) } as BlobEvent)

    recorder.stop()

    expect(onNoSpeech).toHaveBeenCalledTimes(1)
    expect(onDataAvailable).not.toHaveBeenCalled()
  })

  it('calls setOnNoSpeech when decoded audio has no energy', async () => {
    class FakeAudioContext {
      decodeAudioData = vi.fn().mockResolvedValue({
        numberOfChannels: 1,
        getChannelData: () => new Float32Array([0, 0, 0, 0]),
      })

      close = vi.fn().mockResolvedValue(undefined)
    }

    Object.defineProperty(window, 'AudioContext', {
      value: FakeAudioContext,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      configurable: true,
    })
    await recorder.start()

    const mr = FakeMediaRecorder._instances[0]
    mr.ondataavailable?.({ data: new Blob(['encoded-silence'], { type: 'audio/webm;codecs=opus' }) } as BlobEvent)

    recorder.stop()

    await waitFor(() => expect(onNoSpeech).toHaveBeenCalledTimes(1))
    expect(onDataAvailable).not.toHaveBeenCalled()
  })
})

describe('AudioRecorder abort and dispose', () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>
  let mockTrack: ReturnType<typeof createMockTrack>
  let recorder: AudioRecorder
  let onDataAvailable: ReturnType<typeof vi.fn>
  let onStateChange: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    FakeMediaRecorder._instances = []
    FakeMediaRecorder._supportedTypes = new Set(['audio/webm;codecs=opus'])
    Object.defineProperty(window, 'MediaRecorder', {
      value: FakeMediaRecorder,
      writable: true,
      configurable: true,
    })

    mockTrack = createMockTrack()
    mockGetUserMedia = vi.fn().mockResolvedValue(createMockStream([mockTrack]))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
      configurable: true,
    })

    onDataAvailable = vi.fn()
    onStateChange = vi.fn()

    recorder = new AudioRecorder()
    recorder.setOnDataAvailable(onDataAvailable)
    recorder.setOnStateChange(onStateChange)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('abort stops tracks and transitions to idle', async () => {
    await recorder.start()

    const mr = FakeMediaRecorder._instances[0]
    mr.ondataavailable?.({ data: new Blob(['audio-data']) } as BlobEvent)

    recorder.abort()

    expect(mockTrack.stop).toHaveBeenCalled()
    expect(onDataAvailable).not.toHaveBeenCalled()
    expect(recorder.getState()).toBe('idle')
  })

  it('dispose stops tracks and transitions to idle', async () => {
    await recorder.start()

    const mr = FakeMediaRecorder._instances[0]
    mr.ondataavailable?.({ data: new Blob(['audio-data']) } as BlobEvent)

    recorder.dispose()

    expect(mockTrack.stop).toHaveBeenCalled()
    expect(onDataAvailable).not.toHaveBeenCalled()
    expect(recorder.getState()).toBe('idle')
  })
})

describe('AudioRecorder error handling', () => {
  let recorder: AudioRecorder
  let onError: ReturnType<typeof vi.fn>
  let onStateChange: ReturnType<typeof vi.fn>

  beforeEach(() => {
    Object.defineProperty(window, 'MediaRecorder', {
      value: FakeMediaRecorder,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      writable: true,
      configurable: true,
    })

    onError = vi.fn()
    onStateChange = vi.fn()

    recorder = new AudioRecorder()
    recorder.setOnError(onError)
    recorder.setOnStateChange(onStateChange)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps NotAllowedError to Microphone permission denied', async () => {
    const error = new DOMException('Permission denied', 'NotAllowedError')
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(error)

    await expect(recorder.start()).rejects.toThrow()
    expect(onError).toHaveBeenCalledWith('Microphone permission denied')
    expect(recorder.getState()).toBe('error')
  })

  it('maps NotFoundError to No microphone found', async () => {
    const error = new DOMException('No device found', 'NotFoundError')
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(error)

    await expect(recorder.start()).rejects.toThrow()
    expect(onError).toHaveBeenCalledWith('No microphone found')
    expect(recorder.getState()).toBe('error')
  })

  it('maps other DOMException to formatted message', async () => {
    const error = new DOMException('Something else', 'SecurityError')
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(error)

    await expect(recorder.start()).rejects.toThrow()
    expect(onError).toHaveBeenCalledWith('Microphone error: Something else')
    expect(recorder.getState()).toBe('error')
  })

  it('maps non-DOMException errors to Failed to start recording', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error('Network error'))

    await expect(recorder.start()).rejects.toThrow()
    expect(onError).toHaveBeenCalledWith('Failed to start recording')
    expect(recorder.getState()).toBe('error')
  })

  it('transitions to error state on microphone failure', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error('fail'))

    await expect(recorder.start()).rejects.toThrow()
    expect(onStateChange).toHaveBeenCalledWith('error')
  })
})
