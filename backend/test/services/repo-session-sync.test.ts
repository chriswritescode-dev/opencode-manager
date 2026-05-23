import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../../src/services/opencode/client', () => ({
  createOpenCodeClient: vi.fn(),
}))

import { RepoSessionSyncService } from '../../src/services/opencode/repo-session-sync'
import type { RepoOpenCodeTargetManager } from '../../src/services/opencode/repo-target-manager'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { SyncEvent } from '../../src/services/opencode/repo-session-sync'

function createMockTargetManager(): RepoOpenCodeTargetManager {
  return {
    ensureTarget: vi.fn().mockResolvedValue({
      repoId: 1,
      state: 'healthy',
      openCodeUrl: '/api/opencode-targets/repo/1',
      headers: { Authorization: 'Bearer test-token' },
      reused: false,
    }),
    getTarget: vi.fn().mockReturnValue(null),
    stopTarget: vi.fn().mockResolvedValue(undefined),
  } as unknown as RepoOpenCodeTargetManager
}

function createMockOpenCodeClient(): OpenCodeClient {
  return {
    forward: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    forwardRaw: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    getJson: vi.fn(async () => ({}) as unknown),
    postJson: vi.fn(async () => ({ session_id: 'test-session' }) as unknown),
    setProviderAuth: vi.fn(async () => true),
    deleteProviderAuth: vi.fn(async () => true),
    startMcpAuth: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    authenticateMcp: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
  } as OpenCodeClient
}

