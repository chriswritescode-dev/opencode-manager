import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JsonObject } from '@opencode-manager/shared/utils'
import { createFetchFake, type FetchFake, type FetchRoute } from '@/test/fetchFake'
import { FetchError } from './fetchWrapper'
import {
  activateSkill,
  addSessionContext,
  askSideQuestion,
  cancelForm,
  clearRevert,
  commitRevert,
  compactSession,
  createSession,
  createSessionWithContext,
  createSessionWithPrompt,
  deleteSession,
  findFiles,
  findRemoteProjectForDirectory,
  forkSession,
  getSession,
  interruptSession,
  listCommands,
  listPendingForms,
  listPendingPermissions,
  listSessionMessages,
  listSessionPage,
  rankProjectsBySessionActivity,
  readSessionSnapshot,
  remoteProjectName,
  renameSession,
  replyForm,
  replyPermission,
  runCommand,
  runShell,
  sendPrompt,
  sortProjectsByUpdatedAt,
  stageRevert,
  switchSessionAgent,
  switchSessionModel,
  SIDE_QUESTION_INSTRUCTIONS,
} from './opencode'

const sessionUrl = '/api/opencode/api/session'

const sessionInfo = (id: string, directory: string) => ({
  id,
  projectID: 'proj_1',
  title: `Session ${id}`,
  time: { created: 1000, updated: 2000 },
  location: { directory },
})

function installRoutes(routes: FetchRoute[]): FetchFake {
  const fetchFake = createFetchFake(routes)
  fetchFake.install()
  return fetchFake
}

