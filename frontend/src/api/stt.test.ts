import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sttApi } from './stt'
import { FetchError } from './fetchWrapper'

describe('WAV extension selection logic', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    global.fetch = originalFetch
  })

  const createMockResponse = (ok = true, data = {}) => {
    return new Response(JSON.stringify(data), {
      status: ok ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('should return wav for audio/wav blob', async () => {
    const blob = new Blob([], { type: 'audio/wav' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob, 'test-user')

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.wav')
  })

  it('should return webm for audio/webm blob', async () => {
    const blob = new Blob([], { type: 'audio/webm' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob, 'test-user')

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.webm')
  })

  it('should return ogg for audio/ogg blob', async () => {
    const blob = new Blob([], { type: 'audio/ogg' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob, 'test-user')

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.ogg')
  })

  it('should return m4a for audio/mp4 blob', async () => {
    const blob = new Blob([], { type: 'audio/mp4' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob, 'test-user')

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.m4a')
  })

  it('should return webm for audio/webm;codecs=opus blob', async () => {
    const blob = new Blob([], { type: 'audio/webm;codecs=opus' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob, 'test-user')

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.webm')
  })

  it('should default to wav for unknown types', async () => {
    const blob = new Blob([], { type: 'audio/unknown' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob, 'test-user')

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.wav')
  })

  it('should prioritize wav over webm when both present', async () => {
    const blob = new Blob([], { type: 'audio/wav;codecs=pcm' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob, 'test-user')

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.wav')
  })

  it('should include userId in request URL', async () => {
    const blob = new Blob([], { type: 'audio/wav' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob, 'custom-user')

    const callArgs = mockFetch.mock.calls[0]
    const url = callArgs[0] as string
    expect(url).toContain('userId=custom-user')
  })

  it('should send FormData with audio file', async () => {
    const blob = new Blob(['audio data'], { type: 'audio/wav' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'transcribed text' }))

    await sttApi.transcribe(blob, 'test-user')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/stt/transcribe'),
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      })
    )

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    expect(formData.get('audio')).toBeInstanceOf(File)
  })
})

describe('sttApi.transcribe cancellation and timeout', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    global.fetch = originalFetch
  })

  it('throws 499 CANCELED when caller aborts', async () => {
    const blob = new Blob([], { type: 'audio/webm;codecs=opus' })
    const abortController = new AbortController()

    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockImplementation((_url: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        if (signal.aborted) {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
          return
        }
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        }, { once: true })
      })
    })

    const promise = sttApi.transcribe(blob, 'test-user', abortController.signal)

    abortController.abort()

    await expect(promise).rejects.toThrow(FetchError)
    await expect(promise).rejects.toMatchObject({
      statusCode: 499,
      code: 'CANCELED',
    })
  })

  it('throws 408 TIMEOUT when transcription times out', async () => {
    vi.useFakeTimers()

    const blob = new Blob([], { type: 'audio/webm;codecs=opus' })

    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockImplementation((_url: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        if (signal.aborted) {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
          return
        }
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        }, { once: true })
      })
    })

    const promise = sttApi.transcribe(blob, 'test-user')

    vi.advanceTimersByTime(60000)

    await expect(promise).rejects.toThrow(FetchError)
    await expect(promise).rejects.toMatchObject({
      statusCode: 408,
      code: 'TIMEOUT',
    })

    vi.useRealTimers()
  })
})
