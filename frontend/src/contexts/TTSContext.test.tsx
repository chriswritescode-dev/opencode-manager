import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import { z } from 'zod'
import type { UserPreferences } from '@/api/types/settings'
import { makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import type { FetchFake } from '@/test/fetchFake'
import { renderWithProviders } from '@/test/render'
import { TTSProvider } from './TTSContext'
import { useTTS } from '@/hooks/useTTS'
import type { SpeakMessageOptions, TTSConfig, TTSContextValue } from './tts-context'

interface ValueRef<T> {
  current: T
}

class FakeAudio {
  static instances: FakeAudio[] = []
  static nextPlayRejection: Error | null = null

  src: string
  paused = true
  onended: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(src = '') {
    this.src = src
    FakeAudio.instances.push(this)
  }

  play = vi.fn((): Promise<void> => {
    const rejection = FakeAudio.nextPlayRejection
    FakeAudio.nextPlayRejection = null
    if (rejection) return Promise.reject(rejection)
    this.paused = false
    return Promise.resolve()
  })

  pause = vi.fn(() => {
    this.paused = true
  })

  load = vi.fn()

  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = ''
  })
}

const ttsRef: ValueRef<TTSContextValue | null> = { current: null }

interface FakeSpeechVoice {
  name: string
  lang: string
  default: boolean
  localService: boolean
  voiceURI: string
}

interface SpeechUtteranceFake {
  text: string
  voice: FakeSpeechVoice | null
  lang: string
  rate: number
  pitch: number
  volume: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onboundary: ((event: { name: string; charIndex: number; charLength?: number }) => void) | null
}

class FakeUtterance implements SpeechUtteranceFake {
  text: string
  voice: FakeSpeechVoice | null = null
  lang = ''
  rate = 1
  pitch = 1
  volume = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onboundary: ((event: { name: string; charIndex: number; charLength?: number }) => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

const pendingUtterances: FakeUtterance[] = []

const speechSynthesisFake = {
  speak: vi.fn((utterance: FakeUtterance) => {
    pendingUtterances.push(utterance)
  }),
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  getVoices: () => [{ name: 'Test Voice', lang: 'en-US', default: true, localService: true, voiceURI: 'Test Voice' }],
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  speaking: false,
  pending: false,
  paused: false,
}

function completeSpeech(): void {
  const utterance = pendingUtterances.shift()
  utterance?.onend?.()
}

function Consumer() {
  ttsRef.current = useTTS()
  return null
}

let objectUrlCounter = 0

const createObjectURL = vi.fn(() => `blob:fake-${++objectUrlCounter}`)
const revokeObjectURL = vi.fn()

const textA = 'Alpha one. Alpha two. Alpha three. Alpha four. Alpha five.'
const textB = 'Bravo one. Bravo two. Bravo three. Bravo four. Bravo five.'

const synthesizeRequestSchema = z.object({ text: z.string() })

interface TtsFetchState {
  fetched: string[]
  slowChunkText: string | null
  slowChunkGate: Promise<void> | null
}

const fetchState: TtsFetchState = { fetched: [], slowChunkText: null, slowChunkGate: null }

async function flushPlayback() {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) {
      await Promise.resolve()
    }
  })
}

function player(): FakeAudio {
  const instance = FakeAudio.instances[0]
  if (!instance) throw new Error('expected the shared audio player to exist')
  return instance
}

async function startPlayback(
  messageId: string,
  text: string,
  options?: SpeakMessageOptions,
): Promise<FakeAudio> {
  await act(async () => {
    const current = ttsRef.current
    if (!current) throw new Error('expected the TTS provider to be mounted')
    await current.speakMessage(messageId, text, options)
  })
  await waitFor(() => expect(player().paused).toBe(false))
  return player()
}

function ttsPreferences(overrides: Partial<TTSConfig> = {}): UserPreferences {
  return makeUserPreferences({
    tts: {
      enabled: true,
      autoPlay: false,
      provider: 'external',
      endpoint: 'https://api.openai.com',
      apiKey: 'test-key',
      voice: 'alloy',
      model: 'tts-1',
      speed: 1.0,
      ...overrides,
    },
  })
}

const externalConfig: TTSConfig = {
  enabled: true,
  provider: 'external',
  endpoint: 'https://api.openai.com',
  apiKey: 'test-key',
  voice: 'alloy',
  model: 'tts-1',
  speed: 1.0,
}

