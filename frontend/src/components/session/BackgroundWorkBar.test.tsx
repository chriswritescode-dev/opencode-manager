import { describe, it, expect } from 'vitest'
import { act, screen, fireEvent, waitFor } from '@testing-library/react'
import type { SessionMessageAssistant, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import type { JsonObject } from '@opencode-manager/shared/utils'
import type { ShellInfo } from '@/api/opencode'
import { clearShellExitRecord, recordShellExit } from '@/lib/backgroundWork'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { BackgroundWorkBar } from './BackgroundWorkBar'
import { renderWithProviders } from '@/test/render'
import { makeSession } from '@/test/fixtures/api'
import type { FetchRouteResult, RecordedFetchRequest } from '@/test/fetchFake'

const SHELLS_PATH = '/api/opencode/api/shell'

const shell = (id: string, sessionID = 'session-1', status: ShellInfo['status'] = 'running'): ShellInfo => ({
  id,
  status,
  command: `npm run ${id}`,
  cwd: '/repo',
  shell: 'zsh',
  file: `/tmp/${id}.log`,
  metadata: { sessionID },
  time: { started: 1 },
})

const runningShellTool = (): SessionMessageAssistant => ({
  id: 'msg-1',
  type: 'assistant',
  agent: 'build',
  model: { providerID: 'p', id: 'm' },
  content: [
    {
      type: 'tool',
      id: 'tool-1',
      name: 'shell',
      state: { status: 'running', input: { command: 'npm test' }, metadata: {} },
      time: { created: 1 },
    },
  ],
  time: { created: 1 },
})

const backgroundShellTool = (shellID: string, command = 'npm run dev'): SessionMessageAssistant => ({
  id: 'msg-shell',
  type: 'assistant',
  agent: 'build',
  model: { providerID: 'p', id: 'm' },
  content: [
    {
      type: 'tool',
      id: 'tool-shell',
      name: 'shell',
      state: {
        status: 'completed',
        input: { command },
        content: [{ type: 'text', text: 'started in the background' }],
        metadata: { status: 'running', shellID },
      },
      time: { created: 1, completed: 2 },
    },
  ],
  time: { created: 1 },
})

const shellNotice = (
  shellID: string,
  state: 'completed' | 'error',
  exit?: number,
): SessionMessageInfo => {
  const metadata: JsonObject = { source: 'shell', shellID, state }
  if (exit !== undefined) metadata.exit = exit
  return {
    id: `notice-${shellID}`,
    type: 'synthetic',
    text: '',
    metadata,
    time: { created: 3 },
  }
}

const backgroundSubagentTool = (childSessionID: string, description = 'Explore'): SessionMessageAssistant => ({
  id: 'msg-sub',
  type: 'assistant',
  agent: 'build',
  model: { providerID: 'p', id: 'm' },
  content: [
    {
      type: 'tool',
      id: 'tool-sub',
      name: 'subagent',
      state: {
        status: 'completed',
        input: { description },
        content: [{ type: 'text', text: 'started in the background' }],
        metadata: { status: 'running', sessionID: childSessionID },
      },
      time: { created: 1, completed: 2 },
    },
  ],
  time: { created: 1 },
})

interface BackgroundWorkBarFixture {
  shells?: ShellInfo[]
  listLoader?: () => Promise<FetchRouteResult> | FetchRouteResult
  outputLoader?: (request: RecordedFetchRequest) => Promise<FetchRouteResult> | FetchRouteResult
  sessionLoader?: () => Promise<FetchRouteResult> | FetchRouteResult
}

function renderBar(
  messages: SessionMessageInfo[],
  isSessionActive: boolean,
  fixture: BackgroundWorkBarFixture = {},
) {
  const onChildSessionClick = () => {}
  const shellList = fixture.listLoader ?? (() => ({ json: { data: fixture.shells ?? [] } }))
  const sessionLoader = fixture.sessionLoader ?? (() => new Promise<FetchRouteResult>(() => {}))
  const outputLoader = fixture.outputLoader ?? (() => ({ json: { data: { output: '', cursor: 0, size: 0, truncated: false } } }))

  return renderWithProviders(
    <BackgroundWorkBar
      sessionID="session-1"
      directory="/repo"
      messages={messages}
      isSessionActive={isSessionActive}
      onChildSessionClick={onChildSessionClick}
    />,
    {
      auth: false,
      theme: false,
      toaster: false,
      fetchRoutes: [
        { method: 'GET', path: SHELLS_PATH, respond: () => shellList() },
        { method: 'GET', path: `${SHELLS_PATH}/:id/output`, respond: (request) => outputLoader(request) },
        { method: 'DELETE', path: `${SHELLS_PATH}/:id`, respond: () => ({ status: 204 }) },
        { method: 'POST', path: '/api/opencode/api/session/:sessionID/background', respond: () => ({ status: 204 }) },
        { method: 'GET', path: '/api/opencode/api/session/:sessionID', respond: () => sessionLoader() },
      ],
    },
  )
}

function resetSessionStatus() {
  useSessionStatus.setState({
    statuses: new Map(),
    statusCache: new Map(),
    statusRevisions: new Map(),
    knownSessions: new Set(),
    outcomes: new Map(),
    revision: 0,
  })
}

describe('BackgroundWorkBar', () => {
  it('renders nothing when there is no running or background work', async () => {
    resetSessionStatus()
    const result = renderBar([], false)

    await waitFor(() => expect(result.fetchFake.lastRequest('GET', SHELLS_PATH)).toBeDefined())
    expect(result.container).toBeEmptyDOMElement()
  })

  it('moves running shell work to the background', async () => {
    resetSessionStatus()
    const result = renderBar([runningShellTool()], true)

    fireEvent.click(await screen.findByRole('button', { name: /Move to background/ }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('POST', '/api/opencode/api/session/:sessionID/background')?.path).toBe(
        '/api/opencode/api/session/session-1/background',
      ),
    )
  })

  it('hides the background action once the session is idle', async () => {
    resetSessionStatus()
    const result = renderBar([runningShellTool()], false)

    await waitFor(() => expect(result.fetchFake.lastRequest('GET', SHELLS_PATH)).toBeDefined())
    expect(screen.queryByRole('button', { name: /Move to background/ })).not.toBeInTheDocument()
  })

  it('hides completed shells and removes a killed shell', async () => {
    resetSessionStatus()
    const result = renderBar([], false, {
      shells: [shell('dev'), shell('other', 'session-2'), shell('done', 'session-1', 'exited')],
    })

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))

    expect(screen.getByText('npm run dev')).toBeInTheDocument()
    expect(screen.queryByText('npm run done')).not.toBeInTheDocument()
    expect(screen.queryByText('npm run other')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Kill npm run dev' }))

    await waitFor(() => expect(result.fetchFake.lastRequest('DELETE', `${SHELLS_PATH}/:id`)?.path).toBe(`${SHELLS_PATH}/dev`))
    await waitFor(() => expect(result.container).toBeEmptyDOMElement())
    clearShellExitRecord('/repo', 'dev')
  })

  it('removes a shell row once it completes', async () => {
    resetSessionStatus()
    const result = renderBar([], false, { shells: [shell('dev')] })

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))
    expect(screen.getByText('running')).toBeInTheDocument()

    act(() => {
      result.queryClient.setQueryData(['opencode', 'shells', '/repo'], [
        { ...shell('dev', 'session-1', 'exited'), exit: 0, time: { started: 1, completed: 2 } },
      ])
    })

    await waitFor(() => expect(screen.queryByText('npm run dev')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /background task/ })).not.toBeInTheDocument()
  })

  it('preserves a shell created while a stale list fetch was in flight', async () => {
    resetSessionStatus()
    let resolveList: ((value: FetchRouteResult) => void) | undefined
    const result = renderBar([], false, {
      listLoader: () => new Promise<FetchRouteResult>((resolve) => { resolveList = resolve }),
    })
    await waitFor(() => expect(result.fetchFake.lastRequest('GET', SHELLS_PATH)).toBeDefined())

    act(() => {
      result.queryClient.setQueryData(['opencode', 'shells', '/repo'], [
        { ...shell('dev'), time: { started: Date.now() + 60_000 } },
      ])
    })

    await act(async () => {
      resolveList?.({ json: { data: [] } })
    })

    expect(await screen.findByRole('button', { name: /1 background task$/ })).toBeInTheDocument()
    expect(screen.queryByText('unavailable')).not.toBeInTheDocument()
  })

  it('hides a running shell omitted from a fresh list once it becomes unavailable', async () => {
    resetSessionStatus()
    const result = renderBar([], false)
    await waitFor(() => expect(result.fetchFake.lastRequest('GET', SHELLS_PATH)).toBeDefined())

    await act(async () => {
      result.queryClient.setQueryData(['opencode', 'shells', '/repo'], [shell('dev')])
      await result.queryClient.invalidateQueries({ queryKey: ['opencode', 'shells', '/repo'] })
    })

    await waitFor(() => expect(result.container).toBeEmptyDOMElement())
  })

  it('does not resurrect a completed shell from a stale list fetch', async () => {
    resetSessionStatus()
    const result = renderBar([], false, { shells: [shell('dev')] })

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))
    expect(screen.getByText('running')).toBeInTheDocument()

    result.queryClient.setQueryData(['opencode', 'shells', '/repo'], [
      { ...shell('dev', 'session-1', 'exited'), exit: 0, time: { started: 1, completed: 2 } },
    ])

    await act(async () => {
      await result.queryClient.invalidateQueries({ queryKey: ['opencode', 'shells', '/repo'] })
    })

    await waitFor(() => expect(screen.queryByText('npm run dev')).not.toBeInTheDocument())
    expect(screen.queryByText('running')).not.toBeInTheDocument()
  })

  it('shows a backgrounded subagent and removes it when the child goes idle', async () => {
    resetSessionStatus()
    renderBar([backgroundSubagentTool('child-1')], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))
    expect(screen.getByText('Explore')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()

    act(() => {
      useSessionStatus.getState().setStatus('child-1', { type: 'busy' })
    })
    expect(screen.getByText('running')).toBeInTheDocument()

    act(() => {
      useSessionStatus.getState().setStatus('child-1', { type: 'idle' })
    })

    await waitFor(() => expect(screen.queryByText('Explore')).not.toBeInTheDocument())
  })

  it('treats an unknown child session as still running', async () => {
    resetSessionStatus()
    renderBar([backgroundSubagentTool('child-unknown')], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))

    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.queryByText('completed')).not.toBeInTheDocument()
  })

  it('reconciles a child session that finished before it was observed', async () => {
    resetSessionStatus()
    const result = renderBar([backgroundSubagentTool('child-1')], false, {
      sessionLoader: () => ({
        json: { data: makeSession({ id: 'child-1', outcome: 'succeeded', time: { created: 1, updated: 2, idle: 2 } }) },
      }),
    })

    await waitFor(() => expect(result.fetchFake.lastRequest('GET', '/api/opencode/api/session/:sessionID')).toBeDefined())
    await waitFor(() => expect(result.container).toBeEmptyDOMElement())
  })

  it('hides a failed child session outcome', async () => {
    resetSessionStatus()
    act(() => {
      useSessionStatus.getState().setOutcome('child-1', 'failed')
      useSessionStatus.getState().setStatus('child-1', { type: 'idle' })
    })
    const result = renderBar([backgroundSubagentTool('child-1')], false)

    await waitFor(() => expect(result.container).toBeEmptyDOMElement())
  })

  it('hides an interrupted child session outcome', async () => {
    resetSessionStatus()
    act(() => {
      useSessionStatus.getState().setOutcome('child-1', 'interrupted')
      useSessionStatus.getState().setStatus('child-1', { type: 'idle' })
    })
    const result = renderBar([backgroundSubagentTool('child-1')], false)

    await waitFor(() => expect(result.container).toBeEmptyDOMElement())
  })

  it('hides a deleted shell once it becomes unavailable', async () => {
    resetSessionStatus()
    const result = renderBar([], false, { shells: [shell('dev')] })

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))

    act(() => {
      result.queryClient.setQueryData(['opencode', 'shells', '/repo'], [
        { ...shell('dev'), status: 'unavailable', time: { started: 1, completed: 2 } },
      ])
    })

    await waitFor(() => expect(result.container).toBeEmptyDOMElement())
  })

  it('hides a historical shell absent from the fetched list', async () => {
    resetSessionStatus()
    const result = renderBar([backgroundShellTool('sh-history', 'npm run history')], false)

    await waitFor(() => expect(result.fetchFake.lastRequest('GET', SHELLS_PATH)).toBeDefined())
    await waitFor(() => expect(result.container).toBeEmptyDOMElement())
  })

  it('hides a historical shell absent from the list once its notice reports completion', async () => {
    resetSessionStatus()
    const result = renderBar(
      [backgroundShellTool('sh-notice', 'npm run notice'), shellNotice('sh-notice', 'completed', 0)],
      false,
    )

    await waitFor(() => expect(result.fetchFake.lastRequest('GET', SHELLS_PATH)).toBeDefined())
    await waitFor(() => expect(result.container).toBeEmptyDOMElement())
  })

  it('hides a historical shell absent from the list once its error notice reports failure', async () => {
    resetSessionStatus()
    const result = renderBar(
      [backgroundShellTool('sh-notice', 'npm run notice'), shellNotice('sh-notice', 'error')],
      false,
    )

    await waitFor(() => expect(result.fetchFake.lastRequest('GET', SHELLS_PATH)).toBeDefined())
    await waitFor(() => expect(result.container).toBeEmptyDOMElement())
  })

  it('keeps a historical shell unknown while its list is still loading', async () => {
    resetSessionStatus()
    renderBar([backgroundShellTool('sh-history', 'npm run history')], false, {
      listLoader: () => new Promise<FetchRouteResult>(() => {}),
    })

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))

    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.queryByText('unavailable')).not.toBeInTheDocument()
  })

  it('uses an already cached shell list when the bar remounts', async () => {
    resetSessionStatus()
    const messages = [backgroundShellTool('sh-history', 'npm run history')]
    const result = renderBar(messages, false)
    await waitFor(() => expect(result.container).toBeEmptyDOMElement())
    result.unmount()

    const remount = renderWithProviders(
      <BackgroundWorkBar sessionID="session-1" directory="/repo" messages={messages} isSessionActive={false} />,
      { auth: false, theme: false, toaster: false, queryClient: result.queryClient },
    )
    await waitFor(() => expect(remount.container).toBeEmptyDOMElement())
    expect(result.fetchFake.findRequests('GET', SHELLS_PATH)).toHaveLength(1)
  })

  it('does not overwrite a newer live child status with a stale child query', async () => {
    resetSessionStatus()
    let resolveSession: ((value: FetchRouteResult) => void) | undefined
    const result = renderBar([backgroundSubagentTool('child-1')], false, {
      sessionLoader: () => new Promise<FetchRouteResult>((resolve) => { resolveSession = resolve }),
    })

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))

    act(() => {
      useSessionStatus.getState().setStatus('child-1', { type: 'idle' })
    })
    expect(screen.queryByText('Explore')).not.toBeInTheDocument()

    await act(async () => {
      resolveSession?.({ json: { data: makeSession({ id: 'child-1', time: { created: 1, updated: 2 } }) } })
    })

    expect(screen.queryByText('Explore')).not.toBeInTheDocument()
    expect(screen.queryByText('running')).not.toBeInTheDocument()
    expect(result.fetchFake.lastRequest('GET', '/api/opencode/api/session/:sessionID')).toBeDefined()
  })

  it('applies a shell exit recorded before the list was seeded', async () => {
    resetSessionStatus()
    recordShellExit('/repo', { id: 'sh-seeded', status: 'exited', exit: 0 })
    const result = renderBar([], false, { shells: [shell('sh-seeded')] })

    await waitFor(() => expect(result.fetchFake.lastRequest('GET', SHELLS_PATH)).toBeDefined())
    await waitFor(() => expect(result.container).toBeEmptyDOMElement())
    clearShellExitRecord('/repo', 'sh-seeded')
  })

  it('navigates to a backgrounded subagent session', async () => {
    resetSessionStatus()
    let clickedSession: string | undefined
    renderWithProviders(
      <BackgroundWorkBar
        sessionID="session-1"
        directory="/repo"
        messages={[backgroundSubagentTool('child-1')]}
        isSessionActive={false}
        onChildSessionClick={(sessionId) => { clickedSession = sessionId }}
      />,
      {
        auth: false,
        theme: false,
        toaster: false,
        fetchRoutes: [
          { method: 'GET', path: SHELLS_PATH, respond: () => ({ json: { data: [] } }) },
          { method: 'GET', path: '/api/opencode/api/session/:sessionID', respond: () => new Promise<FetchRouteResult>(() => {}) },
        ],
      },
    )

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'View Explore' }))

    expect(clickedSession).toBe('child-1')
  })

  it('shows the tail of a background shell output', async () => {
    resetSessionStatus()
    const result = renderBar([], false, {
      shells: [shell('dev')],
      outputLoader: () => ({ json: { data: { output: 'server listening on 3000', cursor: 24, size: 24, truncated: false } } }),
    })

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Output' }))

    expect(await screen.findByText('server listening on 3000')).toBeInTheDocument()
    const outputRequest = result.fetchFake.lastRequest('GET', `${SHELLS_PATH}/:id/output`)
    expect(outputRequest?.path).toBe(`${SHELLS_PATH}/dev/output`)
    expect(outputRequest?.searchParams.get('cursor')).toBe('0')
    expect(outputRequest?.searchParams.get('limit')).toBe('50000')
    expect(outputRequest?.searchParams.get('location[directory]')).toBe('/repo')
  })

  it('reads the final output when the shell exits during an in-flight poll', async () => {
    resetSessionStatus()
    let resolveFirst: ((value: FetchRouteResult) => void) | undefined
    let calls = 0
    let shellList: ShellInfo[] = [shell('dev')]
    const result = renderBar([], false, {
      listLoader: () => ({ json: { data: shellList } }),
      outputLoader: () => {
        calls += 1
        if (calls === 1) {
          return new Promise<FetchRouteResult>((resolve) => { resolveFirst = resolve })
        }
        return { json: { data: { output: 'final tail', cursor: 10, size: 10, truncated: false } } }
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Output' }))
    await waitFor(() => expect(calls).toBe(1))

    shellList = []
    result.queryClient.setQueryData(['opencode', 'shells', '/repo'], [])
    await act(async () => {
      await result.queryClient.invalidateQueries({ queryKey: ['opencode', 'shells', '/repo'] })
    })

    expect(await screen.findByText('final tail')).toBeInTheDocument()

    await act(async () => {
      resolveFirst?.({ json: { data: { output: '', cursor: 0, size: 0, truncated: false } } })
    })
  })
})
