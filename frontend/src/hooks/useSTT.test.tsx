import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSTT } from './useSTT'

type MockRecorder = {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  prepare: ReturnType<typeof vi.fn>
  setOnStateChange: ReturnType<typeof vi.fn>
  setOnError: ReturnType<typeof vi.fn>
  setOnDataAvailable: ReturnType<typeof vi.fn>
  setOnNoSpeech: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
  AudioRecorder: vi.fn(),
  getWebSpeechRecognizer: vi.fn(),
  isWebRecognitionSupported: vi.fn(),
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
      prepare: vi.fn().mockResolvedValue(undefined),
      setOnStateChange: vi.fn(),
      setOnError: vi.fn(),
      setOnDataAvailable: vi.fn(),
      setOnNoSpeech: vi.fn(),
    }

    mocks.AudioRecorder.mockImplementation(() => mockRecorder)
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

  it('does not start external recording until startRecording is called', async () => {
    const { result } = renderHook(() => useSTT())

    await waitFor(() => {
      expect(mocks.AudioRecorder).toHaveBeenCalledTimes(1)
    })

    expect(mockRecorder.start).not.toHaveBeenCalled()
    expect(mockRecorder.prepare).toHaveBeenCalledTimes(1)
    expect(mockRecorder.setOnStateChange).toHaveBeenCalledTimes(1)
    expect(mockRecorder.setOnError).toHaveBeenCalledTimes(1)
    expect(mockRecorder.setOnDataAvailable).toHaveBeenCalledTimes(1)
    expect(mockRecorder.setOnNoSpeech).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.startRecording()
    })

    expect(mockRecorder.start).toHaveBeenCalledTimes(1)
  })

  it('clears processing without an error when no speech is detected', async () => {
    const { result } = renderHook(() => useSTT())

    await waitFor(() => {
      expect(mockRecorder.setOnNoSpeech).toHaveBeenCalledTimes(1)
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

  it('disposes external recorder resources on unmount', async () => {
    const { unmount } = renderHook(() => useSTT())

    await waitFor(() => {
      expect(mocks.AudioRecorder).toHaveBeenCalledTimes(1)
    })

    const recorder = mockRecorder

    unmount()

    expect(recorder.dispose).toHaveBeenCalledTimes(1)
    expect(recorder.abort).not.toHaveBeenCalled()
  })
})