const builtinConfig: TTSConfig = {
  enabled: true,
  provider: 'builtin',
  endpoint: '',
  apiKey: '',
  voice: '',
  model: '',
  speed: 1.0,
}

function synthesizeRoute() {
  return {
    method: 'POST' as const,
    path: '/api/tts/synthesize',
    respond: async (request: { body: unknown }) => {
      const { text } = synthesizeRequestSchema.parse(request.body)
      if (fetchState.slowChunkText === text && fetchState.slowChunkGate) {
        await fetchState.slowChunkGate
      }
      fetchState.fetched.push(text)
      return {
        headers: { 'Content-Type': 'audio/mpeg' },
        blob: new Blob([`audio:${text}`], { type: 'audio/mpeg' }),
      }
    },
  }
}

interface RenderTtsResult {
  fetchFake: FetchFake
}

async function renderProvider(overrides: Partial<TTSConfig> = {}): Promise<RenderTtsResult> {
  const { queryClient, fetchFake } = renderWithProviders(
    <TTSProvider>
      <Consumer />
    </TTSProvider>,
    {
      fetchRoutes: [
        synthesizeRoute(),
        {
          method: 'GET',
          path: '/api/settings',
          respond: () => ({ json: makeSettingsResponse({ preferences: ttsPreferences(overrides) }) }),
        },
      ],
    },
  )
  await waitFor(() => expect(queryClient.getQueryData(['settings', 'default'])).toBeDefined())
  return { fetchFake }
}

beforeEach(() => {
  FakeAudio.instances = []
  FakeAudio.nextPlayRejection = null
  fetchState.fetched = []
  fetchState.slowChunkText = null
  fetchState.slowChunkGate = null
  objectUrlCounter = 0
  ttsRef.current = null
  pendingUtterances.length = 0
  speechSynthesisFake.speak.mockClear()
  speechSynthesisFake.cancel.mockClear()
  speechSynthesisFake.pause.mockClear()
  speechSynthesisFake.resume.mockClear()

  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('speechSynthesis', speechSynthesisFake)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TTSProvider playback isolation', () => {
  it('does not start a concurrent chain when a stale onended fires after a new playback begins', async () => {
    await renderProvider()

    const audio = await startPlayback('A', textA)
    const firstSrc = audio.src
    expect(firstSrc).toMatch(/^blob:/)
    const staleOnended = audio.onended
    expect(staleOnended).toBeTypeOf('function')

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      await current.speakMessage('B', textB)
    })

    await waitFor(() => expect(fetchState.fetched).toContain('Bravo three. Bravo four.'))
    await waitFor(() => expect(audio.src).not.toBe(firstSrc))
    const activeSrc = audio.src
    expect(audio.paused).toBe(false)

    await act(async () => {
      staleOnended?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(FakeAudio.instances).toHaveLength(1)
    expect(audio.src).toBe(activeSrc)
    expect(audio.paused).toBe(false)
  })

  it('ignores a stale onerror after cleanup without orphaning the new audio or corrupting state', async () => {
    await renderProvider()

    const audio = await startPlayback('A', textA)
    const staleOnerror = audio.onerror
    expect(staleOnerror).toBeTypeOf('function')

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      await current.speakMessage('B', textB)
    })

    await waitFor(() => expect(fetchState.fetched).toContain('Bravo three. Bravo four.'))
    const activeSrc = audio.src
    const playCalls = audio.play.mock.calls.length

    await act(async () => {
      staleOnerror?.()
    })

    const current = ttsRef.current
    if (!current) throw new Error('expected the TTS provider to be mounted')
    expect(current.state).toBe('playing')
    expect(current.error).toBeNull()
    expect(audio.paused).toBe(false)
    expect(audio.src).toBe(activeSrc)
    expect(audio.play.mock.calls.length).toBe(playCalls)
    expect(FakeAudio.instances).toHaveLength(1)
  })

  it('cancels active Web Speech playback when an external playback starts', async () => {
    await renderProvider()

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      void current.speakWithConfig('Hello from web speech.', builtinConfig)
    })
    await waitFor(() => expect(speechSynthesisFake.speak).toHaveBeenCalled())
    speechSynthesisFake.cancel.mockClear()

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      await current.speakWithConfig('Now external audio.', externalConfig)
    })

    expect(speechSynthesisFake.cancel).toHaveBeenCalled()
  })

  it('fetches each chunk at most once when playback outruns an in-flight prefetch', async () => {
    const slowChunkText = 'Alpha three. Alpha four.'
    let releaseSlowChunk: () => void = () => undefined
    fetchState.slowChunkText = slowChunkText
    fetchState.slowChunkGate = new Promise<void>((resolve) => {
      releaseSlowChunk = resolve
    })
    await renderProvider()

    const audio = await startPlayback('A', textA)
    await waitFor(() => expect(fetchState.fetched).toContain('Alpha one. Alpha two.'))
    expect(fetchState.fetched).not.toContain(slowChunkText)
    const firstSrc = audio.src

    await act(async () => {
      audio.onended?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await act(async () => {
      releaseSlowChunk()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await waitFor(() => expect(audio.src).not.toBe(firstSrc))
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2))
    expect(audio.paused).toBe(false)

    expect(fetchState.fetched.filter((text) => text === slowChunkText)).toHaveLength(1)

    const fetchCounts = new Map<string, number>()
    for (const text of fetchState.fetched) {
      fetchCounts.set(text, (fetchCounts.get(text) ?? 0) + 1)
    }
    for (const count of fetchCounts.values()) {
      expect(count).toBe(1)
    }
  })
})

