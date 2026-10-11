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
