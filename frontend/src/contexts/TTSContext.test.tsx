import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { TTSProvider } from './TTSContext'
import { useTTS } from '@/hooks/useTTS'
import type { TTSConfig, TTSContextValue } from './tts-context'
import type { WebSpeechSynthesizer } from '@/lib/webSpeechSynthesizer'

const mocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
}))

const webSpeech = vi.hoisted(() => ({
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  clearCallbacks: vi.fn(),
  waitForVoices: vi.fn(() => Promise.resolve()),
  onEnd: vi.fn(),
  onError: vi.fn(),
  speakChunked: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

vi.mock('@/lib/webSpeechSynthesizer', () => ({
  getWebSpeechSynthesizer: () => webSpeech as unknown as WebSpeechSynthesizer,
  isWebSpeechSupported: () => true,
}))

class FakeAudio {
  static instances: FakeAudio[] = []

  src: string
  paused = true
  onended: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(src: string) {
    this.src = src
    FakeAudio.instances.push(this)
  }

  play = vi.fn(() => {
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

const ttsRef: { current: TTSContextValue | null } = { current: null }

function Consumer() {
  ttsRef.current = useTTS()
  return null
}

let fetchBodies: string[] = []
let objectUrlCounter = 0

const createObjectURL = vi.fn(() => `blob:fake-${++objectUrlCounter}`)
const revokeObjectURL = vi.fn()

const textA = 'Alpha one. Alpha two. Alpha three. Alpha four. Alpha five.'
const textB = 'Bravo one. Bravo two. Bravo three. Bravo four. Bravo five.'

async function flushPlayback() {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) {
      await Promise.resolve()
    }
  })
}

function setPreferences(overrides: Partial<TTSConfig> = {}) {
  mocks.useSettings.mockReturnValue({
    preferences: {
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
    },
    updateSettings: vi.fn(),
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

function renderProvider() {
  return render(
    <TTSProvider>
      <Consumer />
    </TTSProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  FakeAudio.instances = []
  fetchBodies = []
  objectUrlCounter = 0
  ttsRef.current = null

  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { text: string }
    fetchBodies.push(body.text)
    const blob = new Blob([`audio:${body.text}`], { type: 'audio/mpeg' })
    return {
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'audio/mpeg' : null),
      },
      blob: async () => blob,
      json: async () => ({}),
    } as unknown as Response
  })

  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('fetch', fetchMock)
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TTSProvider playback isolation', () => {
  it('does not start a concurrent chain when a stale onended fires after a new playback begins', async () => {
    setPreferences()
    renderProvider()

    await act(async () => {
      await ttsRef.current!.speakMessage('A', textA)
    })

    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(1))
    const firstAudio = FakeAudio.instances[0]
    await waitFor(() => expect(firstAudio.paused).toBe(false))
    const staleOnended = firstAudio.onended
    expect(staleOnended).toBeTypeOf('function')

    await act(async () => {
      await ttsRef.current!.speakMessage('B', textB)
    })

    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(2))
    const secondAudio = FakeAudio.instances[1]
    await waitFor(() => expect(secondAudio.paused).toBe(false))
    await waitFor(() => expect(fetchBodies).toContain('Bravo three. Bravo four.'))

    expect(firstAudio.paused).toBe(true)

    await act(async () => {
      staleOnended!()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const playing = FakeAudio.instances.filter((audio) => !audio.paused)
    expect(playing).toHaveLength(1)
    expect(playing[0]).toBe(secondAudio)
    expect(FakeAudio.instances).toHaveLength(2)
  })

  it('ignores a stale onerror after cleanup without orphaning the new audio or corrupting state', async () => {
    setPreferences()
    renderProvider()

    await act(async () => {
      await ttsRef.current!.speakMessage('A', textA)
    })

    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(1))
    const firstAudio = FakeAudio.instances[0]
    await waitFor(() => expect(firstAudio.paused).toBe(false))
    const staleOnerror = firstAudio.onerror
    expect(staleOnerror).toBeTypeOf('function')

    await act(async () => {
      await ttsRef.current!.speakMessage('B', textB)
    })

    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(2))
    const secondAudio = FakeAudio.instances[1]
    await waitFor(() => expect(secondAudio.paused).toBe(false))

    await act(async () => {
      staleOnerror!()
    })

    expect(ttsRef.current!.state).toBe('playing')
    expect(ttsRef.current!.error).toBeNull()
    expect(secondAudio.paused).toBe(false)
  })

  it('cancels active Web Speech playback when an external playback starts', async () => {
    setPreferences({ provider: 'external' })
    renderProvider()

    await act(async () => {
      await ttsRef.current!.speakWithConfig('Hello from web speech.', builtinConfig)
    })

    expect(webSpeech.speakChunked).toHaveBeenCalled()
    webSpeech.stop.mockClear()

    await act(async () => {
      await ttsRef.current!.speakWithConfig('Now external audio.', externalConfig)
    })

    expect(webSpeech.stop).toHaveBeenCalled()
  })

  it('fetches each chunk at most once when playback outruns an in-flight prefetch', async () => {
    setPreferences()
    renderProvider()

    const slowChunkText = 'Alpha three. Alpha four.'
    let releaseSlowChunk: () => void = () => {}
    const slowChunkGate = new Promise<void>((resolve) => {
      releaseSlowChunk = resolve
    })

    const baseFetch = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { text: string }
        if (body.text === slowChunkText) {
          await slowChunkGate
        }
        return baseFetch(input, init)
      }),
    )

    await act(async () => {
      await ttsRef.current!.speakMessage('A', textA)
    })

    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(1))
    const firstAudio = FakeAudio.instances[0]
    await waitFor(() => expect(firstAudio.paused).toBe(false))
    await waitFor(() => expect(fetchBodies).toContain('Alpha one. Alpha two.'))
    expect(fetchBodies).not.toContain(slowChunkText)

    await act(async () => {
      firstAudio.onended!()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await act(async () => {
      releaseSlowChunk()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(2))
    const secondAudio = FakeAudio.instances[1]
    await waitFor(() => expect(secondAudio.paused).toBe(false))

    expect(fetchBodies.filter((text) => text === slowChunkText)).toHaveLength(1)

    const fetchCounts = new Map<string, number>()
    for (const text of fetchBodies) {
      fetchCounts.set(text, (fetchCounts.get(text) ?? 0) + 1)
    }
    for (const count of fetchCounts.values()) {
      expect(count).toBe(1)
    }
  })
})

