import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_STT_CONFIG } from '@/api/types/settings'
import { getWebSpeechRecognizer } from '@/lib/webSpeechRecognizer'
import { installAudioRecorder, installSpeechRecognition } from '@/test/browserFakes'
import { makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import { createTestQueryClient, renderHookWithProviders } from '@/test/render'
import type { FetchRouteResult } from '@/test/fetchFake'
import { useSTT } from './useSTT'

const recognition = installSpeechRecognition()
const RecognitionClass = window.SpeechRecognition

const sttPreferences = (provider: 'external' | 'builtin') => makeUserPreferences({
  stt: {
    ...DEFAULT_STT_CONFIG,
    enabled: true,
    provider,
    endpoint: 'https://api.openai.com',
    apiKey: 'test-key',
    model: 'whisper-1',
  },
})

function renderStt(provider: 'external' | 'builtin', extraRoutes: Array<{
  method: 'POST'
  path: string
  respond: () => FetchRouteResult | Promise<FetchRouteResult>
}> = []) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(['settings', 'default'], makeSettingsResponse({ preferences: sttPreferences(provider) }))
  return renderHookWithProviders(() => useSTT(), {
    auth: false,
    theme: false,
    tts: false,
    toaster: false,
    queryClient,
    fetchRoutes: [
      ...extraRoutes,
      { method: 'GET', path: '/api/settings', respond: () => ({ json: makeSettingsResponse({ preferences: sttPreferences(provider) }) }) },
      { method: 'POST', path: '/api/stt/transcribe', respond: () => ({ json: { text: 'hello world' } }) },
    ],
  })
}

function deferredTranscription() {
  let resolve: (result: FetchRouteResult) => void = () => undefined
  let reject: (cause: Error) => void = () => undefined
  const promise = new Promise<FetchRouteResult>((resolveResult, rejectResult) => {
    resolve = resolveResult
    reject = rejectResult
  })
  return { promise, resolve, reject }
}

function speechRecognitionStart(instance: { start: ReturnType<typeof vi.fn> }) {
  instance.start = vi.fn()
}

function autoStartRecognition(instance: { start: ReturnType<typeof vi.fn>, onstart: ((event: Event) => void) | null }) {
  instance.start = vi.fn(() => {
    setTimeout(() => instance.onstart?.(new Event('start')), 0)
  })
}

beforeEach(() => {
  getWebSpeechRecognizer().abort()
  vi.clearAllMocks()
  vi.stubGlobal('SpeechRecognition', RecognitionClass)
  vi.stubGlobal('webkitSpeechRecognition', RecognitionClass)
  const instance = recognition.instances[0]
  if (instance) autoStartRecognition(instance)
})

