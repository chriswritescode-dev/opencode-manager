import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenCodeRestartCoordinator, type ActiveSessionsProvider } from './opencode-restart-coordinator'

vi.mock('../utils/logger', () => ({
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
  let activeSessions: ActiveSessionsProvider
  let coordinator: OpenCodeRestartCoordinator

  beforeEach(() => {
    activeSessions = createFakeActiveSessionsProvider()
    coordinator = new OpenCodeRestartCoordinator(activeSessions)
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
    it('restarts and reports the captured running sessions without any api calls', async () => {
      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({
        '/a': ['s1'],
        '/b': ['s2'],
      })

      const restart = vi.fn(async () => true)

      const result = await coordinator.runWithResume(restart)

      expect(restart).toHaveBeenCalledOnce()
      expect(result).toEqual({ healthy: true, resumedSessionIDs: ['s1', 's2'] })
    })

    it('reports no resumed sessions when the restart returns unhealthy', async () => {
      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({
        '/a': ['s1'],
      })

      const restart = vi.fn(async () => false)

      const result = await coordinator.runWithResume(restart)

      expect(restart).toHaveBeenCalledOnce()
      expect(result).toEqual({ healthy: false, resumedSessionIDs: [] })
    })

    it('with no active sessions performs restart only', async () => {
      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({})

      const restart = vi.fn(async () => true)

      const result = await coordinator.runWithResume(restart)

      expect(restart).toHaveBeenCalledOnce()
      expect(result).toEqual({ healthy: true, resumedSessionIDs: [] })
    })

    it('does not report subagent or scheduled sessions', async () => {
      vi.mocked(activeSessions.getActiveSessions).mockReturnValue({
        '/a': ['manual1', 'sub1', 'sched1'],
      })
      vi.mocked(activeSessions.isSubagentSession).mockImplementation((id: string) => id === 'sub1')
      vi.mocked(activeSessions.getScheduledSessionIds).mockReturnValue(new Set(['sched1']))

      const restart = vi.fn(async () => true)

      const result = await coordinator.runWithResume(restart)

      expect(result).toEqual({ healthy: true, resumedSessionIDs: ['manual1'] })
    })
  })
})
