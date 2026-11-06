import { describe, expect, it, vi } from 'vitest'
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
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 500,
) {
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
    const fetchFn = vi.fn().mockResolvedValue(upstream)

    const response = await forward({ fetchFn: fetchFn as unknown as typeof fetch })
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()

    const decoder = new TextDecoder()
    const first = await readWithin(reader as ReadableStreamDefaultReader<Uint8Array>)
    expect(decoder.decode(first.value)).toBe('first')
    expect(secondChunkEnqueued).toBe(false)

    secondChunk.resolve()
    const readerRef = reader as ReadableStreamDefaultReader<Uint8Array>
    expect(decoder.decode((await readerRef.read()).value)).toBe('second')
    expect((await readerRef.read()).done).toBe(true)
  })

  it.each([204, 304])('returns a null body for upstream status %i', async (status) => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status }))

    const response = await forward({ fetchFn: fetchFn as unknown as typeof fetch })

    expect(response.status).toBe(status)
    expect(response.body).toBeNull()
  })

  it('aborts a body-less request when the upstream sends no headers in time', async () => {
    let receivedSignal: AbortSignal | undefined
    const fetchFn = vi.fn((_url: string | URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      receivedSignal = init.signal ?? undefined
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))

    await expect(
      forward({ fetchFn: fetchFn as unknown as typeof fetch, headersTimeoutMs: 10 }),
    ).rejects.toBeInstanceOf(ProxyHeadersTimeoutError)
    expect(receivedSignal?.aborted).toBe(true)
  })

  it('does not apply the headers timeout to a request with a body', async () => {
    const client = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const fetchFn = vi.fn((_url: string | URL, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      receivedSignal = init.signal ?? undefined
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      setTimeout(() => resolve(new Response('ok')), 40)
    }))

    const response = await forward({
      method: 'POST',
      body: '{"title":"x"}',
      signal: client.signal,
      headersTimeoutMs: 10,
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    expect(response.status).toBe(200)
    expect(receivedSignal).toBe(client.signal)
  })

  it('rethrows non-timeout fetch failures unchanged', async () => {
    const failure = new Error('connect ECONNREFUSED')
    const fetchFn = vi.fn().mockRejectedValue(failure)

    await expect(forward({ fetchFn: fetchFn as unknown as typeof fetch })).rejects.toBe(failure)
  })

  it('forwards method, headers, and body with a manual redirect and half duplex', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('ok', { status: 201, statusText: 'Created' }))

    const response = await forward({
      url: 'http://upstream.example/api/session',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test': '1' },
      body: '{"title":"x"}',
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    const [calledUrl, init] = fetchFn.mock.calls[0] as [string | URL, RequestInit]
    expect(calledUrl).toBe('http://upstream.example/api/session')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-test': '1' })
    expect(init.body).toBe('{"title":"x"}')
    expect(init.redirect).toBe('manual')
    expect(init.duplex).toBe('half')
    expect(response.status).toBe(201)
    expect(response.statusText).toBe('Created')
  })

  it('builds the returned response headers from the upstream response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('ok', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))

    const response = await forward({
      fetchFn: fetchFn as unknown as typeof fetch,
      buildResponseHeaders: (headers) => new Headers({ 'x-proxied': headers.get('content-type') ?? '' }),
    })

    expect(response.headers.get('x-proxied')).toBe('text/event-stream')
  })
})