describe('TTSProvider message completion', () => {
  it('reports completion once after the last chunk finishes', async () => {
    await renderProvider()
    const onEnd = vi.fn()

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      await current.speakMessage('A', textA, { onEnd })
    })

    await waitFor(() => expect(FakeAudio.instances).toHaveLength(1))
    const audio = player()

    for (let index = 0; index < 3; index += 1) {
      await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(index + 1))
      expect(onEnd).not.toHaveBeenCalled()
      await act(async () => {
        audio.onended?.()
      })
    }

    await waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1))
    expect(onEnd).toHaveBeenCalledWith('completed', undefined)
    expect(ttsRef.current?.state).toBe('idle')
  })

  it('reports a stop once and ignores the stale chunk end', async () => {
    await renderProvider()
    const onEnd = vi.fn()

    const audio = await startPlayback('A', textA, { onEnd })
    const staleOnended = audio.onended

    await act(async () => {
      ttsRef.current?.stop()
    })

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith('stopped', undefined)

    await act(async () => {
      staleOnended?.()
    })

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(ttsRef.current?.state).toBe('idle')
  })

  it('reports the replaced message as stopped without settling the new one', async () => {
    await renderProvider()
    const onEndA = vi.fn()
    const onEndB = vi.fn()

    const audio = await startPlayback('A', textA, { onEnd: onEndA })
    const staleOnended = audio.onended

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      await current.speakMessage('B', textB, { onEnd: onEndB })
    })

    expect(onEndA).toHaveBeenCalledTimes(1)
    expect(onEndA).toHaveBeenCalledWith('stopped', undefined)
    expect(onEndB).not.toHaveBeenCalled()

    await act(async () => {
      staleOnended?.()
    })

    expect(onEndA).toHaveBeenCalledTimes(1)
    expect(onEndB).not.toHaveBeenCalled()
    expect(ttsRef.current?.activeMessageId).toBe('B')
  })

  it('clears the paused state and reports a stop when stopped while paused', async () => {
    await renderProvider()
    const onEnd = vi.fn()

    await startPlayback('A', textA, { onEnd })

    await act(async () => {
      ttsRef.current?.pause()
    })

    expect(ttsRef.current?.isPaused).toBe(true)

    await act(async () => {
      ttsRef.current?.stop()
    })

    expect(ttsRef.current?.isPaused).toBe(false)
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith('stopped', undefined)
  })
})