describe('useSTT external provider lifecycle', () => {
  it('returns false when the external provider is not supported', async () => {
    const { result } = renderStt('external')

    let started = true
    await act(async () => {
      started = await result.current.startRecording()
    })

    expect(started).toBe(false)
    expect(result.current.isError).toBe(true)
    expect(result.current.error).toBe('Speech recognition is not supported in this browser')
  })

  it('does not start capturing until startRecording is called', async () => {
    const recorder = installAudioRecorder()
    const { result } = renderStt('external')

    expect(recorder.getUserMedia).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.startRecording()
    })

    expect(recorder.getUserMedia).toHaveBeenCalledTimes(1)
    expect(result.current.isRecording).toBe(true)
  })

  it('stays tap-to-send with the external provider even when endpointing is requested', async () => {
    installAudioRecorder()
    const { result } = renderStt('external')
    const onEndOfSpeech = vi.fn()

    let started = false
    await act(async () => {
      started = await result.current.startRecording({
        endpointing: { pauseMs: 800, noSpeechTimeoutMs: 5000 },
        onEndOfSpeech,
      })
    })

    expect(started).toBe(true)
    expect(result.current.isEndpointing).toBe(false)
    expect(recognition.instances[0]?.start).not.toHaveBeenCalled()
    expect(onEndOfSpeech).not.toHaveBeenCalled()
  })

  it('clears processing without an error when stopping a silent recording', async () => {
    const recorder = installAudioRecorder()
    const { result } = renderStt('external')

    await act(async () => {
      await result.current.startRecording()
    })

    const mediaRecorder = recorder.instances[0]
    mediaRecorder.stop = vi.fn(() => {
      mediaRecorder.ondataavailable?.({ data: new Blob([], { type: 'audio/webm' }) })
      mediaRecorder.onstop?.()
    })

    act(() => {
      result.current.stopRecording()
    })

    expect(result.current.isProcessing).toBe(false)
    expect(result.current.isRecording).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('ignores stopRecording when the recorder is no longer recording', async () => {
    const recorder = installAudioRecorder()
    const { result } = renderStt('external')

    await act(async () => {
      await result.current.startRecording()
    })

    await act(async () => {
      result.current.stopRecording()
    })
    act(() => {
      result.current.stopRecording()
    })

    expect(recorder.instances[0].stop).toHaveBeenCalledTimes(1)
    expect(result.current.isProcessing).toBe(false)
  })

  it('releases the microphone stream on unmount', async () => {
    const recorder = installAudioRecorder()
    const stopTrack = vi.fn()
    recorder.getUserMedia.mockImplementation(async () => ({ getTracks: () => [{ stop: stopTrack }] }))
    const { result, unmount, fetchFake } = renderStt('external')

    await act(async () => {
      await result.current.startRecording()
    })

    unmount()

    expect(stopTrack).toHaveBeenCalledTimes(1)
    expect(fetchFake.findRequests('POST', '/api/stt/transcribe')).toHaveLength(0)
  })

  it('successfully transcribes recorded audio', async () => {
    const recorder = installAudioRecorder()
    const { result, fetchFake } = renderStt('external')

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      recorder.instances[0].ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) })
      recorder.instances[0].onstop?.()
    })

    expect(result.current.isProcessing).toBe(true)
    await waitFor(() => expect(result.current.transcript).toBe('hello world'))
    expect(result.current.interimTranscript).toBe('')
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.state).toBe('idle')
    expect(fetchFake.findFormData()?.get('audio')).toBeInstanceOf(Blob)
  })

  it('does not show an error when transcription is canceled', async () => {
    const recorder = installAudioRecorder()
    const transcription = deferredTranscription()
    const { result } = renderStt('external', [
      { method: 'POST', path: '/api/stt/transcribe', respond: () => transcription.promise },
    ])

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      recorder.instances[0].ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) })
      recorder.instances[0].onstop?.()
    })

    expect(result.current.isProcessing).toBe(true)

    act(() => {
      result.current.abortRecording()
    })

    await act(async () => {
      const abortError = new Error('canceled')
      abortError.name = 'AbortError'
      transcription.reject(abortError)
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.isProcessing).toBe(false))
    expect(result.current.isError).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.state).toBe('idle')
  })
})

