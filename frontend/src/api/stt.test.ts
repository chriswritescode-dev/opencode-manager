import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFetchFake, type FetchFake, type FetchRoute } from '@/test/fetchFake'
import { sttApi } from './stt'
import { FetchError } from './fetchWrapper'

function installRoutes(routes: FetchRoute[]): FetchFake {
  const fetchFake = createFetchFake(routes)
  fetchFake.install()
  return fetchFake
}

function audioName(fetchFake: FetchFake): string {
  const audio = fetchFake.findFormData()?.get('audio')
  if (!(audio instanceof File)) throw new Error('no audio file was uploaded')
  return audio.name
}

function abortableResponse(init: RequestInit | undefined): Promise<never> {
  const signal = init?.signal
  if (!signal) throw new Error('the request has no abort signal')
  return new Promise((_resolve, reject) => {
    const rejectOnAbort = () => {
      const error = new Error('The operation was aborted')
      error.name = 'AbortError'
      reject(error)
    }
    if (signal.aborted) {
      rejectOnAbort()
      return
    }
    signal.addEventListener('abort', rejectOnAbort, { once: true })
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('sttApi.transcribe audio file naming', () => {
  const cases = [
    { title: 'wav for audio/wav blob', type: 'audio/wav', extension: 'wav' },
    { title: 'webm for audio/webm blob', type: 'audio/webm', extension: 'webm' },
    { title: 'ogg for audio/ogg blob', type: 'audio/ogg', extension: 'ogg' },
    { title: 'm4a for audio/mp4 blob', type: 'audio/mp4', extension: 'm4a' },
    { title: 'webm for audio/webm;codecs=opus blob', type: 'audio/webm;codecs=opus', extension: 'webm' },
    { title: 'wav for unknown types', type: 'audio/unknown', extension: 'wav' },
    { title: 'wav over webm when both present', type: 'audio/wav;codecs=pcm', extension: 'wav' },
  ]

  it.each(cases)('uses $title', async ({ type, extension }) => {
    const fetchFake = installRoutes([
      { method: 'POST', path: '/api/stt/transcribe', respond: () => ({ json: { text: 'test' } }) },
    ])

    await sttApi.transcribe(new Blob([], { type }), 'test-user')

    expect(audioName(fetchFake)).toBe(`recording.${extension}`)
  })
})

describe('sttApi.transcribe request shape', () => {
  it('includes the user id and sends the audio as multipart form data', async () => {
    const fetchFake = installRoutes([
      { method: 'POST', path: '/api/stt/transcribe', respond: () => ({ json: { text: 'transcribed text' } }) },
    ])

    const result = await sttApi.transcribe(new Blob(['audio data'], { type: 'audio/wav' }), 'custom-user')

    expect(result.text).toBe('transcribed text')
    expect(fetchFake.lastRequest('POST', '/api/stt/transcribe')?.searchParams.get('userId')).toBe('custom-user')
    expect(fetchFake.findFormData()?.get('audio')).toBeInstanceOf(File)
  })

  it('surfaces the server transcription error message', async () => {
    installRoutes([
      {
        method: 'POST',
        path: '/api/stt/transcribe',
        respond: () => ({ status: 400, json: { error: 'Audio too short' } }),
      },
    ])

    await expect(sttApi.transcribe(new Blob([], { type: 'audio/wav' }), 'test-user')).rejects.toMatchObject({
      message: 'Audio too short',
      statusCode: 400,
    })
  })
})

describe('sttApi.transcribe cancellation and timeout', () => {
  it('throws 499 CANCELED when caller aborts', async () => {
    installRoutes([
      { method: 'POST', path: '/api/stt/transcribe', respond: (_request, _params, init) => abortableResponse(init) },
    ])
    const abortController = new AbortController()

    const promise = sttApi.transcribe(new Blob([], { type: 'audio/webm;codecs=opus' }), 'test-user', abortController.signal)

    abortController.abort()

    await expect(promise).rejects.toBeInstanceOf(FetchError)
    await expect(promise).rejects.toMatchObject({ statusCode: 499, code: 'CANCELED' })
  })

  it('throws 408 TIMEOUT when transcription times out', async () => {
    vi.useFakeTimers()
    installRoutes([
      { method: 'POST', path: '/api/stt/transcribe', respond: (_request, _params, init) => abortableResponse(init) },
    ])

    const promise = sttApi.transcribe(new Blob([], { type: 'audio/webm;codecs=opus' }), 'test-user')

    vi.advanceTimersByTime(60000)

    await expect(promise).rejects.toBeInstanceOf(FetchError)
    await expect(promise).rejects.toMatchObject({ statusCode: 408, code: 'TIMEOUT' })
  })
})
