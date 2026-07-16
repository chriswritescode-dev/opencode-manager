import { describe, it, expect, vi, afterEach } from 'vitest'
import { createManagerReplay, createManagerPromptAsync } from '../src/remote-replay.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createManagerReplay', () => {
  it('POSTs to the correct URL with bearer auth and body shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionID: 'ses_new' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const replay = createManagerReplay('https://manager.example', 'tok_123')
    const result = await replay('/workspace/repo', [
      { id: 'e1', aggregateID: 'ses_a', seq: 0, type: 'session.created.1', data: { info: { directory: '/workspace/repo' } } },
    ])

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://manager.example/api/opencode-proxy/sync/replay?directory=%2Fworkspace%2Frepo')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer tok_123')
    expect(init.body).toBe(JSON.stringify({ directory: '/workspace/repo', events: [{ id: 'e1', aggregateID: 'ses_a', seq: 0, type: 'session.created.1', data: { info: { directory: '/workspace/repo' } } }] }))
    expect(result).toEqual({ sessionID: 'ses_new' })
  })

  it('throws on non-ok response with status code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('internal error'),
    }))

    const replay = createManagerReplay('https://manager.example', 'tok_123')

    await expect(replay('/workspace/repo', [])).rejects.toThrow('replay failed (500): internal error')
  })
})

describe('createManagerPromptAsync', () => {
  it('POSTs to the correct URL with sessionID, directory, and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const prompt = createManagerPromptAsync('https://manager.example', 'tok_abc')
    await prompt('/workspace/repo', 'ses/a=b&c', 'hello world')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://manager.example/api/opencode-proxy/session/ses%2Fa%3Db%26c/prompt_async?directory=%2Fworkspace%2Frepo')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer tok_abc')
    expect(init.headers['content-type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ noReply: true, parts: [{ type: 'text', text: 'hello world', synthetic: true }] }))
  })

  it('throws on non-ok response including status code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('not found'),
    }))

    const prompt = createManagerPromptAsync('https://manager.example', 'tok_abc')

    await expect(prompt('/workspace/repo', 'ses/a=b&c', 'text')).rejects.toThrow('prompt_async failed (404): not found')
  })

  it('handles text() rejection gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error('body read fail')),
    }))

    const prompt = createManagerPromptAsync('https://manager.example', 'tok_abc')

    await expect(prompt('/workspace/repo', 'ses/a=b&c', 'text')).rejects.toThrow('prompt_async failed (502): ')
  })
})