describe('TTSProvider message completion', () => {
  it('reports completion once after the last chunk finishes', async () => {
    setPreferences()
    renderProvider()
    const onEnd = vi.fn()

    await act(async () => {
      await ttsRef.current!.speakMessage('A', textA, { onEnd })
    })

    for (let index = 0; index < 3; index += 1) {
      await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThan(index))
      const audio = FakeAudio.instances[index]
      await waitFor(() => expect(audio.paused).toBe(false))
      expect(onEnd).not.toHaveBeenCalled()
      await act(async () => {
        audio.onended!()
      })
    }

    await waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1))
    expect(onEnd).toHaveBeenCalledWith('completed')
    expect(ttsRef.current!.state).toBe('idle')
  })

  it('reports a stop once and ignores the stale chunk end', async () => {
    setPreferences()
    renderProvider()
    const onEnd = vi.fn()

    await act(async () => {
      await ttsRef.current!.speakMessage('A', textA, { onEnd })
    })

    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(1))
    const firstAudio = FakeAudio.instances[0]
    await waitFor(() => expect(firstAudio.paused).toBe(false))
    const staleOnended = firstAudio.onended

    await act(async () => {
      ttsRef.current!.stop()
    })

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith('stopped')

    await act(async () => {
      staleOnended!()
    })

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(ttsRef.current!.state).toBe('idle')
  })

  it('reports the replaced message as stopped without settling the new one', async () => {
    setPreferences()
    renderProvider()
    const onEndA = vi.fn()
    const onEndB = vi.fn()

    await act(async () => {
      await ttsRef.current!.speakMessage('A', textA, { onEnd: onEndA })
    })

    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(1))
    const firstAudio = FakeAudio.instances[0]
    await waitFor(() => expect(firstAudio.paused).toBe(false))
    const staleOnended = firstAudio.onended

    await act(async () => {
      await ttsRef.current!.speakMessage('B', textB, { onEnd: onEndB })
    })

    expect(onEndA).toHaveBeenCalledTimes(1)
    expect(onEndA).toHaveBeenCalledWith('stopped')
    expect(onEndB).not.toHaveBeenCalled()

    await act(async () => {
      staleOnended!()
    })

    expect(onEndA).toHaveBeenCalledTimes(1)
    expect(onEndB).not.toHaveBeenCalled()
    expect(ttsRef.current!.activeMessageId).toBe('B')
  })

  it('clears the paused state and reports a stop when stopped while paused', async () => {
    setPreferences()
    renderProvider()
    const onEnd = vi.fn()

    await act(async () => {
      await ttsRef.current!.speakMessage('A', textA, { onEnd })
    })

    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(1))
    const firstAudio = FakeAudio.instances[0]
    await waitFor(() => expect(firstAudio.paused).toBe(false))

    await act(async () => {
      ttsRef.current!.pause()
    })

    expect(ttsRef.current!.isPaused).toBe(true)

    await act(async () => {
      ttsRef.current!.stop()
    })

    expect(ttsRef.current!.isPaused).toBe(false)
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith('stopped')
  })
})

