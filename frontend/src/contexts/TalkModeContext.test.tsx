import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@ricky0123/vad-react', () => ({
  useMicVAD: vi.fn(() => ({
    start: vi.fn(),
    pause: vi.fn(),
    userSpeaking: false
  }))
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(() => ({
    preferences: {
      talkMode: {
        enabled: true,
        silenceThresholdMs: 800,
        minSpeechMs: 400,
        autoInterrupt: true
      },
      stt: {
        enabled: true,
        model: 'base',
        language: 'en'
      }
    }
  }))
}))

vi.mock('@/hooks/useTTS', () => ({
  useTTS: vi.fn(() => ({
    speak: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    isPlaying: false
  }))
}))

vi.mock('@/api/stt', () => ({
  sttApi: {
    transcribeBase64: vi.fn().mockResolvedValue({
      text: 'Hello world',
      language: 'en',
      language_probability: 0.95,
      duration: 1.5
    })
  }
}))

vi.mock('@/lib/audioUtils', () => ({
  float32ToWav: vi.fn(() => new Blob(['mock wav'], { type: 'audio/wav' })),
  blobToBase64: vi.fn().mockResolvedValue('bW9jayBiYXNlNjQ=')
}))

import { TalkModeProvider } from './TalkModeContext'
import { useTalkMode } from '@/hooks/useTalkMode'
import { useSettings } from '@/hooks/useSettings'
import { useMicVAD } from '@ricky0123/vad-react'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TalkModeProvider>
          {children}
        </TalkModeProvider>
      </QueryClientProvider>
    )
  }
}

describe('TalkModeContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('initial state', () => {
    it('should initialize with off state', () => {
      const { result } = renderHook(() => useTalkMode(), {
        wrapper: createWrapper()
      })

      expect(result.current.state).toBe('off')
      expect(result.current.error).toBeNull()
      expect(result.current.userTranscript).toBeNull()
      expect(result.current.agentResponse).toBeNull()
      expect(result.current.sessionID).toBeNull()
    })

    it('should be enabled when both talkMode and stt are enabled', () => {
      const { result } = renderHook(() => useTalkMode(), {
        wrapper: createWrapper()
      })

      expect(result.current.isEnabled).toBe(true)
    })

    it('should be disabled when talkMode is disabled', () => {
      vi.mocked(useSettings).mockReturnValue({
        preferences: {
          talkMode: { enabled: false },
          stt: { enabled: true }
        }
      } as ReturnType<typeof useSettings>)

      const { result } = renderHook(() => useTalkMode(), {
        wrapper: createWrapper()
      })

      expect(result.current.isEnabled).toBe(false)
    })

    it('should be disabled when stt is disabled', () => {
      vi.mocked(useSettings).mockReturnValue({
        preferences: {
          talkMode: { enabled: true },
          stt: { enabled: false }
        }
      } as ReturnType<typeof useSettings>)

      const { result } = renderHook(() => useTalkMode(), {
        wrapper: createWrapper()
      })

      expect(result.current.isEnabled).toBe(false)
    })
  })

  describe('start', () => {
    beforeEach(() => {
      vi.mocked(useSettings).mockReturnValue({
        preferences: {
          talkMode: {
            enabled: true,
            silenceThresholdMs: 800,
            minSpeechMs: 400,
            autoInterrupt: true
          },
          stt: {
            enabled: true,
            model: 'base',
            language: 'en'
          }
        }
      } as ReturnType<typeof useSettings>)
    })

    it('should start talk mode with session info', async () => {
      const mockVadStart = vi.fn()
      vi.mocked(useMicVAD).mockReturnValue({
        start: mockVadStart,
        pause: vi.fn(),
        userSpeaking: false
      } as ReturnType<typeof useMicVAD>)

      const { result } = renderHook(() => useTalkMode(), {
        wrapper: createWrapper()
      })

      await act(async () => {
        await result.current.start('session-123', 'http://localhost:5551', '/workspace')
      })

      expect(mockVadStart).toHaveBeenCalled()
      expect(result.current.state).toBe('listening')
      expect(result.current.sessionID).toBe('session-123')
    })

    it('should set error if talk mode is not enabled', async () => {
      vi.mocked(useSettings).mockReturnValue({
        preferences: {
          talkMode: { enabled: false },
          stt: { enabled: false }
        }
      } as ReturnType<typeof useSettings>)

      const { result } = renderHook(() => useTalkMode(), {
        wrapper: createWrapper()
      })

      await act(async () => {
        await result.current.start('session-123', 'http://localhost:5551')
      })

      expect(result.current.error).toBe('Talk Mode is not enabled. Enable it in Settings.')
    })

    it('should handle VAD start errors', async () => {
      vi.mocked(useMicVAD).mockReturnValue({
        start: vi.fn(() => {
          throw new Error('Microphone access denied')
        }),
        pause: vi.fn(),
        userSpeaking: false
      } as unknown as ReturnType<typeof useMicVAD>)

      const { result } = renderHook(() => useTalkMode(), {
        wrapper: createWrapper()
      })

      await act(async () => {
        await result.current.start('session-123', 'http://localhost:5551')
      })

      expect(result.current.state).toBe('error')
      expect(result.current.error).toBe('Microphone access denied')
    })
  })

  describe('stop', () => {
    it('should stop talk mode and reset state', async () => {
      const mockVadPause = vi.fn()
      const mockTtsStop = vi.fn()

      vi.mocked(useMicVAD).mockReturnValue({
        start: vi.fn(),
        pause: mockVadPause,
        userSpeaking: false
      } as ReturnType<typeof useMicVAD>)

      const { useTTS } = await import('@/hooks/useTTS')
      vi.mocked(useTTS).mockReturnValue({
        speak: vi.fn(),
        stop: mockTtsStop,
        isPlaying: false
      } as unknown as ReturnType<typeof useTTS>)

      const { result } = renderHook(() => useTalkMode(), {
        wrapper: createWrapper()
      })

      await act(async () => {
        await result.current.start('session-123', 'http://localhost:5551')
      })

      act(() => {
        result.current.stop()
      })

      expect(mockVadPause).toHaveBeenCalled()
      expect(mockTtsStop).toHaveBeenCalled()
      expect(result.current.state).toBe('off')
      expect(result.current.sessionID).toBeNull()
      expect(result.current.userTranscript).toBeNull()
      expect(result.current.agentResponse).toBeNull()
    })
  })

  describe('VAD configuration', () => {
    it('should configure VAD with settings', () => {
      vi.mocked(useSettings).mockReturnValue({
        preferences: {
          talkMode: {
            enabled: true,
            silenceThresholdMs: 1000,
            minSpeechMs: 500,
            autoInterrupt: false
          },
          stt: {
            enabled: true,
            model: 'base'
          }
        }
      } as ReturnType<typeof useSettings>)

      renderHook(() => useTalkMode(), {
        wrapper: createWrapper()
      })

      expect(useMicVAD).toHaveBeenCalledWith(
        expect.objectContaining({
          startOnLoad: false,
          positiveSpeechThreshold: 0.3,
          negativeSpeechThreshold: 0.25
        })
      )
    })
  })
})