describe('TTSProvider pause and resume', () => {
  it('pauses the current chunk and resumes it without restarting the message', async () => {
    await renderProvider()

    const audio = await startPlayback('A', textA)
    const firstSrc = audio.src

    await act(async () => {
      ttsRef.current?.pause()
    })

    expect(ttsRef.current?.isPaused).toBe(true)
    expect(ttsRef.current?.isPlaying).toBe(true)
    expect(audio.pause).toHaveBeenCalled()
    expect(audio.paused).toBe(true)

    const playCallsWhilePaused = audio.play.mock.calls.length

    await act(async () => {
      ttsRef.current?.resume()
    })

    expect(ttsRef.current?.isPaused).toBe(false)
    expect(audio.play.mock.calls.length).toBe(playCallsWhilePaused + 1)
    expect(audio.paused).toBe(false)
    expect(audio.src).toBe(firstSrc)
    expect(FakeAudio.instances).toHaveLength(1)
    expect(fetchState.fetched.filter((text) => text === 'Alpha one. Alpha two.')).toHaveLength(1)
  })

  it('holds the next chunk until resumed when paused between chunks', async () => {
    await renderProvider()

    const audio = await startPlayback('A', textA)
    const firstSrc = audio.src

    await act(async () => {
      ttsRef.current?.pause()
    })

    const playCallsWhilePaused = audio.play.mock.calls.length

    await act(async () => {
      audio.onended?.()
    })

    await waitFor(() => expect(audio.src).not.toBe(firstSrc))

    expect(audio.play.mock.calls.length).toBe(playCallsWhilePaused)
    expect(audio.paused).toBe(true)
    expect(ttsRef.current?.isPaused).toBe(true)
    expect(ttsRef.current?.activeMessageId).toBe('A')

    await act(async () => {
      ttsRef.current?.resume()
    })

    expect(audio.play.mock.calls.length).toBe(playCallsWhilePaused + 1)
    expect(audio.paused).toBe(false)
    expect(ttsRef.current?.isPaused).toBe(false)
  })

  it('delegates pause and resume to the synthesizer for builtin playback', async () => {
    await renderProvider({ provider: 'builtin' })

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      void current.speakWithConfig('Hello from builtin speech.', builtinConfig)
    })

    await waitFor(() => expect(speechSynthesisFake.speak).toHaveBeenCalled())

    await act(async () => {
      ttsRef.current?.pause()
    })

    expect(speechSynthesisFake.pause).toHaveBeenCalledTimes(1)
    expect(ttsRef.current?.isPaused).toBe(true)

    await act(async () => {
      ttsRef.current?.resume()
    })

    expect(speechSynthesisFake.resume).toHaveBeenCalledTimes(1)
    expect(ttsRef.current?.isPaused).toBe(false)

    await act(async () => {
      completeSpeech()
      await Promise.resolve()
    })

    await waitFor(() => expect(ttsRef.current?.isIdle).toBe(true))
  })
})

describe('TTSProvider playback failures', () => {
  it('reports the browser blocking playback with its own message', async () => {
    await renderProvider()
    const onEnd = vi.fn()
    FakeAudio.nextPlayRejection = Object.assign(new Error('play blocked'), {
      name: 'NotAllowedError',
    })

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      await current.speakMessage('A', textA, { onEnd })
    })
    await flushPlayback()

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith('error', 'Audio playback was blocked by the browser')
    expect(ttsRef.current?.state).toBe('error')
    expect(ttsRef.current?.error).toBe('Audio playback was blocked by the browser')

    act(() => ttsRef.current?.unlock())

    expect(player().src.startsWith('data:audio/wav;base64,')).toBe(true)
    expect(player().play).toHaveBeenCalledTimes(2)
  })

  it('reports the rejection message for a playback failure that is not a gesture block', async () => {
    await renderProvider()
    const onEnd = vi.fn()
    FakeAudio.nextPlayRejection = new Error('decoder gave up')

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      await current.speakMessage('A', textA, { onEnd })
    })
    await flushPlayback()

    expect(onEnd).toHaveBeenCalledWith('error', 'decoder gave up')
    expect(ttsRef.current?.error).toBe('decoder gave up')
  })
})

