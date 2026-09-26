import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { PermissionRequest, SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { ToolCallPart } from './ToolCallPart'
import { useUserBash } from '@/stores/userBashStore'

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

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = new QueryClient()
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
})
