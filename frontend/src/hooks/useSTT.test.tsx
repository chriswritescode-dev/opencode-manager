import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSTT } from './useSTT'

type MockRecorder = {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  getState: ReturnType<typeof vi.fn>
  setOnStateChange: ReturnType<typeof vi.fn>
  setOnError: ReturnType<typeof vi.fn>
  setOnDataAvailable: ReturnType<typeof vi.fn>
  setOnNoSpeech: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
  AudioRecorder: Object.assign(vi.fn(), { isSupported: vi.fn() }),
  getWebSpeechRecognizer: vi.fn(),
  isWebRecognitionSupported: vi.fn(),
  sttApi: { transcribe: vi.fn() },
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

vi.mock('@/lib/audioRecorder', () => ({
  AudioRecorder: mocks.AudioRecorder,
}))

vi.mock('@/lib/webSpeechRecognizer', () => ({
  getWebSpeechRecognizer: mocks.getWebSpeechRecognizer,
  isWebRecognitionSupported: mocks.isWebRecognitionSupported,
}))

vi.mock('@/api/stt', () => ({
  sttApi: mocks.sttApi,
}))

const externalSTTPreferences = {
  preferences: {
    stt: {
      enabled: true,
      provider: 'external' as const,
      endpoint: 'https://api.openai.com',
      apiKey: 'test-key',
      model: 'whisper-1',
      language: 'en-US',
    },
  },
}

describe('useSTT external provider lifecycle', () => {
  let mockRecorder: MockRecorder

  beforeEach(() => {
    vi.clearAllMocks()

    mockRecorder = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      abort: vi.fn(),
      dispose: vi.fn(),
      getState: vi.fn().mockReturnValue('recording'),
      setOnStateChange: vi.fn(),
      setOnError: vi.fn(),
      setOnDataAvailable: vi.fn(),
      setOnNoSpeech: vi.fn(),
    }

    mocks.AudioRecorder.mockImplementation(() => mockRecorder)
    mocks.AudioRecorder.isSupported.mockReturnValue(true)
    mocks.useSettings.mockReturnValue(externalSTTPreferences)
    mocks.getWebSpeechRecognizer.mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      clearCallbacks: vi.fn(),
      onResult: vi.fn(),
      onInterimResult: vi.fn(),
      onError: vi.fn(),
      onEnd: vi.fn(),
      onStart: vi.fn(),
    })
    mocks.isWebRecognitionSupported.mockReturnValue(true)
  })

  it('returns false when external provider is not supported', async () => {
    mocks.AudioRecorder.isSupported = vi.fn().mockReturnValue(false)

    const { result } = renderHook(() => useSTT())

    let started: boolean | undefined
    await act(async () => {
      started = await result.current.startRecording()
    })

    expect(started).toBe(false)
    expect(result.current.isError).toBe(true)
    expect(result.current.error).toBe('Speech recognition is not supported in this browser')
  })

  it('does not instantiate AudioRecorder until startRecording is called', async () => {
    const { result } = renderHook(() => useSTT())

    expect(mocks.AudioRecorder).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.startRecording()
    })

    expect(mocks.AudioRecorder).toHaveBeenCalledTimes(1)
    expect(mockRecorder.start).toHaveBeenCalledTimes(1)
  })

  it('clears processing without an error when no speech is detected', async () => {
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.startRecording()
    })

    const onNoSpeech = mockRecorder.setOnNoSpeech.mock.calls[0][0] as () => void

    act(() => {
      onNoSpeech()
    })

    expect(result.current.isProcessing).toBe(false)
    expect(result.current.isRecording).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('does not get stuck processing when stopping a silent recording', async () => {
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.startRecording()
    })

    const onNoSpeech = mockRecorder.setOnNoSpeech.mock.calls[0][0] as () => void
    mockRecorder.stop.mockImplementation(() => {
      onNoSpeech()
    })

    act(() => {
      result.current.stopRecording()
    })

    expect(result.current.isProcessing).toBe(false)
    expect(result.current.isRecording).toBe(false)
    expect(result.current.isError).toBe(false)
  })

  it('ignores stopRecording when the recorder is not recording', async () => {
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.startRecording()
    })

    mockRecorder.getState.mockReturnValue('stopped')

    act(() => {
      result.current.stopRecording()
    })

    expect(mockRecorder.stop).not.toHaveBeenCalled()
    expect(result.current.isProcessing).toBe(false)
  })

  it('disposes external recorder resources on unmount', async () => {
    const { result, unmount } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.startRecording()
    })

    const recorder = mockRecorder

    unmount()

    expect(recorder.dispose).toHaveBeenCalledTimes(1)
    expect(recorder.abort).not.toHaveBeenCalled()
  })

  it('successfully transcribes recorded audio', async () => {
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.startRecording()
    })

    const onStateChange = mockRecorder.setOnStateChange.mock.calls[0][0] as (state: string) => void
    const onDataAvailable = mockRecorder.setOnDataAvailable.mock.calls[0][0] as (blob: Blob) => void

    act(() => {
      onStateChange('recording')
    })

    expect(result.current.isRecording).toBe(true)
    expect(result.current.state).toBe('listening')
    expect(result.current.interimTranscript).toBe('Recording...')

    mocks.sttApi.transcribe.mockResolvedValueOnce({ text: 'hello world' })
    const audioBlob = new Blob([], { type: 'audio/webm;codecs=opus' })

    await act(async () => {
      await onDataAvailable(audioBlob)
    })

    expect(result.current.transcript).toBe('hello world')
    expect(result.current.interimTranscript).toBe('')
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.state).toBe('idle')
  })

  it('does not show error when transcription is canceled', async () => {
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.startRecording()
    })

    const onDataAvailable = mockRecorder.setOnDataAvailable.mock.calls[0][0] as (blob: Blob) => void

    let rejectTranscribe!: (reason: unknown) => void
    const transcribePromise = new Promise((_resolve, reject) => {
      rejectTranscribe = reject
    })
    mocks.sttApi.transcribe.mockReturnValue(transcribePromise)

    const audioBlob = new Blob([], { type: 'audio/webm;codecs=opus' })

    act(() => {
      onDataAvailable(audioBlob)
    })

    const signalArg = mocks.sttApi.transcribe.mock.calls[0][2] as AbortSignal
    expect(signalArg).toBeDefined()
    expect(signalArg.aborted).toBe(false)

    act(() => {
      result.current.abortRecording()
    })

    expect(signalArg.aborted).toBe(true)

    const cancelError = new Error('canceled')
    cancelError.name = 'CanceledError'
    rejectTranscribe(cancelError)

    await waitFor(() => {
      expect(result.current.isError).toBe(false)
    })

    expect(result.current.error).toBeNull()
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.state).toBe('idle')
  })
})