describe('TTSProvider unlock', () => {
  it('primes the shared element with a silent clip and reuses it for chunk playback', async () => {
    await renderProvider()

    act(() => ttsRef.current?.unlock())

    expect(FakeAudio.instances).toHaveLength(1)
    const audio = player()
    expect(audio.src.startsWith('data:audio/wav;base64,')).toBe(true)
    expect(audio.play).toHaveBeenCalledTimes(1)

    await flushPlayback()

    expect(audio.src).toBe('')
    expect(audio.paused).toBe(true)

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      await current.speakMessage('A', textA)
    })
    await flushPlayback()

    expect(FakeAudio.instances).toHaveLength(1)
    expect(audio.src).toMatch(/^blob:/)
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(audio.paused).toBe(false)
  })

  it('does nothing on a repeat call once the element is primed', async () => {
    await renderProvider()

    act(() => ttsRef.current?.unlock())
    await flushPlayback()
    const playCalls = player().play.mock.calls.length

    act(() => ttsRef.current?.unlock())

    expect(player().play).toHaveBeenCalledTimes(playCalls)
    expect(FakeAudio.instances).toHaveLength(1)
  })

  it('does not interrupt a message that is already playing', async () => {
    await renderProvider()

    const audio = await startPlayback('A', textA)
    const src = audio.src

    act(() => ttsRef.current?.unlock())

    expect(audio.src).toBe(src)
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.pause).not.toHaveBeenCalled()
    expect(audio.paused).toBe(false)
    expect(ttsRef.current?.isPlaying).toBe(true)
  })

  it('does not touch the shared element for builtin playback', async () => {
    await renderProvider({ provider: 'builtin' })

    act(() => ttsRef.current?.unlock())

    expect(FakeAudio.instances).toHaveLength(0)
  })
})

describe('TTSProvider message queue', () => {
  const QUEUE_PAUSE_MS = 600
  const firstText = 'Alpha plays first.'
  const queuedText = 'Bravo waits in queue.'
  const interruptingText = 'Charlie interrupts.'

  it('plays a queued message only after the active playback ends and the pause elapses', async () => {
    await renderProvider()
    vi.useFakeTimers()

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      void current.speakMessage('A', firstText)
    })
    await flushPlayback()

    expect(FakeAudio.instances).toHaveLength(1)
    const audio = player()
    const firstSrc = audio.src
    expect(audio.paused).toBe(false)
    expect(ttsRef.current?.activeMessageId).toBe('A')

    await act(async () => {
      ttsRef.current?.queueMessage('B', queuedText)
    })
    await flushPlayback()

    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.src).toBe(firstSrc)
    expect(audio.paused).toBe(false)
    expect(ttsRef.current?.activeMessageId).toBe('A')
    expect(ttsRef.current?.isPlaying).toBe(true)

    await act(async () => {
      audio.onended?.()
    })
    await flushPlayback()

    expect(ttsRef.current?.isIdle).toBe(true)
    expect(ttsRef.current?.activeMessageId).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(QUEUE_PAUSE_MS - 1)
    })
    await flushPlayback()

    expect(audio.play).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await flushPlayback()

    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(audio.paused).toBe(false)
    expect(fetchState.fetched).toContain(queuedText)
    expect(ttsRef.current?.activeMessageId).toBe('B')
    expect(ttsRef.current?.isPlaying).toBe(true)
  })

  it('drops queued messages when playback is stopped', async () => {
    await renderProvider()
    vi.useFakeTimers()

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      void current.speakMessage('A', firstText)
    })
    await flushPlayback()

    const audio = player()

    await act(async () => {
      ttsRef.current?.queueMessage('B', queuedText)
    })
    await flushPlayback()

    await act(async () => {
      audio.onended?.()
    })
    await flushPlayback()

    await act(async () => {
      ttsRef.current?.stop()
    })

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await flushPlayback()

    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(FakeAudio.instances).toHaveLength(1)
    expect(fetchState.fetched).not.toContain(queuedText)
    expect(ttsRef.current?.state).toBe('idle')
    expect(ttsRef.current?.activeMessageId).toBeNull()
  })

  it('clears queued messages when a manual speakMessage interrupts playback', async () => {
    await renderProvider()
    vi.useFakeTimers()

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      void current.speakMessage('A', firstText)
    })
    await flushPlayback()

    const audio = player()

    await act(async () => {
      ttsRef.current?.queueMessage('B', queuedText)
    })
    await flushPlayback()

    await act(async () => {
      const current = ttsRef.current
      if (!current) throw new Error('expected the TTS provider to be mounted')
      void current.speakMessage('C', interruptingText)
    })
    await flushPlayback()

    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(ttsRef.current?.activeMessageId).toBe('C')
    expect(ttsRef.current?.isPlaying).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await flushPlayback()

    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(fetchState.fetched).not.toContain(queuedText)

    await act(async () => {
      audio.onended?.()
    })
    await flushPlayback()

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await flushPlayback()

    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(ttsRef.current?.state).toBe('idle')
  })
})
