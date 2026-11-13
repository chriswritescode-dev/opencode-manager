import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { JsonObjectSchema, parseJsonText, type JsonValue } from '@opencode-manager/shared/utils'
import { createManagerSessionTransfer } from '../src/remote-session.js'
import type { SessionTransferData } from '@opencode-manager/shared/opencode'

afterEach(() => {
  vi.unstubAllGlobals()
})

const transferData: SessionTransferData = {
  info: {
    id: 'ses_a',
    projectID: 'proj_1',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
    location: { directory: '/Users/x/repo' },
  },
  messages: [{ id: 'msg_1', time: { created: 1 }, type: 'user', text: 'hello' }],
}

const ImportRequestBodySchema = z.object({
  location: z.object({ directory: z.string() }),
  info: JsonObjectSchema,
  messages: z.array(JsonObjectSchema),
})

const ReminderRequestBodySchema = z.object({ text: z.string(), resume: z.boolean() })

function jsonResponse(status: number, body: JsonValue): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function requestedJson<Value>(init: RequestInit | undefined, schema: z.ZodType<Value>): Promise<Value> {
  return schema.parse(parseJsonText(String(init?.body)))
}

describe('createManagerSessionTransfer', () => {
  it('imports through the manager proxy with basic auth and the remote location', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: 'ses_new' } }))
    vi.stubGlobal('fetch', fetchMock)

    const transfer = createManagerSessionTransfer('https://manager.example', 'tok_123')
    const result = await transfer.importSession('/workspace/repo', transferData)

    expect(result).toEqual({ sessionID: 'ses_new' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://manager.example/api/opencode-proxy/api/experimental/session/import')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from('opencode:tok_123').toString('base64')}`)
    const body = await requestedJson(init, ImportRequestBodySchema)
    expect(body.location).toEqual({ directory: '/workspace/repo' })
    expect(body.info).toEqual(transferData.info)
    expect(body.messages).toEqual(transferData.messages)
  })

  it('sends a synthetic reminder through the manager proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: {} }))
    vi.stubGlobal('fetch', fetchMock)

    const transfer = createManagerSessionTransfer('https://manager.example', 'tok_123')
    await transfer.addReminder('ses_new', 'hello')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://manager.example/api/opencode-proxy/api/session/ses_new/synthetic')
    const body = await requestedJson(init, ReminderRequestBodySchema)
    expect(body.text).toBe('hello')
    expect(body.resume).toBe(false)
  })

  it('reports an existing Manager session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: 'ses_a' } }))
    vi.stubGlobal('fetch', fetchMock)

    const transfer = createManagerSessionTransfer('https://manager.example', 'tok_123')

    await expect(transfer.sessionExists('ses_a')).resolves.toBe(true)
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://manager.example/api/opencode-proxy/api/session/ses_a')
  })

  it('reports a missing Manager session only for SessionNotFoundError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, { _tag: 'SessionNotFoundError', sessionID: 'ses_a', message: 'Session not found' })))

    const transfer = createManagerSessionTransfer('https://manager.example', 'tok_123')

    await expect(transfer.sessionExists('ses_a')).resolves.toBe(false)
  })

  it('rethrows other failures instead of treating the session as missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })))

    const transfer = createManagerSessionTransfer('https://manager.example', 'tok_123')

    await expect(transfer.sessionExists('ses_a')).rejects.toBeDefined()
  })
})