const builtinSTTPreferences = {
  preferences: {
    stt: {
      enabled: true,
      provider: 'builtin' as const,
      endpoint: '',
      apiKey: '',
      model: '',
      language: 'en-US',
    },
  },
}

describe('useSTT builtin provider lifecycle', () => {
  let mockRecognizer: {
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    abort: ReturnType<typeof vi.fn>
    clearCallbacks: ReturnType<typeof vi.fn>
    onResult: ReturnType<typeof vi.fn>
    onInterimResult: ReturnType<typeof vi.fn>
    onError: ReturnType<typeof vi.fn>
    onEnd: ReturnType<typeof vi.fn>
    onStart: ReturnType<typeof vi.fn>
  }

  const registeredCallbacks: {
    onResult: Array<(result: { transcript: string; isFinal: boolean; confidence: number }) => void>
    onInterimResult: Array<(transcript: string) => void>
    onError: Array<(error: string) => void>
    onEnd: Array<() => void>
    onStart: Array<() => void>
  } = {
    onResult: [],
    onInterimResult: [],
    onError: [],
    onEnd: [],
    onStart: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    registeredCallbacks.onResult = []
    registeredCallbacks.onInterimResult = []
    registeredCallbacks.onError = []
    registeredCallbacks.onEnd = []
    registeredCallbacks.onStart = []

    mockRecognizer = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      abort: vi.fn(),
      clearCallbacks: vi.fn(),
      onResult: vi.fn((cb: (result: { transcript: string; isFinal: boolean; confidence: number }) => void) => {
        registeredCallbacks.onResult.push(cb)
      }),
      onInterimResult: vi.fn((cb: (transcript: string) => void) => {
        registeredCallbacks.onInterimResult.push(cb)
      }),
      onError: vi.fn((cb: (error: string) => void) => {
        registeredCallbacks.onError.push(cb)
      }),
      onEnd: vi.fn((cb: () => void) => {
        registeredCallbacks.onEnd.push(cb)
      }),
      onStart: vi.fn((cb: () => void) => {
        registeredCallbacks.onStart.push(cb)
      }),
    }

    mocks.useSettings.mockReturnValue(builtinSTTPreferences)
    mocks.getWebSpeechRecognizer.mockReturnValue(mockRecognizer)
    mocks.isWebRecognitionSupported.mockReturnValue(true)
  })

  it('starts recognition with correct options for builtin provider', async () => {
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.startRecording()
    })

    expect(mockRecognizer.start).toHaveBeenCalledWith({
      language: 'en-US',
      interimResults: true,
      maxAlternatives: 1,
    })
  })

  it('onStart callback sets isRecording=true and state=listening', async () => {
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      registeredCallbacks.onStart[0]()
    })

    expect(result.current.isRecording).toBe(true)
    expect(result.current.state).toBe('listening')
  })

  it('onInterimResult callback updates interimTranscript', async () => {
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      registeredCallbacks.onStart[0]()
      registeredCallbacks.onInterimResult[0]('partial')
    })

    await waitFor(() => {
      expect(result.current.interimTranscript).toBe('partial')
    })
  })

  it('onResult callback appends final transcript, clears processing, and keeps isRecording=true', async () => {
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      registeredCallbacks.onStart[0]()
    })

    act(() => {
      registeredCallbacks.onResult[0]({
        transcript: 'final',
        isFinal: true,
        confidence: 1,
      })
    })

    expect(result.current.transcript).toBe('final')
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.isRecording).toBe(true)
    expect(result.current.state).toBe('listening')
  })

  it('onEnd callback resets to idle', async () => {
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      registeredCallbacks.onEnd[0]()
    })

    expect(result.current.isRecording).toBe(false)
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.state).toBe('idle')
  })

  it('abortRecording calls recognizer abort and resets state', async () => {
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      registeredCallbacks.onStart[0]()
    })

    act(() => {
      result.current.abortRecording()
    })

    expect(mockRecognizer.abort).toHaveBeenCalledTimes(1)
    expect(result.current.transcript).toBe('')
    expect(result.current.interimTranscript).toBe('')
    expect(result.current.isRecording).toBe(false)
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.state).toBe('idle')
  })
})
