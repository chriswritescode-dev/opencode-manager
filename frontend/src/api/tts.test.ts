import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ttsApi } from './tts'
import { FetchError } from './fetchWrapper'

describe('ttsApi.synthesize', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts text as JSON to the synthesize endpoint with credentials and userId', async () => {
    const audioBlob = new Blob(['audio-data'], { type: 'audio/wav' })
    fetchMock.mockResolvedValue(
      new Response(audioBlob, { status: 200, headers: { 'Content-Type': 'audio/wav' } }),
    )

    const result = await ttsApi.synthesize('hello', 'default')

    expect(result).toBeInstanceOf(Blob)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/tts/synthesize')
    expect(url).toContain('userId=default')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body as string).text).toBe('hello')
  })

  it('propagates the caller abort signal', async () => {
    fetchMock.mockImplementation((_url: string, options: RequestInit) => {
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

    const controller = new AbortController()
    const promise = ttsApi.synthesize('hello', 'default', controller.signal)
    controller.abort()

    await expect(promise).rejects.toThrow()
  })

  it('surfaces a 401 as a FetchError with statusCode 401', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    )

    await expect(ttsApi.synthesize('hello', 'default')).rejects.toThrow(FetchError)
    await expect(ttsApi.synthesize('hello', 'default')).rejects.toMatchObject({
      statusCode: 401,
    })
  })
})
