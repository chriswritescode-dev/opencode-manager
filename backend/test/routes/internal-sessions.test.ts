import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import type { RepoWorkspaceProvider } from '../../src/services/repo-workspace'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'
import { createStubOpenCodeClient, sessionInfo, stubLoadedModelCatalog } from '../helpers/stub-opencode-client'
import { assistantMessage, sessionInboxUser } from '../helpers/stub-schedule-api'

const REPO_DIRECTORY = '/tmp/repo-one'
const WORKSPACE_DIRECTORY = '/tmp/repo-one-workspaces/feature'
const UNKNOWN_DIRECTORY = '/tmp/elsewhere'

const SessionSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  directory: z.string(),
  repoId: z.number().nullable(),
  busy: z.boolean(),
  outcome: z.string().nullable(),
  updated: z.number(),
})
const SessionsResponseSchema = z.object({ sessions: z.array(SessionSummarySchema) })
const LaunchedSessionResponseSchema = z.object({
  sessionId: z.string(),
  repoId: z.number().nullable(),
  directory: z.string(),
  workspaceDirectory: z.string().nullable(),
  model: z.string(),
  title: z.string().nullable(),
  url: z.string(),
})
const QueuedPromptResponseSchema = z.object({ queued: z.boolean() })
const ReplyResponseSchema = z.object({
  busy: z.boolean(),
  responseText: z.string().nullable(),
  errorText: z.string().nullable(),
  completed: z.boolean(),
})
const ForkResponseSchema = z.object({ sessionId: z.string(), directory: z.string() })

function sessionNotFoundError(): Error {
  return Object.assign(new Error('Session not found'), { _tag: 'SessionNotFoundError' })
}