function respondTo(method: FetchRoute['method'], path: string, json: JsonObject): FetchRoute {
  return { method, path, respond: () => ({ json }) }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OpenCode facade', () => {
  it('lists root sessions for a directory through the V2 cursor API', async () => {
    const fetchFake = installRoutes([
      respondTo('GET', sessionUrl, { data: [sessionInfo('ses_1', '/repo')], cursor: { next: 'cursor_next' } }),
    ])

    const page = await listSessionPage({
      directory: '/repo',
      limit: 25,
      order: 'desc',
      search: 'deploy',
      parentID: null,
    })

    expect(fetchFake.lastRequest('GET', sessionUrl)?.searchParams.toString()).toBe(
      'limit=25&order=desc&search=deploy&parentID=null&directory=%2Frepo',
    )
    expect(page.items).toEqual([sessionInfo('ses_1', '/repo')])
    expect(page.nextCursor).toBe('cursor_next')
  })

  it('passes the directory and cursor for continuation pages', async () => {
    const fetchFake = installRoutes([respondTo('GET', sessionUrl, { data: [], cursor: {} })])

    const page = await listSessionPage({ directory: '/repo', cursor: 'cursor_1', parentID: null })

    expect(fetchFake.lastRequest('GET', sessionUrl)?.searchParams.toString()).toBe(
      'parentID=null&directory=%2Frepo&cursor=cursor_1',
    )
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeUndefined()
  })

  it('omits the directory when listing sessions across all directories', async () => {
    const fetchFake = installRoutes([
      respondTo('GET', sessionUrl, { data: [sessionInfo('ses_1', '/repo')], cursor: { next: 'cursor_next' } }),
    ])

    const page = await listSessionPage({ limit: 25, order: 'desc', parentID: null })

    expect(fetchFake.lastRequest('GET', sessionUrl)?.searchParams.toString()).toBe(
      'limit=25&order=desc&parentID=null',
    )
    expect(page.items).toEqual([sessionInfo('ses_1', '/repo')])
    expect(page.nextCursor).toBe('cursor_next')
  })

  it('omits the directory on an all-directories continuation page', async () => {
    const fetchFake = installRoutes([respondTo('GET', sessionUrl, { data: [], cursor: {} })])

    await listSessionPage({ cursor: 'cursor_1', parentID: null })

    expect(fetchFake.lastRequest('GET', sessionUrl)?.searchParams.toString()).toBe('parentID=null&cursor=cursor_1')
  })

  it('omits the parentID filter when including child sessions', async () => {
    const fetchFake = installRoutes([
      respondTo('GET', sessionUrl, { data: [sessionInfo('ses_child', '/repo')], cursor: {} }),
    ])

    await listSessionPage({ directory: '/repo', limit: 25, order: 'desc' })

    expect(fetchFake.lastRequest('GET', sessionUrl)?.searchParams.toString()).toBe(
      'limit=25&order=desc&directory=%2Frepo',
    )
  })

  it('reads a single session from the V2 session route', async () => {
    installRoutes([respondTo('GET', `${sessionUrl}/ses_1`, { data: sessionInfo('ses_1', '/repo') })])

    await expect(getSession('ses_1')).resolves.toEqual(sessionInfo('ses_1', '/repo'))
  })

  it('creates a session with location and a parsed model reference', async () => {
    const fetchFake = installRoutes([respondTo('POST', sessionUrl, { data: sessionInfo('ses_new', '/repo') })])

    const session = await createSession({
      directory: '/repo',
      title: 'New session',
      agent: 'build',
      model: 'anthropic/claude#v1',
    })

    expect(fetchFake.lastRequest('POST', sessionUrl)?.body).toEqual({
      title: 'New session',
      agent: 'build',
      model: { providerID: 'anthropic', id: 'claude', variant: 'v1' },
      location: { directory: '/repo' },
    })
    expect(session.id).toBe('ses_new')
  })

  it('creates a session with the required location and no optional fields', async () => {
    const fetchFake = installRoutes([respondTo('POST', sessionUrl, { data: sessionInfo('ses_new', '/repo') })])

    await createSession({ directory: '/repo' })

    expect(fetchFake.lastRequest('POST', sessionUrl)?.body).toEqual({ location: { directory: '/repo' } })
  })

  it('deletes a session through the V2 session route', async () => {
    const fetchFake = installRoutes([
      { method: 'DELETE', path: `${sessionUrl}/ses_1`, respond: () => ({ status: 204 }) },
    ])

    await expect(deleteSession('ses_1')).resolves.toBeUndefined()

    expect(fetchFake.findRequests('DELETE', `${sessionUrl}/ses_1`)).toHaveLength(1)
  })

  it('renames a session with a title update', async () => {
    const fetchFake = installRoutes([
      { method: 'PATCH', path: `${sessionUrl}/ses_1`, respond: () => ({ status: 204 }) },
    ])

    await renameSession('ses_1', 'Renamed')

    expect(fetchFake.lastRequest('PATCH', `${sessionUrl}/ses_1`)?.body).toEqual({ title: 'Renamed' })
  })

  it.each([
    { title: 'forks a session before a message', before: 'msg_1', expectedBody: { before: 'msg_1' } },
    { title: 'forks a session without a boundary when none is given', before: undefined, expectedBody: {} },
  ])('$title', async ({ before, expectedBody }) => {
    const fetchFake = installRoutes([
      respondTo('POST', `${sessionUrl}/ses_1/fork`, { data: sessionInfo('ses_child', '/repo') }),
    ])

    const forked = await forkSession('ses_1', before)

    expect(fetchFake.lastRequest('POST', `${sessionUrl}/ses_1/fork`)?.body).toEqual(expectedBody)
    expect(forked.id).toBe('ses_child')
  })

  it('adds context to a session without resuming the model', async () => {
    const fetchFake = installRoutes([
      respondTo('POST', `${sessionUrl}/ses_1/synthetic`, { data: { id: 'inb_1' } }),
    ])

    await expect(addSessionContext('ses_1', 'Run output')).resolves.toBeUndefined()

    expect(fetchFake.lastRequest('POST', `${sessionUrl}/ses_1/synthetic`)?.body).toEqual({
      text: 'Run output',
      resume: false,
    })
  })

  it('creates a session in a directory and seeds it with context', async () => {
    const fetchFake = installRoutes([
      respondTo('POST', sessionUrl, { data: sessionInfo('ses_new', '/abs/repos/my-repo') }),
      respondTo('POST', `${sessionUrl}/ses_new/synthetic`, { data: { id: 'inb_1' } }),
    ])

    const session = await createSessionWithContext(
      { directory: '/abs/repos/my-repo', title: 'Run (continued)' },
      'Run output',
    )

    expect(session.id).toBe('ses_new')
    expect(fetchFake.requests.map((request) => request.body)).toEqual([
      { title: 'Run (continued)', location: { directory: '/abs/repos/my-repo' } },
      { text: 'Run output', resume: false },
    ])
  })

  it('deletes the new session when seeding its context fails', async () => {
    const fetchFake = installRoutes([
      respondTo('POST', sessionUrl, { data: sessionInfo('ses_new', '/abs/repos/my-repo') }),
      { method: 'POST', path: `${sessionUrl}/ses_new/synthetic`, respond: () => ({ status: 400, text: 'nope' }) },
      { method: 'DELETE', path: `${sessionUrl}/ses_new`, respond: () => ({ status: 204 }) },
    ])

    await expect(createSessionWithContext({ directory: '/abs/repos/my-repo' }, 'Run output')).rejects.toBeInstanceOf(
      FetchError,
    )
    expect(fetchFake.findRequests('DELETE', `${sessionUrl}/ses_new`)).toHaveLength(1)
  })

  it('creates a session in a directory and sends a prompt', async () => {
    const fetchFake = installRoutes([
      respondTo('POST', sessionUrl, { data: sessionInfo('ses_new', '/abs/repos/my-repo') }),
      respondTo('POST', `${sessionUrl}/ses_new/prompt`, {
        data: { id: 'msg_1', sessionID: 'ses_new', time: { created: 1000 }, type: 'user', payload: { text: 'Fix conflicts' } },
      }),
    ])

    const session = await createSessionWithPrompt(
      { directory: '/abs/repos/my-repo', title: 'Resolve merge conflicts' },
      'Fix conflicts',
    )

    expect(session.id).toBe('ses_new')
    expect(fetchFake.lastRequest('POST', `${sessionUrl}/ses_new/prompt`)?.body).toEqual({
      text: 'Fix conflicts',
      metadata: { ocmClient: 'desktop' },
    })
  })

  it('deletes the new session when sending the prompt fails', async () => {
    const fetchFake = installRoutes([
      respondTo('POST', sessionUrl, { data: sessionInfo('ses_new', '/abs/repos/my-repo') }),
      { method: 'POST', path: `${sessionUrl}/ses_new/prompt`, respond: () => ({ status: 400, text: 'nope' }) },
      { method: 'DELETE', path: `${sessionUrl}/ses_new`, respond: () => ({ status: 204 }) },
    ])

    await expect(createSessionWithPrompt({ directory: '/abs/repos/my-repo' }, 'Fix conflicts')).rejects.toBeInstanceOf(
      FetchError,
    )
    expect(fetchFake.findRequests('DELETE', `${sessionUrl}/ses_new`)).toHaveLength(1)
  })

  it.each([
    {
      title: 'finds files through the V2 filesystem route and returns paths',
      input: { location: { directory: '/repo' }, query: 'index', limit: 20 },
      expectedQuery: 'location%5Bdirectory%5D=%2Frepo&query=index&type=file&limit=20',
    },
    {
      title: 'finds files without a limit when none is given',
      input: { location: { directory: '/repo' }, query: 'index' },
      expectedQuery: 'location%5Bdirectory%5D=%2Frepo&query=index&type=file',
    },
  ])('$title', async ({ input, expectedQuery }) => {
    const fetchFake = installRoutes([respondTo('GET', '/api/opencode/api/fs/find', { location: { directory: '/repo' }, data: [{ path: 'src/index.ts', type: 'file' }] })])

    const files = await findFiles(input)

    expect(fetchFake.lastRequest('GET', '/api/opencode/api/fs/find')?.searchParams.toString()).toBe(expectedQuery)
    expect(files).toEqual(['src/index.ts'])
  })

  it('reads a session snapshot from the message page, inbox, and active sessions', async () => {
    const message = { id: 'msg_1', type: 'user', text: 'Run the tests', time: { created: 1000 } }
    const inbox = {
      id: 'msg_2',
      sessionID: 'ses_1',
      time: { created: 2000 },
      type: 'user',
      payload: { text: 'Wait for me' },
      delivery: 'queue',
    }
    const fetchFake = installRoutes([
      respondTo('GET', `${sessionUrl}/ses_1/message`, { data: [message], cursor: { next: 'cursor_next' } }),
      respondTo('GET', `${sessionUrl}/ses_1/inbox`, { data: [inbox] }),
      respondTo('GET', `${sessionUrl}/active`, { data: { ses_1: { type: 'running' } } }),
    ])

    const snapshot = await readSessionSnapshot('ses_1')

    expect(snapshot).toEqual({
      messages: [message],
      nextCursor: 'cursor_next',
      pending: [inbox],
      status: 'busy',
    })
    expect(fetchFake.requests.map((request) => request.url).sort()).toEqual([
      'http://localhost/api/opencode/api/session/active',
      'http://localhost/api/opencode/api/session/ses_1/inbox',
      'http://localhost/api/opencode/api/session/ses_1/message?order=desc',
    ])
  })

  it('requests the newest message page with descending order', async () => {
    const fetchFake = installRoutes([
      respondTo('GET', `${sessionUrl}/ses_1/message`, { data: [{ id: 'msg_3' }, { id: 'msg_2' }], cursor: { next: 'cursor_2' } }),
    ])

    const page = await listSessionMessages('ses_1', { limit: 20 })

    expect(fetchFake.lastRequest('GET', `${sessionUrl}/ses_1/message`)?.searchParams.toString()).toBe(
      'limit=20&order=desc',
    )
    expect(page.messages.map((entry) => entry.id)).toEqual(['msg_2', 'msg_3'])
    expect(page.nextCursor).toBe('cursor_2')
  })

  it('omits order on continuation pages so the server accepts the cursor', async () => {
    const fetchFake = installRoutes([
      respondTo('GET', `${sessionUrl}/ses_1/message`, { data: [{ id: 'msg_2' }, { id: 'msg_1' }], cursor: { next: 'cursor_2' } }),
    ])

    const page = await listSessionMessages('ses_1', { cursor: 'cursor_1' })

    expect(fetchFake.lastRequest('GET', `${sessionUrl}/ses_1/message`)?.searchParams.toString()).toBe('cursor=cursor_1')
    expect(page.messages.map((entry) => entry.id)).toEqual(['msg_1', 'msg_2'])
    expect(page.nextCursor).toBe('cursor_2')
  })

  it('wraps V2 client failures in a FetchError', async () => {
    installRoutes([
      { method: 'GET', path: `${sessionUrl}/ses_1`, respond: () => ({ status: 500, text: 'upstream exploded' }) },
    ])

    const failure = getSession('ses_1')

    await expect(failure).rejects.toBeInstanceOf(FetchError)
    await expect(failure).rejects.toMatchObject({ statusCode: 500 })
  })

  it('maps a declared V2 not-found error to 404 instead of a network failure', async () => {
    installRoutes([
      {
        method: 'GET',
        path: `${sessionUrl}/ses_1`,
        respond: () => ({
          status: 404,
          json: { _tag: 'SessionNotFoundError', sessionID: 'ses_1', message: 'Session not found' },
        }),
      },
    ])

    const failure = getSession('ses_1')

    await expect(failure).rejects.toBeInstanceOf(FetchError)
    await expect(failure).rejects.toMatchObject({ statusCode: 404, message: 'Session not found' })
  })

  it('preserves the declared error tag as FetchError.code', async () => {
    installRoutes([
      {
        method: 'POST',
        path: `${sessionUrl}/ses_1/permission/per_1/reply`,
        respond: () => ({
          status: 404,
          json: {
            _tag: 'PermissionNotFoundError',
            sessionID: 'ses_1',
            requestID: 'per_1',
            message: 'Permission request not found',
          },
        }),
      },
    ])

    const failure = replyPermission('ses_1', 'per_1', 'once')

    await expect(failure).rejects.toBeInstanceOf(FetchError)
    await expect(failure).rejects.toMatchObject({ statusCode: 404, code: 'PermissionNotFoundError' })
  })

  it('maps a declared V2 conflict error to 409', async () => {
    installRoutes([
      {
        method: 'POST',
        path: `${sessionUrl}/ses_1/prompt`,
        respond: () => ({ status: 409, json: { _tag: 'SessionBusyError', sessionID: 'ses_1', message: 'Session is busy' } }),
      },
    ])

    const failure = sendPrompt({ sessionID: 'ses_1', text: 'Hi' })

    await expect(failure).rejects.toBeInstanceOf(FetchError)
    await expect(failure).rejects.toMatchObject({ statusCode: 409 })
  })

  it('sends a prompt with files, agents, skills, and delivery', async () => {
    const fetchFake = installRoutes([
      respondTo('POST', `${sessionUrl}/ses_1/prompt`, {
        data: {
          id: 'msg_1',
          sessionID: 'ses_1',
          time: { created: 1000 },
          type: 'user',
          payload: { text: 'Hello @src/a.ts' },
          delivery: 'queue',
        },
      }),
    ])

    const inbox = await sendPrompt({
      sessionID: 'ses_1',
      text: 'Hello @src/a.ts',
      files: [{ uri: 'file:///repo/src/a.ts', name: 'a.ts', mention: { start: 6, end: 15, text: '@src/a.ts' } }],
      agents: [{ name: 'build', mention: { start: 6, end: 12, text: '@build' } }],
      skills: [{ id: 'review' }],
      delivery: 'queue',
    })

    expect(fetchFake.lastRequest('POST', `${sessionUrl}/ses_1/prompt`)?.body).toEqual({
      text: 'Hello @src/a.ts',
      files: [{ uri: 'file:///repo/src/a.ts', name: 'a.ts', mention: { start: 6, end: 15, text: '@src/a.ts' } }],
      agents: [{ name: 'build', mention: { start: 6, end: 12, text: '@build' } }],
      skills: [{ id: 'review' }],
      metadata: { ocmClient: 'desktop' },
      delivery: 'queue',
    })
    expect(inbox.id).toBe('msg_1')
  })

  it.each([
    { title: 'marks a prompt as mobile when the viewport is narrow', innerWidth: 375, client: 'mobile' },
    { title: 'marks a prompt as desktop when the viewport is wide', innerWidth: 1280, client: 'desktop' },
  ])('$title', async ({ innerWidth, client }) => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(innerWidth)
    const fetchFake = installRoutes([
      respondTo('POST', `${sessionUrl}/ses_1/prompt`, {
        data: { id: 'msg_1', sessionID: 'ses_1', time: { created: 1000 }, type: 'user', payload: { text: 'Hi' } },
      }),
    ])

    await sendPrompt({ sessionID: 'ses_1', text: 'Hi' })

    expect(fetchFake.lastRequest('POST', `${sessionUrl}/ses_1/prompt`)?.body).toEqual({
      text: 'Hi',
      metadata: { ocmClient: client },
    })
  })

  it('switches the session model through the V2 model route', async () => {
    const fetchFake = installRoutes([
      { method: 'POST', path: `${sessionUrl}/ses_1/model`, respond: () => ({ status: 204 }) },
    ])

    await switchSessionModel('ses_1', { providerID: 'anthropic', id: 'claude', variant: 'v1' })

    expect(fetchFake.lastRequest('POST', `${sessionUrl}/ses_1/model`)?.body).toEqual({
      model: { providerID: 'anthropic', id: 'claude', variant: 'v1' },
    })
  })

  it('switches the session agent through the V2 agent route', async () => {
    const fetchFake = installRoutes([
      { method: 'POST', path: `${sessionUrl}/ses_1/agent`, respond: () => ({ status: 204 }) },
    ])

    await switchSessionAgent('ses_1', 'build')

    expect(fetchFake.lastRequest('POST', `${sessionUrl}/ses_1/agent`)?.body).toEqual({ agent: 'build' })
  })

  it('runs a session command', async () => {
    const fetchFake = installRoutes([
      { method: 'POST', path: `${sessionUrl}/ses_1/command`, respond: () => ({ status: 204 }) },
    ])

    await runCommand({
      sessionID: 'ses_1',
      name: 'init',
      text: 'extra context',
      agents: [{ name: 'build' }],
    })

    expect(fetchFake.lastRequest('POST', `${sessionUrl}/ses_1/command`)?.body).toEqual({
      name: 'init',
      text: 'extra context',
      agents: [{ name: 'build' }],
    })
  })

  it('runs a session shell command', async () => {
    const fetchFake = installRoutes([
      { method: 'POST', path: `${sessionUrl}/ses_1/shell`, respond: () => ({ status: 204 }) },
    ])

    await runShell('ses_1', 'ls -la')

    expect(fetchFake.lastRequest('POST', `${sessionUrl}/ses_1/shell`)?.body).toEqual({ command: 'ls -la' })
  })

  it('interrupts a session', async () => {
    const fetchFake = installRoutes([
      respondTo('POST', `${sessionUrl}/ses_1/interrupt`, { data: { interrupted: true } }),
    ])

    await interruptSession('ses_1')

    expect(fetchFake.findRequests('POST', `${sessionUrl}/ses_1/interrupt`)).toHaveLength(1)
  })

  it('asks a side question through the session generate route with the shared instructions', async () => {
    const fetchFake = installRoutes([
      respondTo('POST', `${sessionUrl}/ses_1/generate`, { data: { text: '  answer \n' } }),
    ])

    const answer = await askSideQuestion('ses_1', 'why?')

    const body = fetchFake.lastRequest('POST', `${sessionUrl}/ses_1/generate`)?.body
    expect(body).toEqual({ prompt: `${SIDE_QUESTION_INSTRUCTIONS}\n\nwhy?` })
    expect(answer).toBe('answer')
  })

  it('stages, commits, and clears a session revert', async () => {
    const fetchFake = installRoutes([
      respondTo('POST', `${sessionUrl}/ses_1/interrupt`, { data: { interrupted: true } }),
      { method: 'POST', path: '/api/opencode/api/experimental/session/ses_1/wait', respond: () => ({ status: 204 }) },
      respondTo('POST', `${sessionUrl}/ses_1/revert/stage`, { data: { messageID: 'msg_1' } }),
      { method: 'POST', path: `${sessionUrl}/ses_1/revert/commit`, respond: () => ({ status: 204 }) },
      { method: 'DELETE', path: `${sessionUrl}/ses_1/revert`, respond: () => ({ status: 204 }) },
    ])

    await stageRevert('ses_1', 'msg_1')

    expect(fetchFake.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /api/opencode/api/session/ses_1/interrupt',
      'POST /api/opencode/api/experimental/session/ses_1/wait',
      'POST /api/opencode/api/session/ses_1/revert/stage',
    ])
    expect(fetchFake.lastRequest('POST', `${sessionUrl}/ses_1/revert/stage`)?.body).toEqual({ messageID: 'msg_1' })

    await commitRevert('ses_1')
    expect(fetchFake.findRequests('POST', `${sessionUrl}/ses_1/revert/commit`)).toHaveLength(1)

    await clearRevert('ses_1')
    expect(fetchFake.findRequests('DELETE', `${sessionUrl}/ses_1/revert`)).toHaveLength(1)
  })

  it('compacts a session', async () => {
    installRoutes([
      respondTo('POST', `${sessionUrl}/ses_1/compact`, {
        data: { id: 'cmp_1', sessionID: 'ses_1', time: { created: 1000 }, type: 'compaction', delivery: 'steer' },
      }),
    ])

    await expect(compactSession('ses_1')).resolves.toMatchObject({ id: 'cmp_1' })
  })

  it('activates a skill on the experimental session route', async () => {
    const fetchFake = installRoutes([
      {
        method: 'POST',
        path: '/api/opencode/api/experimental/session/ses_1/skill',
        respond: () => ({ status: 204 }),
      },
    ])

    await activateSkill('ses_1', 'review')

    expect(fetchFake.lastRequest('POST', '/api/opencode/api/experimental/session/ses_1/skill')?.body).toEqual({
      id: 'review',
    })
  })

  it('lists commands scoped to a directory', async () => {
    const fetchFake = installRoutes([
      respondTo('GET', '/api/opencode/api/command', { location: { directory: '/repo' }, data: [{ name: 'init', description: 'Init' }] }),
    ])

    const commands = await listCommands('/repo')

    expect(fetchFake.lastRequest('GET', '/api/opencode/api/command')?.searchParams.toString()).toBe(
      'location%5Bdirectory%5D=%2Frepo',
    )
    expect(commands).toEqual([{ name: 'init', description: 'Init' }])
  })

  it('lists pending permissions scoped to a directory', async () => {
    const permissions = [{ id: 'perm_1', sessionID: 'ses_1', action: 'shell', resources: ['ls'] }]
    const fetchFake = installRoutes([
      respondTo('GET', '/api/opencode/api/permission/request', { location: { directory: '/repo' }, data: permissions }),
    ])

    await expect(listPendingPermissions('/repo')).resolves.toEqual(permissions)
    expect(fetchFake.lastRequest('GET', '/api/opencode/api/permission/request')?.searchParams.toString()).toBe(
      'location%5Bdirectory%5D=%2Frepo',
    )
  })

  it.each([
    {
      title: 'replies to a permission with a decision and rejection message',
      decision: 'reject',
      message: 'not allowed',
      expectedBody: { decision: 'reject', message: 'not allowed' },
    },
    {
      title: 'replies to a permission without a message',
      decision: 'once',
      message: undefined,
      expectedBody: { decision: 'once' },
    },
  ] as const)('$title', async ({ decision, message, expectedBody }) => {
    const fetchFake = installRoutes([
      { method: 'POST', path: `${sessionUrl}/ses_1/permission/per_1/reply`, respond: () => ({ status: 204 }) },
    ])

    await replyPermission('ses_1', 'per_1', decision, message)

    expect(fetchFake.lastRequest('POST', `${sessionUrl}/ses_1/permission/per_1/reply`)?.body).toEqual(expectedBody)
  })

  it('lists pending forms scoped to a directory', async () => {
    const form = { id: 'form_1', sessionID: 'ses_1', title: 'Continue?', fields: [{ key: 'q0', type: 'string' }] }
    const fetchFake = installRoutes([
      respondTo('GET', '/api/opencode/api/form', { location: { directory: '/repo' }, data: [form] }),
    ])

    await expect(listPendingForms('/repo')).resolves.toEqual([form])
    expect(fetchFake.lastRequest('GET', '/api/opencode/api/form')?.searchParams.toString()).toBe(
      'location%5Bdirectory%5D=%2Frepo',
    )
  })

  it('replies to a form with an answer keyed by field', async () => {
    const fetchFake = installRoutes([
      { method: 'POST', path: `${sessionUrl}/ses_1/form/form_1/reply`, respond: () => ({ status: 204 }) },
    ])

    await replyForm('ses_1', 'form_1', { q0: 'Yes' })

    expect(fetchFake.lastRequest('POST', `${sessionUrl}/ses_1/form/form_1/reply`)?.body).toEqual({
      answer: { q0: 'Yes' },
    })
  })

  it('cancels a form', async () => {
    const fetchFake = installRoutes([
      { method: 'DELETE', path: `${sessionUrl}/ses_1/form/form_1`, respond: () => ({ status: 204 }) },
    ])

    await cancelForm('ses_1', 'form_1')

    expect(fetchFake.findRequests('DELETE', `${sessionUrl}/ses_1/form/form_1`)).toHaveLength(1)
  })
})

