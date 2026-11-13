import { describe, expect, it } from 'vitest'
import { createFetchStub } from '../helpers/fetch-stub'
import {
  forwardProxyRequest,
  ProxyHeadersTimeoutError,
  type ForwardProxyRequestInput,
} from '../../src/utils/proxy-forward'

function forward(overrides: Partial<ForwardProxyRequestInput> = {}): Promise<Response> {
  return forwardProxyRequest({
    url: 'http://upstream.example/api/event',
    method: 'GET',
    headers: { 'x-test': '1' },
    body: null,
    buildResponseHeaders: (headers) => new Headers(headers),
    ...overrides,
  })
}

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

interface FrameReader<Frame> {
  read(): Promise<{ done: boolean; value?: Frame }>
}

async function readWithin<Frame>(reader: FrameReader<Frame>, timeoutMs = 500) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('upstream chunk was buffered instead of streamed')), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

describe('forwardProxyRequest', () => {
  it('streams the upstream body instead of buffering it', async () => {
    const encoder = new TextEncoder()
    const secondChunk = deferred()
    let secondChunkEnqueued = false
    const upstream = new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('first'))
        await secondChunk.promise
        secondChunkEnqueued = true
        controller.enqueue(encoder.encode('second'))
        controller.close()
      },
    }))
    const fetchFn = createFetchStub(async () => upstream)

    const response = await forward({ fetchFn })
    const reader = response.body?.getReader()
    if (!reader) throw new Error('expected a streamed response body')

    const decoder = new TextDecoder()
    const first = await readWithin(reader)
    expect(decoder.decode(first.value)).toBe('first')
    expect(secondChunkEnqueued).toBe(false)

    secondChunk.resolve()
    expect(decoder.decode((await reader.read()).value)).toBe('second')
    expect((await reader.read()).done).toBe(true)
  })

  it.each([204, 304])('returns a null body for upstream status %i', async (status) => {
    const fetchFn = createFetchStub(async () => new Response(null, { status }))

    const response = await forward({ fetchFn })

    expect(response.status).toBe(status)
    expect(response.body).toBeNull()
  })

  it('aborts a body-less request when the upstream sends no headers in time', async () => {
    let receivedSignal: AbortSignal | undefined
    const fetchFn = createFetchStub((_url, init) => new Promise<Response>((_resolve, reject) => {
      receivedSignal = init?.signal ?? undefined
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))

    await expect(forward({ fetchFn, headersTimeoutMs: 10 })).rejects.toBeInstanceOf(ProxyHeadersTimeoutError)
    expect(receivedSignal?.aborted).toBe(true)
  })

  it('does not apply the headers timeout to a request with a body', async () => {
    const client = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const fetchFn = createFetchStub((_url, init) => new Promise<Response>((resolve, reject) => {
      receivedSignal = init?.signal ?? undefined
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      setTimeout(() => resolve(new Response('ok')), 40)
    }))

    const response = await forward({
      method: 'POST',
      body: '{"title":"x"}',
      signal: client.signal,
      headersTimeoutMs: 10,
      fetchFn,
    })

    expect(response.status).toBe(200)
    expect(receivedSignal).toBe(client.signal)
  })

  it('rethrows non-timeout fetch failures unchanged', async () => {
    const failure = new Error('connect ECONNREFUSED')
    const fetchFn = createFetchStub(async () => {
      throw failure
    })

    await expect(forward({ fetchFn })).rejects.toBe(failure)
  })

  it('forwards method, headers, and body with a manual redirect and half duplex', async () => {
    const fetchFn = createFetchStub(async () => new Response('ok', { status: 201, statusText: 'Created' }))

    const response = await forward({
      url: 'http://upstream.example/api/session',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test': '1' },
      body: '{"title":"x"}',
      fetchFn,
    })

    const [calledUrl, init] = fetchFn.mock.calls[0] ?? []
    expect(calledUrl).toBe('http://upstream.example/api/session')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'content-type': 'application/json', 'x-test': '1' })
    expect(init?.body).toBe('{"title":"x"}')
    expect(init?.redirect).toBe('manual')
    expect(init?.duplex).toBe('half')
    expect(response.status).toBe(201)
    expect(response.statusText).toBe('Created')
  })

  it('builds the returned response headers from the upstream response', async () => {
    const fetchFn = createFetchStub(async () => new Response('ok', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))

    const response = await forward({
      fetchFn,
      buildResponseHeaders: (headers) => new Headers({ 'x-proxied': headers.get('content-type') ?? '' }),
    })

    expect(response.headers.get('x-proxied')).toBe('text/event-stream')
  })
})
