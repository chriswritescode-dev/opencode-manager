import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listSessionPins, toggleSessionPin } from './sessionPins'

describe('sessionPins', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('listSessionPins', () => {
    it('calls GET /api/session-pins and returns pins array', async () => {
      const expectedPins = [
        { sessionId: 's1', directory: '/a', pinnedAt: 100 },
        { sessionId: 's2', directory: '/b', pinnedAt: 200 },
      ]
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ pins: expectedPins }), { status: 200 }),
      )

      const result = await listSessionPins()

      expect(result).toEqual(expectedPins)

      const callUrl = fetchMock.mock.calls[0][0]
      expect(callUrl).toEqual(expect.stringContaining('/api/session-pins'))

      const callOptions = fetchMock.mock.calls[0][1]
      expect(callOptions.method).toBeUndefined()
    })
  })

  describe('toggleSessionPin', () => {
    it('calls PUT /api/session-pins with JSON body and returns pins', async () => {
      const input = { sessionId: 's1', directory: '/a', pinned: true }
      const expectedPins = [
        { sessionId: 's1', directory: '/a', pinnedAt: 100 },
      ]
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ pins: expectedPins }), { status: 200 }),
      )

      const result = await toggleSessionPin(input)

      expect(result).toEqual(expectedPins)

      const callUrl = fetchMock.mock.calls[0][0]
      expect(callUrl).toEqual(expect.stringContaining('/api/session-pins'))

      const callOptions = fetchMock.mock.calls[0][1]
      expect(callOptions.method).toBe('PUT')
      expect(callOptions.headers['Content-Type']).toBe('application/json')

      const body = JSON.parse(callOptions.body)
      expect(body).toEqual(input)
    })
  })
})
