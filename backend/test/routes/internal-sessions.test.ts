import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { createInternalRoutes } from '../../src/routes/internal'
import type { ScheduleService } from '../../src/services/schedules'
import type { NotificationService } from '../../src/services/notification'
import type { SettingsService } from '../../src/services/settings'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { SessionPermissionModeService } from '../../src/services/session-permission-modes'
import type { Repo } from '../../src/types/repo'

const mockDb = {
  prepare: vi.fn().mockReturnValue({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
  }),
  exec: vi.fn(),
  close: vi.fn(),
  transaction: vi.fn((fn: () => void) => fn()),
} as unknown as Database

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(() => mockDb),
}))

const mockListRepos = vi.fn()
const mockGetRepoById = vi.fn()
vi.mock('../../src/db/queries', async () => {
  const { getRepoDisplayName } = await vi.importActual<typeof import('@opencode-manager/shared/utils')>('@opencode-manager/shared/utils')
  return {
    listRepos: (...args: unknown[]) => mockListRepos(...args),
    getRepoById: (...args: unknown[]) => mockGetRepoById(...args),
    getRepoName: (repo: Parameters<typeof getRepoDisplayName>[0]) => getRepoDisplayName(repo),
  }
})

vi.mock('../../src/db/migration-runner', () => ({
  migrate: vi.fn(),
}))

vi.mock('../../src/services/internal-token', () => ({
  getOrCreateInternalToken: vi.fn().mockReturnValue('test-internal-token'),
}))

vi.mock('../../src/services/schedules', () => ({
  ScheduleService: vi.fn(),
}))

vi.mock('../../src/services/notification', () => ({
  NotificationService: vi.fn(),
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn(),
}))

vi.mock('../../src/services/opencode/client', () => ({
  createOpenCodeClient: vi.fn(),
}))

const mockLaunch = vi.fn()
const mockPinAsk = vi.fn()
vi.mock('../../src/services/session-launcher', () => {
  class SessionLaunchError extends Error {
    readonly status: number

    constructor(message: string, status: number) {
      super(message)
      this.name = 'SessionLaunchError'
      this.status = status
    }
  }

  class SessionLauncher {
    launch = mockLaunch
  }

  return { SessionLauncher, SessionLaunchError }
})

const mockResolveRepoForDirectory = vi.fn()
const mockResolveRepoProjectId = vi.fn()
vi.mock('../../src/services/repo', () => ({
  resolveRepoForDirectory: (...args: unknown[]) => mockResolveRepoForDirectory(...args),
  resolveRepoProjectId: (...args: unknown[]) => mockResolveRepoProjectId(...args),
}))

function makeRepo(overrides: Partial<Repo>): Repo {
  return {
    id: 1,
    localPath: 'test-repo',
    fullPath: '/tmp/test-repo',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    ...overrides,
  }
}

function sessionNotFoundError(): Error {
  return Object.assign(new Error('Session not found'), { _tag: 'SessionNotFoundError' })
}

const assistantMessage = {
  id: 'msg_1',
  type: 'assistant',
  agent: 'build',
  model: { id: 'model', providerID: 'provider' },
  time: { created: 1, completed: 2 },
  content: [{ type: 'text', text: 'All done' }],
}