describe('RepoSessionSyncService', () => {
  let service: RepoSessionSyncService
  let targetManager: RepoOpenCodeTargetManager
  let openCodeClient: OpenCodeClient

  beforeEach(() => {
    vi.clearAllMocks()
    targetManager = createMockTargetManager()
    openCodeClient = createMockOpenCodeClient()
    service = new RepoSessionSyncService(targetManager)
  })

  it('should sync a session with events', async () => {
    const mockEvents: SyncEvent[] = [
      {
        id: 'event-1',
        aggregate_id: 'session-123',
        seq: 1,
        type: 'session.created',
        data: { sessionID: 'session-123' },
      },
      {
        id: 'event-2',
        aggregate_id: 'session-123',
        seq: 2,
        type: 'message.created',
        data: { messageID: 'msg-1' },
      },
    ]

    const mockHistoryResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue(mockEvents),
      text: vi.fn().mockResolvedValue(''),
    }

    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValue(mockHistoryResponse)

    const result = await service.syncSession({
      repoId: 1,
      sessionId: 'session-123',
      sourceBaseUrl: 'http://127.0.0.1:3000',
      sourceAuthHeader: 'Basic test-auth',
      targetClient: openCodeClient,
      directory: '/test/repo',
      reason: 'manual',
    })

    expect(result.replayedEvents).toBe(2)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/sync/history',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic test-auth',
        },
        body: JSON.stringify({ 'session-123': -1 }),
      }
    )
    expect(openCodeClient.postJson).toHaveBeenCalledWith('/sync/replay', {
      directory: '/test/repo',
      events: [
        {
          id: 'event-1',
          aggregateID: 'session-123',
          seq: 1,
          type: 'session.created',
          data: { sessionID: 'session-123' },
        },
        {
          id: 'event-2',
          aggregateID: 'session-123',
          seq: 2,
          type: 'message.created',
          data: { messageID: 'msg-1' },
        },
      ],
    })
  })

  it('should filter events to only selected session', async () => {
    const mockEvents: SyncEvent[] = [
      {
        id: 'event-1',
        aggregate_id: 'session-123',
        seq: 1,
        type: 'session.created',
        data: { sessionID: 'session-123' },
      },
      {
        id: 'event-2',
        aggregate_id: 'session-456',
        seq: 1,
        type: 'session.created',
        data: { sessionID: 'session-456' },
      },
    ]

    const mockHistoryResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue(mockEvents),
      text: vi.fn().mockResolvedValue(''),
    }

    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValue(mockHistoryResponse)

    const result = await service.syncSession({
      repoId: 1,
      sessionId: 'session-123',
      sourceBaseUrl: 'http://127.0.0.1:3000',
      sourceAuthHeader: 'Basic test-auth',
      targetClient: openCodeClient,
      directory: '/test/repo',
      reason: 'manual',
    })

    expect(result.replayedEvents).toBe(1)
    expect(openCodeClient.postJson).toHaveBeenCalledWith('/sync/replay', {
      directory: '/test/repo',
      events: [
        {
          id: 'event-1',
          aggregateID: 'session-123',
          seq: 1,
          type: 'session.created',
          data: { sessionID: 'session-123' },
        },
      ],
    })
  })

  it('should return zero replayed events when no events found', async () => {
    const mockHistoryResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue([]),
      text: vi.fn().mockResolvedValue(''),
    }

    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValue(mockHistoryResponse)

    const result = await service.syncSession({
      repoId: 1,
      sessionId: 'session-123',
      sourceBaseUrl: 'http://127.0.0.1:3000',
      sourceAuthHeader: 'Basic test-auth',
      targetClient: openCodeClient,
      directory: '/test/repo',
      reason: 'manual',
    })

    expect(result.replayedEvents).toBe(0)
    expect(openCodeClient.postJson).not.toHaveBeenCalled()
  })

  it('should include seq 0 event in replay', async () => {
    const mockEvents: SyncEvent[] = [
      {
        id: 'event-0',
        aggregate_id: 'session-123',
        seq: 0,
        type: 'session.created',
        data: { sessionID: 'session-123' },
      },
      {
        id: 'event-1',
        aggregate_id: 'session-123',
        seq: 1,
        type: 'message.created',
        data: { messageID: 'msg-1' },
      },
    ]

    const mockHistoryResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue(mockEvents),
      text: vi.fn().mockResolvedValue(''),
    }

    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValue(mockHistoryResponse)

    const result = await service.syncSession({
      repoId: 1,
      sessionId: 'session-123',
      sourceBaseUrl: 'http://127.0.0.1:3000',
      sourceAuthHeader: 'Basic test-auth',
      targetClient: openCodeClient,
      directory: '/test/repo',
      reason: 'manual',
    })

    expect(result.replayedEvents).toBe(2)
    expect(openCodeClient.postJson).toHaveBeenCalledWith('/sync/replay', {
      directory: '/test/repo',
      events: [
        {
          id: 'event-0',
          aggregateID: 'session-123',
          seq: 0,
          type: 'session.created',
          data: { sessionID: 'session-123' },
        },
        {
          id: 'event-1',
          aggregateID: 'session-123',
          seq: 1,
          type: 'message.created',
          data: { messageID: 'msg-1' },
        },
      ],
    })
  })

  it('should throw error when history fetch fails', async () => {
    const mockHistoryResponse = {
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    }

    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValue(mockHistoryResponse)

    await expect(
      service.syncSession({
        repoId: 1,
        sessionId: 'session-123',
        sourceBaseUrl: 'http://127.0.0.1:3000',
        sourceAuthHeader: 'Basic test-auth',
        targetClient: openCodeClient,
        directory: '/test/repo',
        reason: 'manual',
      })
    ).rejects.toThrow('Failed to fetch sync history: 500 Internal Server Error')
  })

  it('should not call /sync/steal on main server', async () => {
    const mockEvents: SyncEvent[] = [
      {
        id: 'event-1',
        aggregate_id: 'session-123',
        seq: 1,
        type: 'session.created',
        data: { sessionID: 'session-123' },
      },
    ]

    const mockHistoryResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue(mockEvents),
      text: vi.fn().mockResolvedValue(''),
    }

    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValue(mockHistoryResponse)

    await service.syncSession({
      repoId: 1,
      sessionId: 'session-123',
      sourceBaseUrl: 'http://127.0.0.1:3000',
      sourceAuthHeader: 'Basic test-auth',
      targetClient: openCodeClient,
      directory: '/test/repo',
      reason: 'manual',
    })

    expect(openCodeClient.postJson).not.toHaveBeenCalledWith(
      expect.stringContaining('/steal'),
      expect.anything()
    )
  })

  it('should rewrite directory to repo full path', async () => {
    const mockEvents: SyncEvent[] = [
      {
        id: 'event-1',
        aggregate_id: 'session-123',
        seq: 1,
        type: 'session.created',
        data: { sessionID: 'session-123' },
      },
    ]

    const mockHistoryResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue(mockEvents),
      text: vi.fn().mockResolvedValue(''),
    }

    global.fetch = vi.fn() as any;
    (global.fetch as any).mockResolvedValue(mockHistoryResponse)

    await service.syncSession({
      repoId: 1,
      sessionId: 'session-123',
      sourceBaseUrl: 'http://127.0.0.1:3000',
      sourceAuthHeader: 'Basic test-auth',
      targetClient: openCodeClient,
      directory: '/full/path/to/repo',
      reason: 'idle',
    })

    expect(openCodeClient.postJson).toHaveBeenCalledWith('/sync/replay', {
      directory: '/full/path/to/repo',
      events: expect.any(Array),
    })
  })
})