describe('TTSProvider pause and resume', () => {
  it('pauses the current chunk and resumes it without restarting the message', async () => {
    setPreferences()
    renderProvider()

    await act(async () => {
      await ttsRef.current!.speakMessage('A', textA)
    })

    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(1))
    const firstAudio = FakeAudio.instances[0]
    await waitFor(() => expect(firstAudio.paused).toBe(false))
    const instanceCount = FakeAudio.instances.length

    await act(async () => {
      ttsRef.current!.pause()
    })

    expect(ttsRef.current!.isPaused).toBe(true)
    expect(ttsRef.current!.isPlaying).toBe(true)
    expect(firstAudio.pause).toHaveBeenCalled()
    expect(firstAudio.paused).toBe(true)

    const playCallsWhilePaused = firstAudio.play.mock.calls.length

    await act(async () => {
      ttsRef.current!.resume()
    })

    expect(ttsRef.current!.isPaused).toBe(false)
    expect(firstAudio.play.mock.calls.length).toBe(playCallsWhilePaused + 1)
    expect(firstAudio.paused).toBe(false)
    expect(FakeAudio.instances).toHaveLength(instanceCount)
    expect(fetchBodies.filter((text) => text === 'Alpha one. Alpha two.')).toHaveLength(1)
  })

  it('holds the next chunk until resumed when paused between chunks', async () => {
    setPreferences()
    renderProvider()

    await act(async () => {
      await ttsRef.current!.speakMessage('A', textA)
    })

    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(1))
    const firstAudio = FakeAudio.instances[0]
    await waitFor(() => expect(firstAudio.paused).toBe(false))

    await act(async () => {
      ttsRef.current!.pause()
    })

    await act(async () => {
      firstAudio.onended!()
    })

    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(2))
    const secondAudio = FakeAudio.instances[1]

    expect(secondAudio.play).not.toHaveBeenCalled()
    expect(secondAudio.paused).toBe(true)
    expect(ttsRef.current!.isPaused).toBe(true)
    expect(ttsRef.current!.activeMessageId).toBe('A')

    await act(async () => {
      ttsRef.current!.resume()
    })

    expect(secondAudio.play).toHaveBeenCalledTimes(1)
    expect(secondAudio.paused).toBe(false)
    expect(ttsRef.current!.isPaused).toBe(false)
  })

  it('delegates pause and resume to the synthesizer for builtin playback', async () => {
    setPreferences({ provider: 'builtin' })
    renderProvider()

    let releaseSpeech: () => void = () => {}
    webSpeech.speakChunked.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        releaseSpeech = resolve
      }),
    )

    await act(async () => {
      void ttsRef.current!.speakWithConfig('Hello from builtin speech.', builtinConfig)
    })

    await waitFor(() => expect(ttsRef.current!.isPlaying).toBe(true))

    await act(async () => {
      ttsRef.current!.pause()
    })

    expect(webSpeech.pause).toHaveBeenCalledTimes(1)
    expect(ttsRef.current!.isPaused).toBe(true)

    await act(async () => {
      ttsRef.current!.resume()
    })

    expect(webSpeech.resume).toHaveBeenCalledTimes(1)
    expect(ttsRef.current!.isPaused).toBe(false)

    await act(async () => {
      releaseSpeech()
      await Promise.resolve()
    })

    await waitFor(() => expect(ttsRef.current!.isIdle).toBe(true))
  })
})

