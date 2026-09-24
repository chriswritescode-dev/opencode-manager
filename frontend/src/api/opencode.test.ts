import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activateSkill,
  cancelForm,
  clearRevert,
  commitRevert,
  compactSession,
  createSession,
  deleteSession,
  findFiles,
  forkSession,
  getSession,
  interruptSession,
  listCommands,
  listPendingForms,
  listPendingPermissions,
  listSessionMessages,
  listSessionPage,
  readSessionSnapshot,
  renameSession,
  replyForm,
  replyPermission,
  runCommand,
  runShell,
  sendPrompt,
  stageRevert,
  switchSessionAgent,
  switchSessionModel,
} from './opencode'
import { FetchError } from './fetchWrapper'

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const sessionInfo = (id: string, directory: string) => ({
  id,
  projectID: 'proj_1',
  title: `Session ${id}`,
  time: { created: 1000, updated: 2000 },
  location: { directory },
})

describe('OpenCode facade', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const lastRequest = () => {
    const [input, init] = fetchMock.mock.calls.at(-1) ?? []
    return { url: String(input), init: init as RequestInit }
  }

  it('lists root sessions for a directory through the V2 cursor API', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [sessionInfo('ses_1', '/repo')], cursor: { next: 'cursor_next' } }),
    )

    const page = await listSessionPage({
      directory: '/repo',
      limit: 25,
      order: 'desc',
      search: 'deploy',
    })

    expect(lastRequest().url).toBe(
      'http://localhost/api/opencode/api/session?limit=25&order=desc&search=deploy&parentID=null&directory=%2Frepo',
    )
    expect(lastRequest().init.method).toBe('GET')
    expect(page.items).toEqual([sessionInfo('ses_1', '/repo')])
    expect(page.nextCursor).toBe('cursor_next')
  })

  it('passes the directory and cursor for continuation pages', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [], cursor: {} }))

    const page = await listSessionPage({ directory: '/repo', cursor: 'cursor_1' })

    expect(lastRequest().url).toBe(
      'http://localhost/api/opencode/api/session?parentID=null&directory=%2Frepo&cursor=cursor_1',
    )
    expect(lastRequest().init.method).toBe('GET')
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeUndefined()
  })

  it('reads a single session from the V2 session route', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: sessionInfo('ses_1', '/repo') }))

    const session = await getSession('ses_1')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1')
    expect(lastRequest().init.method).toBe('GET')
    expect(session).toEqual(sessionInfo('ses_1', '/repo'))
  })

  it('creates a session with location and a parsed model reference', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: sessionInfo('ses_new', '/repo') }))

    const session = await createSession({
      directory: '/repo',
      title: 'New session',
      agent: 'build',
      model: 'anthropic/claude#v1',
    })

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session')
    expect(lastRequest().init.method).toBe('POST')
    expect(lastRequest().init.body).toBe(JSON.stringify({
      title: 'New session',
      agent: 'build',
      model: { providerID: 'anthropic', id: 'claude', variant: 'v1' },
      location: { directory: '/repo' },
    }))
    expect(session.id).toBe('ses_new')
  })

  it('creates a session without location when no directory is provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: sessionInfo('ses_new', '/repo') }))

    await createSession({ agent: 'build' })

    expect(lastRequest().init.method).toBe('POST')
    expect(lastRequest().init.body).toBe(JSON.stringify({ agent: 'build' }))
  })

  it('deletes a session through the V2 session route', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(deleteSession('ses_1')).resolves.toBeUndefined()

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1')
    expect(lastRequest().init.method).toBe('DELETE')
  })

  it('renames a session with a title update', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await renameSession('ses_1', 'Renamed')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1')
    expect(lastRequest().init.method).toBe('PATCH')
    expect(lastRequest().init.body).toBe(JSON.stringify({ title: 'Renamed' }))
  })

  it('forks a session before a message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: sessionInfo('ses_child', '/repo') }))

    const forked = await forkSession('ses_1', 'msg_1')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1/fork')
    expect(lastRequest().init.method).toBe('POST')
    expect(lastRequest().init.body).toBe(JSON.stringify({ before: 'msg_1' }))
    expect(forked.id).toBe('ses_child')
  })

  it('forks a session without a boundary when none is given', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: sessionInfo('ses_child', '/repo') }))

    await forkSession('ses_1')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1/fork')
    expect(lastRequest().init.body).toBe(JSON.stringify({}))
  })

  it('finds files through the V2 filesystem route and returns paths', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        location: { directory: '/repo' },
        data: [
          { path: 'src/index.ts', type: 'file' },
          { path: 'src/app.ts', type: 'file' },
        ],
      }),
    )

    const files = await findFiles({ directory: '/repo', query: 'index', limit: 20 })

    expect(lastRequest().url).toBe(
      'http://localhost/api/opencode/api/fs/find?location%5Bdirectory%5D=%2Frepo&query=index&type=file&limit=20',
    )
    expect(lastRequest().init.method).toBe('GET')
    expect(files).toEqual(['src/index.ts', 'src/app.ts'])
  })

  it('finds files without a limit when none is given', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ location: { directory: '/repo' }, data: [] }))

    await findFiles({ directory: '/repo', query: 'index' })

    expect(lastRequest().url).toBe(
      'http://localhost/api/opencode/api/fs/find?location%5Bdirectory%5D=%2Frepo&query=index&type=file',
    )
  })

  it('reads a session snapshot from the message page, inbox, and active sessions', async () => {
    const message = {
      id: 'msg_1',
      type: 'user' as const,
      text: 'Run the tests',
      time: { created: 1000 },
    }
    const inbox = {
      id: 'msg_2',
      sessionID: 'ses_1',
      time: { created: 2000 },
      type: 'user' as const,
      payload: { text: 'Wait for me' },
      delivery: 'queue' as const,
    }
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input)
      if (url.endsWith('/api/session/ses_1/inbox')) {
        return Promise.resolve(jsonResponse({ data: [inbox] }))
      }
      if (url.endsWith('/api/session/active')) {
        return Promise.resolve(jsonResponse({ data: { ses_1: { type: 'running' } } }))
      }
      return Promise.resolve(jsonResponse({ data: [message], cursor: { next: 'cursor_next' } }))
    })

    const snapshot = await readSessionSnapshot('ses_1')

    expect(snapshot).toEqual({
      messages: [message],
      nextCursor: 'cursor_next',
      pending: [inbox],
      status: 'busy',
    })
    expect(fetchMock.mock.calls.map(([input]) => String(input)).sort()).toEqual([
      'http://localhost/api/opencode/api/session/active',
      'http://localhost/api/opencode/api/session/ses_1/inbox',
      'http://localhost/api/opencode/api/session/ses_1/message?order=desc',
    ])
  })

  it('requests the newest message page with descending order', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [{ id: 'msg_3' }, { id: 'msg_2' }], cursor: { next: 'cursor_2' } }),
    )

    const page = await listSessionMessages('ses_1', { limit: 20 })

    expect(lastRequest().url).toBe(
      'http://localhost/api/opencode/api/session/ses_1/message?limit=20&order=desc',
    )
    expect(page.messages.map((message) => message.id)).toEqual(['msg_2', 'msg_3'])
    expect(page.nextCursor).toBe('cursor_2')
  })

  it('omits order on continuation pages so the server accepts the cursor', async () => {
    const server = vi.fn((input: unknown) => {
      const url = String(input)
      if (url.includes('cursor=') && url.includes('order=')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ _tag: 'InvalidCursorError', message: 'Cursor cannot be combined with order' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return Promise.resolve(
        jsonResponse({ data: [{ id: 'msg_2' }, { id: 'msg_1' }], cursor: { next: 'cursor_2' } }),
      )
    })
    fetchMock.mockImplementation(server)

    const page = await listSessionMessages('ses_1', { cursor: 'cursor_1' })

    expect(lastRequest().url).toBe(
      'http://localhost/api/opencode/api/session/ses_1/message?cursor=cursor_1',
    )
    expect(page.messages.map((message) => message.id)).toEqual(['msg_1', 'msg_2'])
    expect(page.nextCursor).toBe('cursor_2')
  })

  it('wraps V2 client failures in a FetchError', async () => {    fetchMock.mockResolvedValue(new Response('upstream exploded', { status: 500 }))

    const failure = await getSession('ses_1').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(FetchError)
    expect((failure as FetchError).statusCode).toBe(500)
  })

  it('maps a declared V2 not-found error to 404 instead of a network failure', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ _tag: 'SessionNotFoundError', sessionID: 'ses_1', message: 'Session not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const failure = await getSession('ses_1').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(FetchError)
    expect((failure as FetchError).statusCode).toBe(404)
    expect((failure as FetchError).message).toBe('Session not found')
  })

  it('maps a declared V2 conflict error to 409', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ _tag: 'SessionBusyError', sessionID: 'ses_1', message: 'Session is busy' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const failure = await sendPrompt({ sessionID: 'ses_1', text: 'Hi' }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(FetchError)
    expect((failure as FetchError).statusCode).toBe(409)
  })

  it('sends a prompt with files, agents, skills, and delivery', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          id: 'msg_1',
          sessionID: 'ses_1',
          time: { created: 1000 },
          type: 'user',
          payload: { text: 'Hello @src/a.ts' },
          delivery: 'queue',
        },
      }),
    )

    const inbox = await sendPrompt({
      sessionID: 'ses_1',
      text: 'Hello @src/a.ts',
      files: [{ uri: 'file:///repo/src/a.ts', name: 'a.ts', mention: { start: 6, end: 15, text: '@src/a.ts' } }],
      agents: [{ name: 'build', mention: { start: 6, end: 12, text: '@build' } }],
      skills: [{ id: 'review' }],
      delivery: 'queue',
    })

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1/prompt')
    expect(lastRequest().init.method).toBe('POST')
    expect(lastRequest().init.body).toBe(JSON.stringify({
      text: 'Hello @src/a.ts',
      files: [{ uri: 'file:///repo/src/a.ts', name: 'a.ts', mention: { start: 6, end: 15, text: '@src/a.ts' } }],
      agents: [{ name: 'build', mention: { start: 6, end: 12, text: '@build' } }],
      skills: [{ id: 'review' }],
      delivery: 'queue',
    }))
    expect(inbox.id).toBe('msg_1')
  })

  it('switches the session model through the V2 model route', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await switchSessionModel('ses_1', { providerID: 'anthropic', id: 'claude', variant: 'v1' })

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1/model')
    expect(lastRequest().init.method).toBe('POST')
    expect(lastRequest().init.body).toBe(JSON.stringify({ model: { providerID: 'anthropic', id: 'claude', variant: 'v1' } }))
  })

  it('switches the session agent through the V2 agent route', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await switchSessionAgent('ses_1', 'build')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1/agent')
    expect(lastRequest().init.method).toBe('POST')
    expect(lastRequest().init.body).toBe(JSON.stringify({ agent: 'build' }))
  })

  it('runs a session command', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await runCommand({
      sessionID: 'ses_1',
      name: 'init',
      text: 'extra context',
      agents: [{ name: 'build' }],
    })

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1/command')
    expect(lastRequest().init.method).toBe('POST')
    expect(lastRequest().init.body).toBe(JSON.stringify({
      name: 'init',
      text: 'extra context',
      agents: [{ name: 'build' }],
    }))
  })

  it('runs a session shell command', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await runShell('ses_1', 'ls -la')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1/shell')
    expect(lastRequest().init.method).toBe('POST')
    expect(lastRequest().init.body).toBe(JSON.stringify({ command: 'ls -la' }))
  })

  it('interrupts a session', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { interrupted: true } }))

    await interruptSession('ses_1')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1/interrupt')
    expect(lastRequest().init.method).toBe('POST')
  })

  it('stages, commits, and clears a session revert', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { messageID: 'msg_1' } }))

    await stageRevert('ses_1', 'msg_1')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1/revert/stage')
    expect(lastRequest().init.method).toBe('POST')
    expect(lastRequest().init.body).toBe(JSON.stringify({ messageID: 'msg_1' }))

    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await commitRevert('ses_1')
    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1/revert/commit')
    expect(lastRequest().init.method).toBe('POST')

    await clearRevert('ses_1')
    expect(lastRequest().url).toMatch(/\/revert$/)
    expect(lastRequest().init.method).toBe('DELETE')
  })

  it('compacts a session', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { id: 'cmp_1', sessionID: 'ses_1', time: { created: 1000 }, type: 'compaction', delivery: 'steer' } }),
    )

    const compaction = await compactSession('ses_1')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1/compact')
    expect(lastRequest().init.method).toBe('POST')
    expect(compaction.id).toBe('cmp_1')
  })

  it('activates a skill on the experimental session route', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await activateSkill('ses_1', 'review')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/experimental/session/ses_1/skill')
    expect(lastRequest().init.method).toBe('POST')
    expect(lastRequest().init.body).toBe(JSON.stringify({ id: 'review' }))
  })

  it('lists commands scoped to a directory', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ location: { directory: '/repo' }, data: [{ name: 'init', description: 'Init' }] }),
    )

    const commands = await listCommands('/repo')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/command?location%5Bdirectory%5D=%2Frepo')
    expect(lastRequest().init.method).toBe('GET')
    expect(commands).toEqual([{ name: 'init', description: 'Init' }])
  })

  it('lists pending permissions scoped to a directory', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        location: { directory: '/repo' },
        data: [{ id: 'perm_1', sessionID: 'ses_1', action: 'shell', resources: ['ls'] }],
      }),
    )

    const permissions = await listPendingPermissions('/repo')

    expect(lastRequest().url).toBe(
      'http://localhost/api/opencode/api/permission/request?location%5Bdirectory%5D=%2Frepo',
    )
    expect(lastRequest().init.method).toBe('GET')
    expect(permissions).toEqual([{ id: 'perm_1', sessionID: 'ses_1', action: 'shell', resources: ['ls'] }])
  })

  it('replies to a permission with a decision and rejection message', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await replyPermission('ses_1', 'perm_1', 'reject', 'not allowed')

    expect(lastRequest().url).toBe(
      'http://localhost/api/opencode/api/session/ses_1/permission/perm_1/reply',
    )
    expect(lastRequest().init.method).toBe('POST')
    expect(lastRequest().init.body).toBe(JSON.stringify({ decision: 'reject', message: 'not allowed' }))
  })

  it('replies to a permission without a message', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await replyPermission('ses_1', 'perm_1', 'once')

    expect(lastRequest().init.body).toBe(JSON.stringify({ decision: 'once' }))
  })

  it('lists pending forms scoped to a directory', async () => {
    const form = {
      id: 'form_1',
      sessionID: 'ses_1',
      title: 'Continue?',
      fields: [{ key: 'q0', type: 'string' }],
    }
    fetchMock.mockResolvedValue(jsonResponse({ location: { directory: '/repo' }, data: [form] }))

    const forms = await listPendingForms('/repo')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/form?location%5Bdirectory%5D=%2Frepo')
    expect(lastRequest().init.method).toBe('GET')
    expect(forms).toEqual([form])
  })

  it('replies to a form with an answer keyed by field', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await replyForm('ses_1', 'form_1', { q0: 'Yes' })

    expect(lastRequest().url).toBe(
      'http://localhost/api/opencode/api/session/ses_1/form/form_1/reply',
    )
    expect(lastRequest().init.method).toBe('POST')
    expect(lastRequest().init.body).toBe(JSON.stringify({ answer: { q0: 'Yes' } }))
  })

  it('cancels a form', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await cancelForm('ses_1', 'form_1')

    expect(lastRequest().url).toBe('http://localhost/api/opencode/api/session/ses_1/form/form_1')
    expect(lastRequest().init.method).toBe('DELETE')
  })
})