describe('internal-sessions routes', () => {
  let db: Database
  let app: Hono
  let token: string
  let sessionList: Mock<OpenCodeApi['session']['list']>
  let sessionActive: Mock<OpenCodeApi['session']['active']>
  let sessionCreate: Mock<OpenCodeApi['session']['create']>
  let sessionPrompt: Mock<OpenCodeApi['session']['prompt']>
  let sessionFork: Mock<OpenCodeApi['session']['fork']>
  let messageList: Mock<OpenCodeApi['message']['list']>
  let locationGet: Mock<OpenCodeApi['location']['get']>
  let pinAsk: Mock<(sessionId: string) => void>
  let workspaceCreate: Mock<RepoWorkspaceProvider['create']>

  function createApp(repoWorkspaces: RepoWorkspaceProvider): void {
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, {
      openCodeClient: createStubOpenCodeClient({
        api: {
          ...stubLoadedModelCatalog(),
          location: { get: locationGet },
          session: {
            list: sessionList,
            active: sessionActive,
            create: sessionCreate,
            prompt: sessionPrompt,
            fork: sessionFork,
          },
          message: { list: messageList },
        },
      }),
      permissionModes: { pinAsk },
      repoWorkspaces,
    }))
  }

  async function authorizedRequest(path: string, init: { method?: string; body?: string } = {}): Promise<Response> {
    return app.request(path, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    })
  }

  beforeEach(() => {
    db = createTestDatabase()
    token = getOrCreateInternalToken(db)
    sessionList = vi.fn<OpenCodeApi['session']['list']>(async () => ({ data: [], cursor: {} }))
    sessionActive = vi.fn<OpenCodeApi['session']['active']>(async () => ({}))
    sessionCreate = vi.fn<OpenCodeApi['session']['create']>(async () => sessionInfo({ id: 'ses_new' }))
    sessionPrompt = vi.fn<OpenCodeApi['session']['prompt']>(async () => sessionInboxUser('ses_new'))
    sessionFork = vi.fn<OpenCodeApi['session']['fork']>()
    messageList = vi.fn<OpenCodeApi['message']['list']>(async () => ({ data: [], cursor: {} }))
    locationGet = vi.fn<OpenCodeApi['location']['get']>(async (input) => {
      const directory = input?.location?.directory ?? ''
      return {
        directory,
        project: { id: 'project-1', directory, canonical: directory },
      }
    })
    pinAsk = vi.fn<(sessionId: string) => void>()
    workspaceCreate = vi.fn<RepoWorkspaceProvider['create']>(async () => ({
      directory: '/tmp/repo-one-ws',
      worktreeSetup: { status: 'none' },
    }))
    createApp({ create: workspaceCreate, remove: vi.fn<RepoWorkspaceProvider['remove']>() })
  })

  afterEach(() => {
    db.close()
  })

  it('GET /api/internal/sessions returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/sessions')

    expect(res.status).toBe(401)
  })

  it('GET /api/internal/sessions filters by the repo OpenCode project and resolves workspace directories', async () => {
    const repoOne = seedRepo(db, { localPath: 'repo-one', sourcePath: REPO_DIRECTORY })
    const repoTwo = seedRepo(db, { localPath: 'repo-two', sourcePath: WORKSPACE_DIRECTORY })
    sessionList.mockResolvedValue({
      data: [
        { ...sessionInfo({ id: 'ses_a', title: 'Alpha' }), location: { directory: REPO_DIRECTORY }, time: { created: 1, updated: 42 }, outcome: 'succeeded' },
        { ...sessionInfo({ id: 'ses_ws', title: 'Workspace' }), location: { directory: WORKSPACE_DIRECTORY }, time: { created: 2, updated: 43 } },
        { ...sessionInfo({ id: 'ses_b', title: undefined }), location: { directory: UNKNOWN_DIRECTORY }, time: { created: 3, updated: 44 } },
        { ...sessionInfo({ id: 'ses_a2', title: undefined }), location: { directory: REPO_DIRECTORY }, time: { created: 4, updated: 45 } },
      ],
      cursor: {},
    })
    sessionActive.mockResolvedValue({ ses_a: { type: 'running' } })

    const res = await authorizedRequest('/api/internal/sessions?repoId=1&limit=5')

    expect(res.status).toBe(200)
    expect(locationGet).toHaveBeenCalledWith({ location: { directory: repoOne.fullPath } })
    expect(sessionList).toHaveBeenCalledWith({ limit: 5, order: 'desc', parentID: null, project: 'project-1' })
    expect(await readJson(res, SessionsResponseSchema)).toEqual({
      sessions: [
        { id: 'ses_a', title: 'Alpha', directory: REPO_DIRECTORY, repoId: repoOne.id, busy: true, outcome: 'succeeded', updated: 42 },
        { id: 'ses_ws', title: 'Workspace', directory: WORKSPACE_DIRECTORY, repoId: repoTwo.id, busy: false, outcome: null, updated: 43 },
        { id: 'ses_b', title: null, directory: UNKNOWN_DIRECTORY, repoId: null, busy: false, outcome: null, updated: 44 },
        { id: 'ses_a2', title: null, directory: REPO_DIRECTORY, repoId: repoOne.id, busy: false, outcome: null, updated: 45 },
      ],
    })
  })

  it('GET /api/internal/sessions lists without a project filter when repoId is omitted', async () => {
    const res = await authorizedRequest('/api/internal/sessions')

    expect(res.status).toBe(200)
    expect(sessionList).toHaveBeenCalledWith({ limit: 10, order: 'desc', parentID: null })
    expect(locationGet).not.toHaveBeenCalled()
  })

  it('GET /api/internal/sessions returns 404 for an unknown repoId', async () => {
    const res = await authorizedRequest('/api/internal/sessions?repoId=99')

    expect(res.status).toBe(404)
    expect(sessionList).not.toHaveBeenCalled()
  })

  it('POST /api/internal/sessions creates a session through the launcher and returns a url', async () => {
    const repo = seedRepo(db, { localPath: 'repo-one', sourcePath: REPO_DIRECTORY })
    sessionCreate.mockResolvedValue(sessionInfo({ id: 'ses_new', title: 'Do the thing' }))

    const res = await authorizedRequest('/api/internal/sessions', {
      method: 'POST',
      body: JSON.stringify({ repoId: repo.id, prompt: 'Do the thing', title: 'Do the thing' }),
    })

    expect(res.status).toBe(201)
    expect(sessionCreate).toHaveBeenCalledWith({
      title: 'Do the thing',
      agent: undefined,
      model: { providerID: 'openai', id: 'gpt-5-mini', variant: undefined },
      location: { directory: repo.fullPath },
    })
    expect(sessionPrompt).toHaveBeenCalledWith({ sessionID: 'ses_new', text: 'Do the thing' })
    expect(pinAsk).toHaveBeenCalledWith('ses_new')
    expect(await readJson(res, LaunchedSessionResponseSchema)).toMatchObject({
      sessionId: 'ses_new',
      repoId: repo.id,
      directory: repo.fullPath,
      workspaceDirectory: null,
      model: 'openai/gpt-5-mini',
      title: 'Do the thing',
      url: `/repos/${repo.id}/sessions/ses_new`,
    })
  })

  it('POST /api/internal/sessions passes the raw title as the workspace name', async () => {
    const repo = seedRepo(db, { localPath: 'repo-one', sourcePath: REPO_DIRECTORY })
    sessionCreate.mockResolvedValue(sessionInfo({ id: 'ses_ws', title: 'My Feature' }))

    const res = await authorizedRequest('/api/internal/sessions', {
      method: 'POST',
      body: JSON.stringify({ repoId: repo.id, prompt: 'Build it', title: 'My Feature!', worktree: true, ref: 'main' }),
    })

    expect(res.status).toBe(201)
    expect(workspaceCreate).toHaveBeenCalledWith(repo, { name: 'My-Feature', ref: 'main' })
    expect(pinAsk).toHaveBeenCalledWith('ses_ws')
    expect(await readJson(res, LaunchedSessionResponseSchema)).toMatchObject({
      sessionId: 'ses_ws',
      workspaceDirectory: '/tmp/repo-one-ws',
      url: `/repos/${repo.id}/sessions/ses_ws?repoTab=workspaces`,
    })
  })

  it('POST /api/internal/sessions uses the fallback workspace name when the title is missing', async () => {
    const repo = seedRepo(db, { localPath: 'repo-one', sourcePath: REPO_DIRECTORY })
    sessionCreate.mockResolvedValue(sessionInfo({ id: 'ses_ws' }))

    const res = await authorizedRequest('/api/internal/sessions', {
      method: 'POST',
      body: JSON.stringify({ repoId: repo.id, prompt: 'Build it', worktree: true }),
    })

    expect(res.status).toBe(201)
    expect(workspaceCreate).toHaveBeenCalledWith(repo, { name: 'ocm-session' })
    expect(pinAsk).toHaveBeenCalledWith('ses_ws')
  })

  it.each([
    ['a missing prompt', { repoId: 1 }, 400],
    ['an unknown repo', { repoId: 99, prompt: 'Do the thing' }, 404],
  ])('POST /api/internal/sessions rejects %s without creating a session', async (_label, body, expectedStatus) => {
    seedRepo(db, { localPath: 'repo-one', sourcePath: REPO_DIRECTORY })

    const res = await authorizedRequest('/api/internal/sessions', { method: 'POST', body: JSON.stringify(body) })

    expect(res.status).toBe(expectedStatus)
    expect(sessionCreate).not.toHaveBeenCalled()
  })

  it('POST /api/internal/sessions/:sessionId/prompt queues the prompt', async () => {
    const res = await authorizedRequest('/api/internal/sessions/ses_a/prompt', {
      method: 'POST',
      body: JSON.stringify({ text: 'Keep going' }),
    })

    expect(res.status).toBe(202)
    expect(await readJson(res, QueuedPromptResponseSchema)).toEqual({ queued: true })
    expect(sessionPrompt).toHaveBeenCalledWith({ sessionID: 'ses_a', text: 'Keep going', delivery: 'queue' })
  })

  it('GET /api/internal/sessions/:sessionId/reply returns the latest assistant reply', async () => {
    sessionActive.mockResolvedValue({ ses_a: { type: 'running' } })
    messageList.mockResolvedValue({ data: [assistantMessage('All done', { completed: true })], cursor: {} })

    const res = await authorizedRequest('/api/internal/sessions/ses_a/reply')

    expect(res.status).toBe(200)
    expect(messageList).toHaveBeenCalledWith({ sessionID: 'ses_a', order: 'desc', limit: 20 })
    expect(await readJson(res, ReplyResponseSchema)).toEqual({
      busy: true,
      responseText: 'All done',
      errorText: null,
      completed: true,
    })
  })

  it('GET /api/internal/sessions/:sessionId/reply returns empty state when there is no assistant message', async () => {
    const res = await authorizedRequest('/api/internal/sessions/ses_a/reply')

    expect(res.status).toBe(200)
    expect(await readJson(res, ReplyResponseSchema)).toEqual({
      busy: false,
      responseText: null,
      errorText: null,
      completed: false,
    })
  })

  it('GET /api/internal/sessions/:sessionId/reply rejects an invalid waitMs', async () => {
    const res = await authorizedRequest('/api/internal/sessions/ses_a/reply?waitMs=60000')

    expect(res.status).toBe(400)
    expect(messageList).not.toHaveBeenCalled()
  })

  it('GET /api/internal/sessions/:sessionId/reply returns without waiting when the session is not busy', async () => {
    messageList.mockResolvedValue({ data: [assistantMessage('All done', { completed: true })], cursor: {} })

    const res = await authorizedRequest('/api/internal/sessions/ses_a/reply?waitMs=5000')

    expect(res.status).toBe(200)
    expect(await readJson(res, ReplyResponseSchema)).toEqual({
      busy: false,
      responseText: 'All done',
      errorText: null,
      completed: true,
    })
  })

  it('POST /api/internal/sessions/:sessionId/fork passes before and returns the new session', async () => {
    sessionFork.mockResolvedValue(sessionInfo({ id: 'ses_fork' }))

    const res = await authorizedRequest('/api/internal/sessions/ses_a/fork', {
      method: 'POST',
      body: JSON.stringify({ beforeMessageId: 'msg_1' }),
    })

    expect(res.status).toBe(200)
    expect(sessionFork).toHaveBeenCalledWith({ sessionID: 'ses_a', before: 'msg_1' })
    expect(pinAsk).toHaveBeenCalledWith('ses_fork')
    expect(await readJson(res, ForkResponseSchema)).toEqual({
      sessionId: 'ses_fork',
      directory: sessionInfo({ id: 'ses_fork' }).location.directory,
    })
  })

  it('POST /api/internal/sessions/:sessionId/fork accepts an empty body', async () => {
    sessionFork.mockResolvedValue(sessionInfo({ id: 'ses_fork' }))

    const res = await authorizedRequest('/api/internal/sessions/ses_a/fork', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(sessionFork).toHaveBeenCalledWith({ sessionID: 'ses_a' })
    expect(pinAsk).toHaveBeenCalledWith('ses_fork')
  })

  it('returns 404 when OpenCode reports an unknown session', async () => {
    sessionPrompt.mockRejectedValue(sessionNotFoundError())

    const res = await authorizedRequest('/api/internal/sessions/ses_missing/prompt', {
      method: 'POST',
      body: JSON.stringify({ text: 'Hello' }),
    })

    expect(res.status).toBe(404)
  })

  it('returns 404 for DELETE /api/internal/sessions/:sessionId because no route exists', async () => {
    const res = await authorizedRequest('/api/internal/sessions/ses_a', { method: 'DELETE' })

    expect(res.status).toBe(404)
  })
})
