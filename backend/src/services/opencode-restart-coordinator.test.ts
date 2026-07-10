import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenCodeRestartCoordinator, type ActiveSessionsProvider, type ResumableSession } from './opencode-restart-coordinator'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import type { OpenCodeClient } from './opencode/client'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function createFakeActiveSessionsProvider(overrides: Partial<ActiveSessionsProvider> = {}): ActiveSessionsProvider {
  return {
    getActiveSessions: vi.fn(() => ({})),
    isSubagentSession: vi.fn(() => false),
    getScheduledSessionIds: vi.fn(() => new Set<string>()),
    ...overrides,
  }
}

describe('OpenCodeRestartCoordinator', () => {
  let client: OpenCodeClient
  let activeSessions: ActiveSessionsProvider
  let coordinator: OpenCodeRestartCoordinator

  beforeEach(() => {
    client = createStubOpenCodeClient()
    activeSessions = createFakeActiveSessionsProvider()
    coordinator = new OpenCodeRestartCoordinator(client, activeSessions)
  })

  describe('captureResumableSessions', () => {
    it('excludes subagent sessions', () => {
      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({
        '/a': ['s1', 'sub1'],
        '/b': ['s2'],
      })
      vi.mocked(activeSessions.isSubagentSession).mockImplementation((id: string) => id === 'sub1')

      const result = coordinator.captureResumableSessions()

      expect(result).toEqual([
        { sessionID: 's1', directory: '/a' },
        { sessionID: 's2', directory: '/b' },
      ])
    })

    it('returns empty array when no active sessions', () => {
      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({})

      const result = coordinator.captureResumableSessions()

      expect(result).toEqual([])
    })

    it('filters out only subagent sessions, keeps all others', () => {
      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({
        '/x': ['a1', 'a2', 'sub_x'],
      })
      vi.mocked(activeSessions.isSubagentSession).mockImplementation((id: string) => id.startsWith('sub_'))

      const result = coordinator.captureResumableSessions()

      expect(result).toEqual([
        { sessionID: 'a1', directory: '/x' },
        { sessionID: 'a2', directory: '/x' },
      ])
    })

    it('excludes scheduled sessions', () => {
      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({
        '/a': ['s1', 'sched1'],
      })
      vi.mocked(activeSessions.getScheduledSessionIds).mockReturnValue(new Set(['sched1']))

      const result = coordinator.captureResumableSessions()

      expect(result).toEqual([{ sessionID: 's1', directory: '/a' }])
    })

    it('excludes both subagent and scheduled sessions simultaneously', () => {
      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({
        '/p': ['manual', 'sub', 'sched'],
      })
      vi.mocked(activeSessions.isSubagentSession).mockImplementation((id: string) => id === 'sub')
      vi.mocked(activeSessions.getScheduledSessionIds).mockReturnValue(new Set(['sched']))

      const result = coordinator.captureResumableSessions()

      expect(result).toEqual([{ sessionID: 'manual', directory: '/p' }])
    })
  })

  describe('runWithResume', () => {
    it('aborts captured sessions, restarts, then resumes when healthy', async () => {
      const events: string[] = []
      const forward = vi.mocked(client.forward)
      forward.mockImplementation(async (opts) => {
        events.push(`forward:${opts.path}`)
        return new Response(null, { status: 200 })
      })

      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({
        '/a': ['s1'],
        '/b': ['s2'],
      })

      const restart = vi.fn(async () => {
        events.push('restart')
        return true
      })

      const result = await coordinator.runWithResume(restart)

      // Assert interleaved ordering: aborts → restart → resumes
      expect(events).toEqual([
        'forward:/api/session/s1/interrupt',
        'forward:/api/session/s2/interrupt',
        'restart',
        'forward:/session/s1/message',
        'forward:/session/s2/message',
      ])

      // Aborts called first for both sessions
      expect(forward).toHaveBeenNthCalledWith(1, {
        method: 'POST',
        path: '/api/session/s1/interrupt',
      })
      expect(forward).toHaveBeenNthCalledWith(2, {
        method: 'POST',
        path: '/api/session/s2/interrupt',
      })

      expect(restart).toHaveBeenCalledOnce()

      // Forward was called 4 times: 2 aborts (calls 1-2) + 2 resumes (calls 3-4)
      expect(forward).toHaveBeenCalledTimes(4)
      expect(forward).toHaveBeenNthCalledWith(3, {
        method: 'POST',
        path: '/session/s1/message',
        directory: '/a',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text: 'continue' }] }),
      })
      expect(forward).toHaveBeenNthCalledWith(4, {
        method: 'POST',
        path: '/session/s2/message',
        directory: '/b',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text: 'continue' }] }),
      })

      // Verify resume body deserializes correctly
      const resumeBody = JSON.parse(forward.mock.calls[2]![0].body as string)
      expect(resumeBody).toEqual({ parts: [{ type: 'text', text: 'continue' }] })

      expect(result).toEqual({ healthy: true, resumedSessionIDs: ['s1', 's2'] })
    })

    it('does NOT resume when restart returns unhealthy', async () => {
      const forward = vi.mocked(client.forward)
      forward.mockResolvedValue(new Response(null, { status: 200 }))

      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({
        '/a': ['s1'],
      })

      const restart = vi.fn(async () => false)

      const result = await coordinator.runWithResume(restart)

      // Aborts still happen
      expect(forward).toHaveBeenNthCalledWith(1, {
        method: 'POST',
        path: '/api/session/s1/interrupt',
      })
      expect(restart).toHaveBeenCalledOnce()

      // No resume calls
      const resumeCalls = forward.mock.calls.filter(
        (call: unknown[]) => (call[0] as { path: string }).path.includes('/message'),
      )
      expect(resumeCalls).toHaveLength(0)

      expect(result).toEqual({ healthy: false, resumedSessionIDs: [] })
    })

    it('with no active sessions performs restart only', async () => {
      const forward = vi.mocked(client.forward)
      forward.mockResolvedValue(new Response(null, { status: 200 }))

      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({})

      const restart = vi.fn(async () => true)

      const result = await coordinator.runWithResume(restart)

      expect(restart).toHaveBeenCalledOnce()
      expect(forward).not.toHaveBeenCalled()

      expect(result).toEqual({ healthy: true, resumedSessionIDs: [] })
    })

    it('does not abort or resume scheduled sessions', async () => {
      const forward = vi.mocked(client.forward)
      forward.mockResolvedValue(new Response(null, { status: 200 }))

      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({
        '/a': ['manual1', 'sched1'],
      })
      vi.mocked(activeSessions.getScheduledSessionIds).mockReturnValue(new Set(['sched1']))

      const restart = vi.fn(async () => true)

      const result = await coordinator.runWithResume(restart)

      // Only manual1 should be aborted and resumed — 2 forward calls total
      expect(forward).toHaveBeenCalledTimes(2)
      expect(forward).toHaveBeenNthCalledWith(1, {
        method: 'POST',
        path: '/api/session/manual1/interrupt',
      })
      expect(forward).toHaveBeenNthCalledWith(2, {
        method: 'POST',
        path: '/session/manual1/message',
        directory: '/a',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text: 'continue' }] }),
      })

      expect(result).toEqual({ healthy: true, resumedSessionIDs: ['manual1'] })
    })

    it('is best-effort: per-session errors are swallowed and other sessions still processed', async () => {
      const forward = vi.mocked(client.forward)
      // Aborts all succeed, but resume for s2 fails
      forward
        .mockResolvedValueOnce(new Response(null, { status: 200 })) // abort s1
        .mockResolvedValueOnce(new Response(null, { status: 200 })) // abort s2
        .mockResolvedValueOnce(new Response(null, { status: 200 })) // abort s3
        .mockResolvedValueOnce(new Response(null, { status: 200 })) // resume s1
        .mockRejectedValueOnce(new Error('connection refused'))      // resume s2 fails
        .mockResolvedValueOnce(new Response(null, { status: 200 })) // resume s3

      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({
        '/a': ['s1', 's2', 's3'],
      })

      const restart = vi.fn(async () => true)

      const result = await coordinator.runWithResume(restart)

      expect(result.healthy).toBe(true)
      expect(result.resumedSessionIDs).toEqual(['s1', 's3'])
    })
  })

  describe('abortSessions', () => {
    it('does not throw when forward rejects and continues processing remaining sessions', async () => {
      const forward = vi.mocked(client.forward)
      forward
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))

      await expect(
        coordinator.abortSessions([
          { sessionID: 's1', directory: '/a' },
          { sessionID: 's2', directory: '/b' },
        ]),
      ).resolves.toBeUndefined()

      expect(forward).toHaveBeenCalledTimes(2)
      expect(forward).toHaveBeenNthCalledWith(1, {
        method: 'POST',
        path: '/api/session/s1/interrupt',
      })
      expect(forward).toHaveBeenNthCalledWith(2, {
        method: 'POST',
        path: '/api/session/s2/interrupt',
      })
    })
  })

  describe('resumeSessions', () => {
    it('only includes sessions with ok response', async () => {
      const forward = vi.mocked(client.forward)
      forward
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))

      const sessions: ResumableSession[] = [
        { sessionID: 's1', directory: '/a' },
        { sessionID: 's2', directory: '/b' },
        { sessionID: 's3', directory: '/c' },
      ]

      const result = await coordinator.resumeSessions(sessions)

      expect(result).toEqual(['s1', 's3'])
    })

    it('does not throw when forward rejects', async () => {
      vi.mocked(client.forward).mockRejectedValue(new Error('timeout'))

      const result = await coordinator.resumeSessions([{ sessionID: 's1', directory: '/a' }])

      expect(result).toEqual([])
    })
  })
})
