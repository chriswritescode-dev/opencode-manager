import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { PermissionRequest, SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { ToolCallPart } from './ToolCallPart'
import { useUserBash } from '@/stores/userBashStore'
import { useSessionStatus } from '@/stores/sessionStatusStore'

const mocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
  useToolCallPermission: vi.fn(),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

vi.mock('@/contexts/EventContext', () => ({
  useToolCallPermission: mocks.useToolCallPermission,
}))

vi.mock('@/api/opencode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/opencode')>()),
  getSession: () => new Promise(() => {}),
  listShells: () => Promise.resolve([]),
}))

const renderWithProviders = (ui: React.ReactElement, queryClient = new QueryClient()) => {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const runningShell = (): SessionMessageAssistantTool => ({
  type: 'tool',
  id: 'call_1',
  name: 'shell',
  time: { created: 1, ran: 2 },
  state: { status: 'running', input: { command: 'git status' }, metadata: {} },
})

const permissionFor = (source: PermissionRequest['source']): PermissionRequest => ({
  id: 'permission_1',
  sessionID: 'ses_1',
  action: 'shell',
  resources: ['git status'],
  source,
})

describe('ToolCallPart permission indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSettings.mockReturnValue({
      preferences: { expandToolCalls: true },
      isLoading: false,
      updateSettings: vi.fn(),
      isUpdating: false,
    })
    mocks.useToolCallPermission.mockReturnValue(null)
  })

  it('shows the waiting permission state for a matching tool call', () => {
    mocks.useToolCallPermission.mockReturnValue(
      permissionFor({ type: 'tool', messageID: 'msg_1', id: 'call_1' }),
    )

    renderWithProviders(<ToolCallPart part={runningShell()} messageID="msg_1" />)

    expect(mocks.useToolCallPermission).toHaveBeenCalledWith('call_1', 'msg_1')
    expect(screen.getByText('awaiting permission')).toBeInTheDocument()
    expect(screen.getByText('Waiting for permission...')).toBeInTheDocument()
  })

  it('does not show the waiting permission state without a pending permission', () => {
    renderWithProviders(<ToolCallPart part={runningShell()} messageID="msg_1" />)

    expect(screen.queryByText('awaiting permission')).not.toBeInTheDocument()
    expect(screen.queryByText('Waiting for permission...')).not.toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
  })

  it('ignores a permission whose source belongs to another tool call or message', () => {
    mocks.useToolCallPermission.mockReturnValue(null)

    renderWithProviders(<ToolCallPart part={runningShell()} messageID="msg_1" />)

    expect(mocks.useToolCallPermission).toHaveBeenCalledWith('call_1', 'msg_1')
    expect(screen.queryByText('awaiting permission')).not.toBeInTheDocument()
  })

  it('does not show the waiting permission state while the tool call is still streaming', () => {
    mocks.useToolCallPermission.mockReturnValue(
      permissionFor({ type: 'tool', messageID: 'msg_1', id: 'call_1' }),
    )

    renderWithProviders(
      <ToolCallPart
        part={{ ...runningShell(), state: { status: 'streaming', input: '' } }}
        messageID="msg_1"
      />,
    )

    expect(screen.queryByText('awaiting permission')).not.toBeInTheDocument()
  })
})