describe('TTSProvider message queue', () => {
  const QUEUE_PAUSE_MS = 600
  const firstText = 'Alpha plays first.'
  const queuedText = 'Bravo waits in queue.'
  const interruptingText = 'Charlie interrupts.'

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('plays a queued message only after the active playback ends and the pause elapses', async () => {
    setPreferences()
    renderProvider()

    await act(async () => {
      void ttsRef.current!.speakMessage('A', firstText)
    })
    await flushPlayback()

    expect(FakeAudio.instances).toHaveLength(1)
    const firstAudio = FakeAudio.instances[0]
    expect(firstAudio.paused).toBe(false)
    expect(ttsRef.current!.activeMessageId).toBe('A')

    await act(async () => {
      ttsRef.current!.queueMessage('B', queuedText)
    })
    await flushPlayback()

    expect(FakeAudio.instances).toHaveLength(1)
    expect(firstAudio.paused).toBe(false)
    expect(ttsRef.current!.activeMessageId).toBe('A')
    expect(ttsRef.current!.isPlaying).toBe(true)

    await act(async () => {
      firstAudio.onended!()
    })
    await flushPlayback()

    expect(FakeAudio.instances).toHaveLength(1)
    expect(ttsRef.current!.isIdle).toBe(true)
    expect(ttsRef.current!.activeMessageId).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(QUEUE_PAUSE_MS - 1)
    })
    await flushPlayback()

    expect(FakeAudio.instances).toHaveLength(1)

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await flushPlayback()

    expect(FakeAudio.instances).toHaveLength(2)
    expect(FakeAudio.instances[1].paused).toBe(false)
    expect(ttsRef.current!.activeMessageId).toBe('B')
    expect(ttsRef.current!.isPlaying).toBe(true)
  })

  it('drops queued messages when playback is stopped', async () => {
    setPreferences()
    renderProvider()

    await act(async () => {
      void ttsRef.current!.speakMessage('A', firstText)
    })
    await flushPlayback()

    await act(async () => {
      ttsRef.current!.queueMessage('B', queuedText)
    })
    await flushPlayback()

    await act(async () => {
      FakeAudio.instances[0].onended!()
    })
    await flushPlayback()

    await act(async () => {
      ttsRef.current!.stop()
    })

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await flushPlayback()

    expect(FakeAudio.instances).toHaveLength(1)
    expect(fetchBodies).not.toContain(queuedText)
    expect(ttsRef.current!.state).toBe('idle')
    expect(ttsRef.current!.activeMessageId).toBeNull()
  })

  it('clears queued messages when a manual speakMessage interrupts playback', async () => {
    setPreferences()
    renderProvider()

    await act(async () => {
      void ttsRef.current!.speakMessage('A', firstText)
    })
    await flushPlayback()

    await act(async () => {
      ttsRef.current!.queueMessage('B', queuedText)
    })
    await flushPlayback()

    await act(async () => {
      void ttsRef.current!.speakMessage('C', interruptingText)
    })
    await flushPlayback()

    expect(FakeAudio.instances).toHaveLength(2)
    expect(FakeAudio.instances[0].paused).toBe(true)
    expect(ttsRef.current!.activeMessageId).toBe('C')

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await flushPlayback()

    expect(FakeAudio.instances).toHaveLength(2)
    expect(fetchBodies).not.toContain(queuedText)

    await act(async () => {
      FakeAudio.instances[1].onended!()
    })
    await flushPlayback()

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await flushPlayback()

    expect(FakeAudio.instances).toHaveLength(2)
    expect(ttsRef.current!.state).toBe('idle')
  })
})