describe('useSTT builtin provider lifecycle', () => {
  it('starts recognition with the configured language and interim results, without endpointing', async () => {
    const { result } = renderStt('builtin')

    await act(async () => {
      await result.current.startRecording()
    })

    const instance = recognition.instances[0]
    expect(instance.lang).toBe('en-US')
    expect(instance.interimResults).toBe(true)
    expect(instance.maxAlternatives).toBe(1)
    expect(result.current.isEndpointing).toBe(false)
  })

  it('reports starting until the recognizer reports that capture began', async () => {
    const { result } = renderStt('builtin')
    const instance = recognition.instances[0]
    speechRecognitionStart(instance)

    let startPromise: Promise<boolean> | undefined
    act(() => {
      startPromise = result.current.startRecording()
    })

    expect(result.current.isStarting).toBe(true)

    await act(async () => {
      instance.onstart?.(new Event('start'))
      await startPromise
    })

    expect(result.current.isStarting).toBe(false)
    expect(result.current.isRecording).toBe(true)
    expect(result.current.state).toBe('listening')
  })

  it('marks the capture as recording when the recognizer starts', async () => {
    const { result } = renderStt('builtin')

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      recognition.instances[0].onstart?.(new Event('start'))
    })

    expect(result.current.isRecording).toBe(true)
    expect(result.current.state).toBe('listening')
  })

  it('updates the interim transcript from interim results', async () => {
    const { result } = renderStt('builtin')

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      recognition.instances[0].onstart?.(new Event('start'))
    })
    act(() => {
      recognition.emitResult(recognition.instances[0], 'partial', false)
    })

    await waitFor(() => expect(result.current.interimTranscript).toBe('partial'))
  })

  it('appends the final transcript and keeps listening after a final result', async () => {
    const { result } = renderStt('builtin')

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      recognition.instances[0].onstart?.(new Event('start'))
    })
    act(() => {
      recognition.emitResult(recognition.instances[0], 'final', true)
    })

    expect(result.current.transcript).toBe('final')
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.isRecording).toBe(true)
    expect(result.current.state).toBe('listening')
  })

  it('resets to idle when the recognizer ends', async () => {
    const { result } = renderStt('builtin')

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      recognition.instances[0].onend?.(new Event('end'))
    })

    expect(result.current.isRecording).toBe(false)
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.state).toBe('idle')
  })

  it('aborts the recognizer and resets the transcript', async () => {
    const { result } = renderStt('builtin')

    await act(async () => {
      await result.current.startRecording()
    })

    act(() => {
      recognition.instances[0].onstart?.(new Event('start'))
    })
    act(() => {
      result.current.abortRecording()
    })

    expect(recognition.instances[0].abort).toHaveBeenCalledTimes(1)
    expect(result.current.transcript).toBe('')
    expect(result.current.interimTranscript).toBe('')
    expect(result.current.isRecording).toBe(false)
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.state).toBe('idle')
  })

  it('applies endpointing and reports the pause endpoint with the final transcript', async () => {
    const { result } = renderStt('builtin')
    const instance = recognition.instances[0]
    speechRecognitionStart(instance)
    const onEndOfSpeech = vi.fn()

    vi.useFakeTimers()
    try {
      let startPromise: Promise<boolean> | undefined
      act(() => {
        startPromise = result.current.startRecording({
          endpointing: { pauseMs: 800, noSpeechTimeoutMs: 5000 },
          onEndOfSpeech,
        })
      })
      await act(async () => {
        instance.onstart?.(new Event('start'))
        await startPromise
      })

      expect(result.current.isEndpointing).toBe(true)

      act(() => {
        recognition.emitResult(instance, 'hello world', true)
      })
      act(() => {
        vi.advanceTimersByTime(800)
      })
      act(() => {
        instance.onend?.(new Event('end'))
      })

      expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
      expect(onEndOfSpeech).toHaveBeenCalledWith('pause', 'hello world')
      expect(result.current.transcript).toBe('hello world')
      expect(result.current.isEndpointing).toBe(false)
      expect(result.current.isError).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a no-speech endpoint without surfacing an error', async () => {
    const { result } = renderStt('builtin')
    const instance = recognition.instances[0]
    speechRecognitionStart(instance)
    const onEndOfSpeech = vi.fn()

    vi.useFakeTimers()
    try {
      let startPromise: Promise<boolean> | undefined
      act(() => {
        startPromise = result.current.startRecording({
          endpointing: { pauseMs: 800, noSpeechTimeoutMs: 1500 },
          onEndOfSpeech,
        })
      })
      await act(async () => {
        instance.onstart?.(new Event('start'))
        await startPromise
      })

      act(() => {
        vi.advanceTimersByTime(1500)
      })
      act(() => {
        instance.onend?.(new Event('end'))
      })

      expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
      expect(onEndOfSpeech).toHaveBeenCalledWith('no-speech', '')
      expect(result.current.isError).toBe(false)
      expect(result.current.error).toBeNull()
      expect(result.current.transcript).toBe('')
      expect(result.current.isEndpointing).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not report end of speech for a manual stop or abort', async () => {
    const { result } = renderStt('builtin')
    const instance = recognition.instances[0]
    speechRecognitionStart(instance)
    const onEndOfSpeech = vi.fn()

    let startPromise: Promise<boolean> | undefined
    act(() => {
      startPromise = result.current.startRecording({
        endpointing: { pauseMs: 800, noSpeechTimeoutMs: 5000 },
        onEndOfSpeech,
      })
    })
    await act(async () => {
      instance.onstart?.(new Event('start'))
      await startPromise
    })

    act(() => {
      result.current.stopRecording()
      instance.onend?.(new Event('end'))
      result.current.abortRecording()
    })

    expect(onEndOfSpeech).not.toHaveBeenCalled()
    expect(result.current.isEndpointing).toBe(false)
  })
})
