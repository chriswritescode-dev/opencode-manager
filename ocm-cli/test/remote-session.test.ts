import { describe, it, expect, vi, afterEach } from 'vitest'
import { createManagerSessionTransfer } from '../src/remote-session.js'
import type { SessionTransferData } from '@opencode-manager/shared/opencode'

afterEach(() => {
  vi.unstubAllGlobals()
})

const transferData = {
  info: { id: 'ses_a' },
  messages: [{ id: 'msg_1' }],
} as unknown as SessionTransferData

describe('createManagerSessionTransfer', () => {
  it('imports through the manager proxy with basic auth and the remote location', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 'ses_new' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const transfer = createManagerSessionTransfer('https://manager.example', 'tok_123')
    const result = await transfer.importSession('/workspace/repo', transferData)

    expect(result).toEqual({ sessionID: 'ses_new' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://manager.example/api/opencode-proxy/api/experimental/session/import')
    expect(init.method).toBe('POST')
    const headers = init.headers as Headers
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from('opencode:tok_123').toString('base64')}`)
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.location).toEqual({ directory: '/workspace/repo' })
    expect(body.info).toEqual(transferData.info)
    expect(body.messages).toEqual(transferData.messages)
  })

  it('sends a synthetic reminder through the manager proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const transfer = createManagerSessionTransfer('https://manager.example', 'tok_123')
    await transfer.addReminder('ses_new', 'hello')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://manager.example/api/opencode-proxy/api/session/ses_new/synthetic')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.text).toBe('hello')
  })
})
