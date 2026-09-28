import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { SessionMessageAssistant, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import type { ShellInfo } from '@/api/opencode'
import { clearShellExitRecord, recordShellExit } from '@/lib/backgroundWork'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { BackgroundWorkBar } from './BackgroundWorkBar'

const api = vi.hoisted(() => ({
  backgroundSession: vi.fn(),
  getSession: vi.fn(),
  listShells: vi.fn(),
  readShellOutput: vi.fn(),
  removeShell: vi.fn(),
}))

vi.mock('@/api/opencode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/opencode')>()),
  ...api,
}))

vi.mock('@/lib/toast', () => ({
  showToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), loading: vi.fn() },
}))

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
): SessionMessageInfo => ({
  id: `notice-${shellID}`,
  type: 'synthetic',
  text: '',
  metadata: { source: 'shell', shellID, state, ...(exit === undefined ? {} : { exit }) },
  time: { created: 3 },
})

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

function renderBar(messages: SessionMessageInfo[], isSessionActive: boolean, onChildSessionClick = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return {
    ...render(
      <BackgroundWorkBar
        sessionID="session-1"
        directory="/repo"
        messages={messages}
        isSessionActive={isSessionActive}
        onChildSessionClick={onChildSessionClick}
      />,
      { wrapper },
    ),
    queryClient,
    onChildSessionClick,
  }
}