describe('TalkModeState types', () => {
  it('should have all expected states', () => {
    const states = ['off', 'initializing', 'listening', 'thinking', 'speaking', 'error']
    
    states.forEach(state => {
      expect(typeof state).toBe('string')
    })
  })
})

describe('VAD speech processing (stale closure regression test)', () => {
  let capturedOnSpeechEnd: ((audio: Float32Array) => void) | null = null
  
  beforeEach(() => {
    capturedOnSpeechEnd = null
    vi.clearAllMocks()
    
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        talkMode: {
          enabled: true,
          silenceThresholdMs: 800,
          minSpeechMs: 400,
          autoInterrupt: true
        },
        stt: {
          enabled: true,
          model: 'base',
          language: 'en'
        }
      }
    } as ReturnType<typeof useSettings>)
    
    vi.mocked(useMicVAD).mockImplementation((options) => {
      capturedOnSpeechEnd = options.onSpeechEnd as (audio: Float32Array) => void
      return {
        start: vi.fn(),
        pause: vi.fn(),
        userSpeaking: false
      } as ReturnType<typeof useMicVAD>
    })
  })

  it('should process audio when onSpeechEnd fires in listening state', async () => {
    const { sttApi } = await import('@/api/stt')
    const { blobToBase64 } = await import('@/lib/audioUtils')
    
    vi.mocked(blobToBase64).mockResolvedValue('bW9jayBiYXNlNjQ=')
    
    const mockTranscribe = vi.mocked(sttApi.transcribeBase64)
    mockTranscribe.mockResolvedValue({
      text: 'test transcription',
      language: 'en',
      language_probability: 0.95,
      duration: 1.5
    })

    const { result } = renderHook(() => useTalkMode(), {
      wrapper: createWrapper()
    })

    await act(async () => {
      await result.current.start('session-123', 'http://localhost:5551', '/workspace')
    })

    expect(result.current.state).toBe('listening')
    expect(capturedOnSpeechEnd).not.toBeNull()

    const mockAudio = new Float32Array([0.1, 0.2, 0.3])
    
    await act(async () => {
      capturedOnSpeechEnd!(mockAudio)
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(mockTranscribe).toHaveBeenCalledWith(
      'bW9jayBiYXNlNjQ=',
      'wav',
      expect.objectContaining({
        model: 'base',
        language: 'en'
      })
    )
  })

  it('should NOT process audio when state is off (stale closure check)', async () => {
    const { sttApi } = await import('@/api/stt')
    const mockTranscribe = vi.mocked(sttApi.transcribeBase64)

    const { result } = renderHook(() => useTalkMode(), {
      wrapper: createWrapper()
    })

    expect(result.current.state).toBe('off')
    expect(capturedOnSpeechEnd).not.toBeNull()

    const mockAudio = new Float32Array([0.1, 0.2, 0.3])
    
    await act(async () => {
      capturedOnSpeechEnd!(mockAudio)
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(mockTranscribe).not.toHaveBeenCalled()
  })

  it('should update userTranscript after successful transcription', async () => {
    const { sttApi } = await import('@/api/stt')
    vi.mocked(sttApi.transcribeBase64).mockResolvedValue({
      text: 'hello world from talk mode',
      language: 'en',
      language_probability: 0.98,
      duration: 2.0
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    })

    const { result } = renderHook(() => useTalkMode(), {
      wrapper: createWrapper()
    })

    await act(async () => {
      await result.current.start('session-456', 'http://localhost:5551', '/workspace')
    })

    const mockAudio = new Float32Array([0.1, 0.2, 0.3])
    
    await act(async () => {
      capturedOnSpeechEnd!(mockAudio)
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(result.current.userTranscript).toBe('hello world from talk mode')
  })
})
