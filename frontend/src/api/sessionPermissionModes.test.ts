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
    expect(fetchMock.mock.calls[0][0]).toEqual(expect.stringContaining('/api/session-permission-modes/ses_1'))
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined()
  })

  it('calls PUT /api/session-permission-modes/:id with the mode and directory', async () => {
    const input = { directory: '/repo', mode: 'auto' as const }
    const state = { sessionId: 'ses_1', rootSessionId: 'ses_1', mode: 'auto' as const, lockedReason: null }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(state), { status: 200 }))

    const result = await setSessionPermissionMode('ses_1', input)

    expect(result).toEqual(state)
    expect(fetchMock.mock.calls[0][0]).toEqual(expect.stringContaining('/api/session-permission-modes/ses_1'))
    const options = fetchMock.mock.calls[0][1]
    expect(options.method).toBe('PUT')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(options.body)).toEqual(input)
  })
})