describe('BackgroundWorkBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listShells.mockResolvedValue([])
    api.getSession.mockImplementation(() => new Promise(() => {}))
    api.backgroundSession.mockResolvedValue(undefined)
    api.removeShell.mockResolvedValue(undefined)
    api.readShellOutput.mockResolvedValue({ output: '', cursor: 0, size: 0, truncated: false })
    useSessionStatus.setState({
      statuses: new Map(),
      statusCache: new Map(),
      statusRevisions: new Map(),
      knownSessions: new Set(),
      outcomes: new Map(),
      revision: 0,
    })
  })

  it('renders nothing when there is no running or background work', async () => {
    const { container } = renderBar([], false)
    await waitFor(() => expect(api.listShells).toHaveBeenCalledWith('/repo'))
    expect(container).toBeEmptyDOMElement()
  })

  it('moves running shell work to the background', async () => {
    renderBar([runningShellTool()], true)

    fireEvent.click(await screen.findByRole('button', { name: /Move to background/ }))

    await waitFor(() => expect(api.backgroundSession).toHaveBeenCalledWith('session-1'))
  })

  it('hides the background action once the session is idle', async () => {
    renderBar([runningShellTool()], false)
    await waitFor(() => expect(api.listShells).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Move to background/ })).not.toBeInTheDocument()
  })

  it('hides completed shells and removes a killed shell', async () => {
    api.listShells.mockResolvedValue([shell('dev'), shell('other', 'session-2'), shell('done', 'session-1', 'exited')])
    const { container } = renderBar([], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))

    expect(screen.getByText('npm run dev')).toBeInTheDocument()
    expect(screen.queryByText('npm run done')).not.toBeInTheDocument()
    expect(screen.queryByText('npm run other')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Kill npm run dev' }))

    await waitFor(() => expect(api.removeShell).toHaveBeenCalledWith('dev', '/repo'))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    clearShellExitRecord('/repo', 'dev')
  })

  it('removes a shell row once it completes', async () => {
    api.listShells.mockResolvedValue([shell('dev')])
    const { queryClient } = renderBar([], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))
    expect(screen.getByText('running')).toBeInTheDocument()

    await act(async () => {
      queryClient.setQueryData(['opencode', 'shells', '/repo'], [
        { ...shell('dev', 'session-1', 'exited'), exit: 0, time: { started: 1, completed: 2 } },
      ])
    })

    await waitFor(() => expect(screen.queryByText('npm run dev')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /background task/ })).not.toBeInTheDocument()
  })

  it('preserves a shell created while a stale list fetch was in flight', async () => {
    let resolveList: ((value: ShellInfo[]) => void) | undefined
    api.listShells.mockImplementation(() => new Promise<ShellInfo[]>((resolve) => { resolveList = resolve }))
    const { queryClient } = renderBar([], false)
    await waitFor(() => expect(api.listShells).toHaveBeenCalled())

    await act(async () => {
      queryClient.setQueryData(['opencode', 'shells', '/repo'], [
        { ...shell('dev'), time: { started: Date.now() + 60_000 } },
      ])
    })

    await act(async () => {
      resolveList?.([])
    })

    expect(await screen.findByRole('button', { name: /1 background task$/ })).toBeInTheDocument()
    expect(screen.queryByText('unavailable')).not.toBeInTheDocument()
  })

  it('hides a running shell omitted from a fresh list once it becomes unavailable', async () => {
    api.listShells.mockResolvedValue([])
    const { queryClient, container } = renderBar([], false)
    await waitFor(() => expect(api.listShells).toHaveBeenCalled())

    await act(async () => {
      queryClient.setQueryData(['opencode', 'shells', '/repo'], [shell('dev')])
      await queryClient.invalidateQueries({ queryKey: ['opencode', 'shells', '/repo'] })
    })

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('does not resurrect a completed shell from a stale list fetch', async () => {
    api.listShells.mockResolvedValue([shell('dev')])
    const { queryClient } = renderBar([], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))
    expect(screen.getByText('running')).toBeInTheDocument()

    queryClient.setQueryData(['opencode', 'shells', '/repo'], [
      { ...shell('dev', 'session-1', 'exited'), exit: 0, time: { started: 1, completed: 2 } },
    ])

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['opencode', 'shells', '/repo'] })
    })

    await waitFor(() => expect(screen.queryByText('npm run dev')).not.toBeInTheDocument())
    expect(screen.queryByText('running')).not.toBeInTheDocument()
  })

  it('shows a backgrounded subagent and removes it when the child goes idle', async () => {
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
    renderBar([backgroundSubagentTool('child-unknown')], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))

    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.queryByText('completed')).not.toBeInTheDocument()
  })

  it('reconciles a child session that finished before it was observed', async () => {
    api.getSession.mockResolvedValue({
      id: 'child-1',
      projectID: 'project-1',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      outcome: 'succeeded',
      time: { created: 1, updated: 2, idle: 2 },
      location: { directory: '/repo' },
    })
    const { container } = renderBar([backgroundSubagentTool('child-1')], false)

    await waitFor(() => expect(api.getSession).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('hides a failed child session outcome', async () => {
    act(() => {
      useSessionStatus.getState().setOutcome('child-1', 'failed')
      useSessionStatus.getState().setStatus('child-1', { type: 'idle' })
    })
    const { container } = renderBar([backgroundSubagentTool('child-1')], false)

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('hides an interrupted child session outcome', async () => {
    act(() => {
      useSessionStatus.getState().setOutcome('child-1', 'interrupted')
      useSessionStatus.getState().setStatus('child-1', { type: 'idle' })
    })
    const { container } = renderBar([backgroundSubagentTool('child-1')], false)

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('hides a deleted shell once it becomes unavailable', async () => {
    api.listShells.mockResolvedValue([shell('dev')])
    const { queryClient, container } = renderBar([], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))

    await act(async () => {
      queryClient.setQueryData(['opencode', 'shells', '/repo'], [
        { ...shell('dev'), status: 'unavailable', time: { started: 1, completed: 2 } },
      ])
    })

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('hides a historical shell absent from the fetched list', async () => {
    api.listShells.mockResolvedValue([])
    const { container } = renderBar([backgroundShellTool('sh-history', 'npm run history')], false)

    await waitFor(() => expect(api.listShells).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('hides a historical shell absent from the list once its notice reports completion', async () => {
    api.listShells.mockResolvedValue([])
    const { container } = renderBar(
      [backgroundShellTool('sh-notice', 'npm run notice'), shellNotice('sh-notice', 'completed', 0)],
      false,
    )

    await waitFor(() => expect(api.listShells).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('hides a historical shell absent from the list once its error notice reports failure', async () => {
    api.listShells.mockResolvedValue([])
    const { container } = renderBar(
      [backgroundShellTool('sh-notice', 'npm run notice'), shellNotice('sh-notice', 'error')],
      false,
    )

    await waitFor(() => expect(api.listShells).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('keeps a historical shell unknown while its list is still loading', async () => {
    api.listShells.mockImplementation(() => new Promise(() => {}))
    renderBar([backgroundShellTool('sh-history', 'npm run history')], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))

    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.queryByText('unavailable')).not.toBeInTheDocument()
  })

  it('uses an already cached shell list when the bar remounts', async () => {
    const messages = [backgroundShellTool('sh-history', 'npm run history')]
    const { queryClient, unmount, container } = renderBar(messages, false)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    unmount()

    const remount = render(
      <QueryClientProvider client={queryClient}>
        <BackgroundWorkBar sessionID="session-1" directory="/repo" messages={messages} isSessionActive={false} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(remount.container).toBeEmptyDOMElement())
    expect(api.listShells).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite a newer live child status with a stale child query', async () => {
    let resolveSession: ((value: unknown) => void) | undefined
    api.getSession.mockImplementation(() => new Promise((resolve) => { resolveSession = resolve }))
    renderBar([backgroundSubagentTool('child-1')], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))

    act(() => {
      useSessionStatus.getState().setStatus('child-1', { type: 'idle' })
    })
    expect(screen.queryByText('Explore')).not.toBeInTheDocument()

    await act(async () => {
      resolveSession?.({
        id: 'child-1',
        projectID: 'project-1',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 2 },
        location: { directory: '/repo' },
      })
    })

    expect(screen.queryByText('Explore')).not.toBeInTheDocument()
    expect(screen.queryByText('running')).not.toBeInTheDocument()
  })

  it('applies a shell exit recorded before the list was seeded', async () => {
    recordShellExit('/repo', { id: 'sh-seeded', status: 'exited', exit: 0 })
    api.listShells.mockResolvedValue([shell('sh-seeded')])
    const { container } = renderBar([], false)

    await waitFor(() => expect(api.listShells).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    clearShellExitRecord('/repo', 'sh-seeded')
  })

  it('navigates to a backgrounded subagent session', async () => {
    const { onChildSessionClick } = renderBar([backgroundSubagentTool('child-1')], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'View Explore' }))

    expect(onChildSessionClick).toHaveBeenCalledWith('child-1')
  })

  it('shows the tail of a background shell output', async () => {
    api.listShells.mockResolvedValue([shell('dev')])
    api.readShellOutput.mockResolvedValue({ output: 'server listening on 3000', cursor: 24, size: 24, truncated: false })
    renderBar([], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Output' }))

    expect(await screen.findByText('server listening on 3000')).toBeInTheDocument()
    expect(api.readShellOutput).toHaveBeenCalledWith('dev', '/repo', 0, 50_000)
  })

  it('reads the final output when the shell exits during an in-flight poll', async () => {
    let resolveFirst: ((value: { output: string; cursor: number; size: number; truncated: boolean }) => void) | undefined
    let calls = 0
    api.listShells.mockResolvedValue([shell('dev')])
    api.readShellOutput.mockImplementation(() => {
      calls += 1
      if (calls === 1) {
        return new Promise<{ output: string; cursor: number; size: number; truncated: boolean }>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve({ output: 'final tail', cursor: 10, size: 10, truncated: false })
    })
    const { queryClient } = renderBar([], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background task$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Output' }))
    await waitFor(() => expect(calls).toBe(1))

    api.listShells.mockResolvedValue([])
    await queryClient.invalidateQueries({ queryKey: ['opencode', 'shells', '/repo'] })

    expect(await screen.findByText('final tail')).toBeInTheDocument()

    resolveFirst?.({ output: '', cursor: 0, size: 0, truncated: false })
  })
})