const project = (
  id: string,
  name: string | undefined,
  canonical: string,
  time: { created: number; updated: number; active?: number },
) => ({ id, name, canonical, time, sandboxes: [] })

const session = (id: string, directory: string, updated: number) => ({
  id,
  projectID: 'prj',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: updated - 1000, updated },
  location: { directory },
})

describe('project helpers', () => {
  it('orders projects by their update time, most recent first, without mutating the input', () => {
    const stale = project('p_stale', 'Stale', '/work/stale', { created: 1, updated: 100 })
    const recent = project('p_recent', 'Recent', '/work/recent', { created: 1, updated: 900 })
    const middle = project('p_middle', 'Middle', '/work/middle', { created: 1, updated: 700 })
    const projects = [stale, recent, middle]

    expect(sortProjectsByUpdatedAt(projects).map((entry) => entry.id)).toEqual([
      'p_recent',
      'p_middle',
      'p_stale',
    ])
    expect(projects.map((entry) => entry.id)).toEqual(['p_stale', 'p_recent', 'p_middle'])
  })

  it('labels a project with its newest session time and ignores the project activity time', () => {
    const projects = [project('p1', 'Alpha', '/work/alpha', { created: 1, updated: 10, active: 900 })]

    const [entry] = rankProjectsBySessionActivity(projects, [
      session('ses_old', '/work/alpha', 300),
      session('ses_new', '/work/alpha', 500),
    ])

    expect(entry.project.id).toBe('p1')
    expect(entry.activityAt).toBe(500)
  })

  it('credits a session in a nested directory to the project that owns it', () => {
    const projects = [project('p1', 'Alpha', '/work/alpha', { created: 1, updated: 10 })]

    const [entry] = rankProjectsBySessionActivity(projects, [
      session('ses_nested', '/work/alpha/packages/web', 400),
    ])

    expect(entry.activityAt).toBe(400)
  })

  it('orders session-backed projects first, then the rest by update time', () => {
    const projects = [
      project('p_idle', 'Idle', '/work/idle', { created: 1, updated: 950, active: 999 }),
      project('p_worked', 'Worked', '/work/worked', { created: 1, updated: 20, active: 999 }),
      project('p_quiet', 'Quiet', '/work/quiet', { created: 1, updated: 600 }),
    ]

    const ranked = rankProjectsBySessionActivity(projects, [session('ses_1', '/work/worked', 300)])

    expect(ranked.map((entry) => entry.project.id)).toEqual(['p_worked', 'p_idle', 'p_quiet'])
    expect(ranked.map((entry) => entry.activityAt)).toEqual([300, 950, 600])
  })

  it('ignores sessions that belong to no listed project', () => {
    const projects = [project('p1', 'Alpha', '/work/alpha', { created: 1, updated: 10 })]

    const [entry] = rankProjectsBySessionActivity(projects, [session('ses_1', '/srv/other', 900)])

    expect(entry.activityAt).toBe(10)
  })

  it('names a project from its trimmed title', () => {
    expect(remoteProjectName(project('p1', '  Alpha  ', '/work/alpha', { created: 1, updated: 2 }))).toBe('Alpha')
  })

  it('names a project from its directory when it has no title', () => {
    expect(remoteProjectName(project('p1', undefined, '/work/beta', { created: 1, updated: 2 }))).toBe('beta')
    expect(remoteProjectName(project('p1', '   ', '/work/gamma', { created: 1, updated: 2 }))).toBe('gamma')
  })

  it('finds the project that owns a directory or one nested inside it', () => {
    const projects = [
      project('p1', 'Alpha', '/work/alpha', { created: 1, updated: 2 }),
      project('p2', 'Beta', '/work/beta', { created: 1, updated: 2 }),
    ]

    expect(findRemoteProjectForDirectory(projects, '/work/beta')?.id).toBe('p2')
    expect(findRemoteProjectForDirectory(projects, '/work/beta/packages/web')?.id).toBe('p2')
  })

  it('picks the deepest project when one canonical directory contains another', () => {
    const projects = [
      project('p_parent', 'Repo', '/work/repo', { created: 1, updated: 2 }),
      project('p_child', 'App', '/work/repo/packages/app', { created: 1, updated: 3 }),
    ]

    expect(findRemoteProjectForDirectory(projects, '/work/repo')?.id).toBe('p_parent')
    expect(findRemoteProjectForDirectory(projects, '/work/repo/packages/app')?.id).toBe('p_child')
    expect(findRemoteProjectForDirectory(projects, '/work/repo/packages/app/src')?.id).toBe('p_child')
  })

  it('credits a session in a nested project to the deepest project', () => {
    const projects = [
      project('p_parent', 'Repo', '/work/repo', { created: 1, updated: 20 }),
      project('p_child', 'App', '/work/repo/packages/app', { created: 1, updated: 10 }),
    ]

    const ranked = rankProjectsBySessionActivity(projects, [
      session('ses_nested', '/work/repo/packages/app/src', 400),
    ])

    expect(ranked.find((entry) => entry.project.id === 'p_child')?.activityAt).toBe(400)
    expect(ranked.find((entry) => entry.project.id === 'p_parent')?.activityAt).toBe(20)
  })

  it('returns no project when no canonical directory contains the directory', () => {
    const projects = [project('p1', 'Alpha', '/work/alpha', { created: 1, updated: 2 })]

    expect(findRemoteProjectForDirectory(projects, '/srv/elsewhere')).toBeUndefined()
  })

  it('does not match a directory that only shares a prefix with a canonical directory', () => {
    const projects = [project('p1', 'Alpha', '/work/alpha', { created: 1, updated: 2 })]

    expect(findRemoteProjectForDirectory(projects, '/work/alphabet')).toBeUndefined()
  })
})