describe('internal-sessions routes', () => {
  let app: Hono
  let token: string
  let openCodeClient: OpenCodeClient
  let sessionList: ReturnType<typeof vi.fn>
  let sessionActive: ReturnType<typeof vi.fn>
  let sessionPrompt: ReturnType<typeof vi.fn>
  let sessionFork: ReturnType<typeof vi.fn>
  let messageList: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockLaunch.mockReset()
    mockGetRepoById.mockReturnValue(null)
    mockListRepos.mockReturnValue([])
    mockResolveRepoForDirectory.mockReset()
    mockResolveRepoForDirectory.mockResolvedValue(null)
    mockResolveRepoProjectId.mockReset()
    mockResolveRepoProjectId.mockResolvedValue('project-1')

    sessionList = vi.fn().mockResolvedValue({ data: [], cursor: {} })
    sessionActive = vi.fn().mockResolvedValue({})
    sessionPrompt = vi.fn().mockResolvedValue({})
    sessionFork = vi.fn()
    messageList = vi.fn().mockResolvedValue({ data: [] })

    openCodeClient = {
      api: {
        session: {
          list: sessionList,
          active: sessionActive,
          prompt: sessionPrompt,
          fork: sessionFork,
        },
        message: { list: messageList },
      },
    } as unknown as OpenCodeClient

    const scheduleService = {} as ScheduleService
    const notificationService = {} as NotificationService
    const settingsService = {} as SettingsService
    const permissionModes = { pinAsk: mockPinAsk } as unknown as SessionPermissionModeService
    app = new Hono()
    app.route(
      '/api/internal',
      createInternalRoutes(mockDb, scheduleService, notificationService, settingsService, openCodeClient, permissionModes),
    )
    token = 'test-internal-token'
  })

  it('GET /api/internal/sessions returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/sessions')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/sessions filters by the repo OpenCode project and resolves workspace directories', async () => {
    const repo = makeRepo({ id: 1, fullPath: '/tmp/repo-one' })
    mockGetRepoById.mockReturnValue(repo)
    mockResolveRepoProjectId.mockResolvedValue('proj-1')
    mockResolveRepoForDirectory.mockImplementation(async (_db: unknown, directory: string) =>
      directory === '/tmp/elsewhere' ? null : repo,
    )
    sessionList.mockResolvedValue({
      data: [
        { id: 'ses_a', title: 'Alpha', location: { directory: '/tmp/repo-one' }, time: { created: 1, updated: 42 }, outcome: 'succeeded' },
        { id: 'ses_ws', title: 'Workspace', location: { directory: '/tmp/repo-one-workspaces/feature' }, time: { created: 2, updated: 43 } },
        { id: 'ses_b', location: { directory: '/tmp/elsewhere' }, time: { created: 3, updated: 44 } },
        { id: 'ses_a2', location: { directory: '/tmp/repo-one' }, time: { created: 4, updated: 45 } },
      ],
      cursor: {},
    })
    sessionActive.mockResolvedValue({ ses_a: { sessionID: 'ses_a' } })

    const res = await app.request('/api/internal/sessions?repoId=1&limit=5', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(mockResolveRepoProjectId).toHaveBeenCalledWith(openCodeClient, '/tmp/repo-one')
    expect(sessionList).toHaveBeenCalledWith({ limit: 5, order: 'desc', parentID: null, project: 'proj-1' })
    expect(mockResolveRepoForDirectory).toHaveBeenCalledTimes(3)
    const body = await res.json() as { sessions: Array<Record<string, unknown>> }
    expect(body.sessions).toHaveLength(4)
    expect(body.sessions[0]).toMatchObject({ id: 'ses_a', title: 'Alpha', repoId: 1, busy: true, outcome: 'succeeded', updated: 42 })
    expect(body.sessions[1]).toMatchObject({ id: 'ses_ws', title: 'Workspace', repoId: 1, busy: false, outcome: null, updated: 43 })
    expect(body.sessions[2]).toMatchObject({ id: 'ses_b', title: null, repoId: null, busy: false, outcome: null, updated: 44 })
    expect(body.sessions[3]).toMatchObject({ id: 'ses_a2', repoId: 1, busy: false, updated: 45 })
  })

  it('GET /api/internal/sessions lists without a project filter when repoId is omitted', async () => {
    sessionList.mockResolvedValue({ data: [], cursor: {} })

    const res = await app.request('/api/internal/sessions', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(sessionList).toHaveBeenCalledWith({ limit: 10, order: 'desc', parentID: null })
    expect(mockResolveRepoProjectId).not.toHaveBeenCalled()
  })

  it('GET /api/internal/sessions returns 404 for an unknown repoId', async () => {
    const res = await app.request('/api/internal/sessions?repoId=99', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(404)
    expect(sessionList).not.toHaveBeenCalled()
  })

  it('POST /api/internal/sessions creates a session through the launcher and returns a url', async () => {
    mockLaunch.mockResolvedValue({
      sessionId: 'ses_new',
      repoId: 1,
      directory: '/tmp/repo-one',
      workspaceDirectory: null,
      model: 'provider/model',
      title: 'Do the thing',
    })

    const res = await app.request('/api/internal/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repoId: 1, prompt: 'Do the thing', title: 'Do the thing' }),
    })

    expect(res.status).toBe(201)
    expect(mockLaunch).toHaveBeenCalledWith({ repoId: 1, prompt: 'Do the thing', title: 'Do the thing' })
    expect(mockPinAsk).toHaveBeenCalledWith('ses_new')
    const body = await res.json() as { sessionId: string; url: string }
    expect(body.sessionId).toBe('ses_new')
    expect(body.url).toBe('/repos/1/sessions/ses_new')
  })

  it('POST /api/internal/sessions passes the raw title as the workspace name', async () => {
    mockLaunch.mockResolvedValue({
      sessionId: 'ses_ws',
      repoId: 1,
      directory: '/tmp/repo-one-ws',
      workspaceDirectory: '/tmp/repo-one-ws',
      model: 'provider/model',
      title: 'My Feature',
    })

    const res = await app.request('/api/internal/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repoId: 1, prompt: 'Build it', title: 'My Feature!', worktree: true, ref: 'main' }),
    })

    expect(res.status).toBe(201)
    expect(mockLaunch).toHaveBeenCalledWith({
      repoId: 1,
      prompt: 'Build it',
      title: 'My Feature!',
      workspace: { name: 'My Feature!', ref: 'main' },
    })
    expect(mockPinAsk).toHaveBeenCalledWith('ses_ws')
    const body = await res.json() as { url: string }
    expect(body.url).toBe('/repos/1/sessions/ses_ws?repoTab=workspaces')
  })

  it('POST /api/internal/sessions uses the fallback workspace name when the title is missing', async () => {
    mockLaunch.mockResolvedValue({
      sessionId: 'ses_ws',
      repoId: 1,
      directory: '/tmp/repo-one-ws',
      workspaceDirectory: '/tmp/repo-one-ws',
      model: 'provider/model',
      title: null,
    })

    const res = await app.request('/api/internal/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repoId: 1, prompt: 'Build it', worktree: true }),
    })

    expect(res.status).toBe(201)
    expect(mockLaunch).toHaveBeenCalledWith({ repoId: 1, prompt: 'Build it', workspace: { name: 'ocm-session' } })
    expect(mockPinAsk).toHaveBeenCalledWith('ses_ws')
  })

  it('POST /api/internal/sessions rejects an invalid body', async () => {
    const res = await app.request('/api/internal/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repoId: 1 }),
    })

    expect(res.status).toBe(400)
    expect(mockLaunch).not.toHaveBeenCalled()
  })

  it('POST /api/internal/sessions/:sessionId/prompt queues the prompt', async () => {
    const res = await app.request('/api/internal/sessions/ses_a/prompt', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Keep going' }),
    })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ queued: true })
    expect(sessionPrompt).toHaveBeenCalledWith({ sessionID: 'ses_a', text: 'Keep going', delivery: 'queue' })
  })

  it('GET /api/internal/sessions/:sessionId/reply returns the latest assistant reply', async () => {
    sessionActive.mockResolvedValue({ ses_a: { sessionID: 'ses_a' } })
    messageList.mockResolvedValue({ data: [assistantMessage] })

    const res = await app.request('/api/internal/sessions/ses_a/reply', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(messageList).toHaveBeenCalledWith({ sessionID: 'ses_a', order: 'desc', limit: 20 })
    expect(await res.json()).toEqual({ busy: true, responseText: 'All done', errorText: null, completed: true })
  })

  it('GET /api/internal/sessions/:sessionId/reply returns empty state when there is no assistant message', async () => {
    const res = await app.request('/api/internal/sessions/ses_a/reply', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ busy: false, responseText: null, errorText: null, completed: false })
  })

  it('GET /api/internal/sessions/:sessionId/reply rejects an invalid waitMs', async () => {
    const res = await app.request('/api/internal/sessions/ses_a/reply?waitMs=60000', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(400)
    expect(messageList).not.toHaveBeenCalled()
  })

  it('GET /api/internal/sessions/:sessionId/reply returns without waiting when the session is not busy', async () => {
    messageList.mockResolvedValue({ data: [assistantMessage] })

    const res = await app.request('/api/internal/sessions/ses_a/reply?waitMs=5000', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ busy: false, responseText: 'All done', errorText: null, completed: true })
  })

  it('POST /api/internal/sessions/:sessionId/fork passes before and returns the new session', async () => {
    sessionFork.mockResolvedValue({ id: 'ses_fork', location: { directory: '/tmp/repo-one' } })

    const res = await app.request('/api/internal/sessions/ses_a/fork', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ beforeMessageId: 'msg_1' }),
    })

    expect(res.status).toBe(200)
    expect(sessionFork).toHaveBeenCalledWith({ sessionID: 'ses_a', before: 'msg_1' })
    expect(mockPinAsk).toHaveBeenCalledWith('ses_fork')
    expect(await res.json()).toEqual({ sessionId: 'ses_fork', directory: '/tmp/repo-one' })
  })

  it('POST /api/internal/sessions/:sessionId/fork accepts an empty body', async () => {
    sessionFork.mockResolvedValue({ id: 'ses_fork', location: { directory: '/tmp/repo-one' } })

    const res = await app.request('/api/internal/sessions/ses_a/fork', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(sessionFork).toHaveBeenCalledWith({ sessionID: 'ses_a' })
    expect(mockPinAsk).toHaveBeenCalledWith('ses_fork')
  })

  it('returns 404 when OpenCode reports an unknown session', async () => {
    sessionPrompt.mockRejectedValue(sessionNotFoundError())

    const res = await app.request('/api/internal/sessions/ses_missing/prompt', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    })

    expect(res.status).toBe(404)
  })

  it('returns 404 for DELETE /api/internal/sessions/:sessionId because no route exists', async () => {
    const res = await app.request('/api/internal/sessions/ses_a', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(404)
  })
})
