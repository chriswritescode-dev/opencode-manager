import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSessionPermissionMode, setSessionPermissionMode } from './sessionPermissionModes'

describe('sessionPermissionModes', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls GET /api/session-permission-modes/:id and returns the state', async () => {
    const state = { sessionId: 'ses_1', rootSessionId: 'ses_1', mode: 'ask', lockedReason: null }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(state), { status: 200 }))

    const result = await getSessionPermissionMode('ses_1')

    expect(result).toEqual(state)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe('/api/session-permission-modes/ses_1')
    expect(url.searchParams.get('serverId')).toBe('local')
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined()
  })

  it('sends the remote server id when reading a remote session mode', async () => {
    const state = { sessionId: 'ses_1', rootSessionId: 'ses_1', mode: 'auto', lockedReason: null }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(state), { status: 200 }))

    await getSessionPermissionMode('ses_1', 'srv_remote')

    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get('serverId')).toBe('srv_remote')
  })

  it('calls PUT /api/session-permission-modes/:id with the mode, directory and server', async () => {
    const input = { directory: '/repo', mode: 'auto' as const }
    const state = { sessionId: 'ses_1', rootSessionId: 'ses_1', mode: 'auto' as const, lockedReason: null }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(state), { status: 200 }))

    const result = await setSessionPermissionMode('ses_1', input)

    expect(result).toEqual(state)
    expect(fetchMock.mock.calls[0][0]).toEqual(expect.stringContaining('/api/session-permission-modes/ses_1'))
    const options = fetchMock.mock.calls[0][1]
    expect(options.method).toBe('PUT')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(options.body)).toEqual({ ...input, serverId: 'local' })
  })

  it('sends the remote server id when writing a remote session mode', async () => {
    const input = { directory: '/repo', mode: 'auto' as const }
    const state = { sessionId: 'ses_1', rootSessionId: 'ses_1', mode: 'auto' as const, lockedReason: null }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(state), { status: 200 }))

    await setSessionPermissionMode('ses_1', input, 'srv_remote')

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ...input, serverId: 'srv_remote' })
  })
})