describe('ToolCallPart background indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSettings.mockReturnValue({
      preferences: { expandToolCalls: false },
      isLoading: false,
      updateSettings: vi.fn(),
      isUpdating: false,
    })
    mocks.useToolCallPermission.mockReturnValue(null)
    useUserBash.setState({ userBashCommands: new Map() })
    useSessionStatus.setState({
      statuses: new Map(),
      statusCache: new Map(),
      statusRevisions: new Map(),
      knownSessions: new Set(),
      revision: 0,
    })
  })

  const completedShell = (metadata: Record<string, unknown>): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_2',
    name: 'shell',
    time: { created: 1, ran: 2, completed: 3 },
    state: {
      status: 'completed',
      input: { command: 'npm run dev' },
      content: [{ type: 'text', text: 'Command moved to the background (shell ID: sh_1).' }],
      metadata,
    },
  })

  const completedSubagent = (metadata: Record<string, unknown>): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_3',
    name: 'subagent',
    time: { created: 1, ran: 2, completed: 3 },
    state: {
      status: 'completed',
      input: { description: 'Explore' },
      content: [{ type: 'text', text: 'Task moved to the background (session ID: ses_child).' }],
      metadata,
    },
  })


  it('marks a shell call that returned while its command keeps running', () => {
    renderWithProviders(<ToolCallPart part={completedShell({ status: 'running', shellID: 'sh_1' })} messageID="msg_1" />)

    expect(screen.getByText('background')).toBeInTheDocument()
  })

  it('does not mark a shell call that finished normally', () => {
    renderWithProviders(<ToolCallPart part={completedShell({ status: 'completed', shellID: 'sh_1' })} messageID="msg_1" />)

    expect(screen.queryByText('background')).not.toBeInTheDocument()
  })

  it('marks a backgrounded user-bash command with a background indicator', () => {
    useUserBash.setState({ userBashCommands: new Map([['npm run dev', Date.now()]]) })

    renderWithProviders(<ToolCallPart part={completedShell({ status: 'running', shellID: 'sh_1' })} messageID="msg_1" />)

    expect(screen.getByText('background')).toBeInTheDocument()
    expect(screen.queryByText('✓')).not.toBeInTheDocument()
  })

  it('clears the background badge once the live shell completes', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['opencode', 'shells', '/repo'], [
      {
        id: 'sh_1',
        status: 'exited',
        exit: 0,
        command: 'npm run dev',
        cwd: '/repo',
        shell: 'zsh',
        file: '/tmp/sh_1.log',
        metadata: { sessionID: 'ses_1' },
        time: { started: 1, completed: 2 },
      },
    ])

    renderWithProviders(
      <ToolCallPart part={completedShell({ status: 'running', shellID: 'sh_1' })} messageID="msg_1" directory="/repo" />,
      queryClient,
    )

    await waitFor(() => expect(screen.queryByText('background')).not.toBeInTheDocument())
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  it('shows a background shell missing from a loaded list as a non-spinning unavailable icon', async () => {
    const { container } = renderWithProviders(
      <ToolCallPart
        part={completedShell({ status: 'running', shellID: 'sh_missing' })}
        messageID="msg_1"
        directory="/repo"
      />,
    )

    await waitFor(() => expect(screen.getByText('unavailable')).toBeInTheDocument())
    expect(screen.queryByText('background')).not.toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('completes a background shell missing from the list from its notice', async () => {
    const { container } = renderWithProviders(
      <ToolCallPart
        part={completedShell({ status: 'running', shellID: 'sh_notice' })}
        messageID="msg_1"
        directory="/repo"
        shellOutcome="completed"
      />,
    )

    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument())
    expect(screen.queryByText('background')).not.toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('fails a background shell missing from the list from its notice', async () => {
    renderWithProviders(
      <ToolCallPart
        part={completedShell({ status: 'running', shellID: 'sh_notice' })}
        messageID="msg_1"
        directory="/repo"
        shellOutcome="failed"
      />,
    )

    await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument())
    expect(screen.queryByText('background')).not.toBeInTheDocument()
  })

  it('treats an unknown child session as running, not finished', () => {
    renderWithProviders(
      <ToolCallPart part={completedSubagent({ status: 'running', sessionID: 'child-unknown' })} messageID="msg_1" />,
    )

    expect(screen.getByText('background')).toBeInTheDocument()
    expect(screen.queryByText('✓')).not.toBeInTheDocument()
  })

  it('completes a backgrounded subagent when the child session is known idle', async () => {
    act(() => {
      useSessionStatus.getState().setStatus('child-1', { type: 'idle' })
    })

    renderWithProviders(
      <ToolCallPart part={completedSubagent({ status: 'running', sessionID: 'child-1' })} messageID="msg_1" />,
    )

    await waitFor(() => expect(screen.getByText('✓')).toBeInTheDocument())
    expect(screen.queryByText('background')).not.toBeInTheDocument()
  })
})
