import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { PermissionRequest, SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { ToolCallPart } from './ToolCallPart'
import { getFileApiUrl } from '@/api/files'
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

  it('labels a sandboxed command with a non-manager provider', () => {
    renderWithProviders(
      <ToolCallPart part={completedShell({ sandbox: true, sandboxProvider: 'forge' })} messageID="msg_1" />,
    )

    const badge = screen.getByText('sandbox · forge')
    expect(badge).toHaveAttribute('title', 'Executed inside the forge sandbox')
  })

  it('keeps the plain sandbox label for the manager provider', () => {
    renderWithProviders(
      <ToolCallPart part={completedShell({ sandbox: true, sandboxProvider: 'ocm' })} messageID="msg_1" />,
    )

    const badge = screen.getByText('sandbox')
    expect(badge).toHaveAttribute('title', 'Executed inside the sandbox microVM')
  })

  it('keeps the plain sandbox label when no provider is reported', () => {
    renderWithProviders(<ToolCallPart part={completedShell({ sandbox: true })} messageID="msg_1" />)

    const badge = screen.getByText('sandbox')
    expect(badge).toHaveAttribute('title', 'Executed inside the sandbox microVM')
  })
})

describe('ToolCallPart execute renderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSettings.mockReturnValue({
      preferences: { expandToolCalls: false },
      isLoading: false,
      updateSettings: vi.fn(),
      isUpdating: false,
    })
    mocks.useToolCallPermission.mockReturnValue(null)
  })

  const completedExecute = (
    metadata: Record<string, unknown>,
    text = '{"windows":[{"title":"Untitled"}]}',
  ): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_exec',
    name: 'execute',
    time: { created: 1, ran: 2, completed: 3 },
    state: {
      status: 'completed',
      input: {
        code: 'const result = await tools.listWindows({ app: "TextEdit" })\nconsole.log(result)',
      },
      content: [{ type: 'text', text }],
      metadata,
    },
  })

  const childCalls = [
    { tool: 'cua-driver.list_windows', status: 'completed', input: { app: 'TextEdit' } },
    { tool: 'cua-driver.click', status: 'error', input: { x: 10 } },
  ]

  it('lists child calls while collapsed and marks errors', () => {
    renderWithProviders(<ToolCallPart part={completedExecute({ toolCalls: childCalls })} messageID="msg_1" />)

    expect(screen.getByText('cua-driver.list_windows [app=TextEdit]')).toBeInTheDocument()
    expect(screen.getByText('cua-driver.click [x=10]')).toBeInTheDocument()

    const errorRow = screen.getByRole('button', { name: /cua-driver\.click/ })
    expect(within(errorRow).getByText('✗')).toBeInTheDocument()
    expect(screen.getByText(/Failed/)).toBeInTheDocument()
  })

  it('renders line-numbered code and output sections when expanded', () => {
    mocks.useSettings.mockReturnValue({
      preferences: { expandToolCalls: true },
      isLoading: false,
      updateSettings: vi.fn(),
      isUpdating: false,
    })

    const { container } = renderWithProviders(
      <ToolCallPart part={completedExecute({ toolCalls: childCalls })} messageID="msg_1" />,
    )

    expect(screen.getByText('Code')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(container.querySelector('code.language-ts')?.textContent).toContain('const result = await tools.listWindows')
    expect(container.querySelector('code.language-json')?.textContent).toContain('"windows"')

    const gutters = screen.getAllByTestId('execute-line-numbers')
    expect(gutters[0].textContent).toBe('1\n2')
    expect(gutters[1].textContent).toBe('1')
    expect(gutters[0].style.width).toBe(gutters[1].style.width)
  })

  it('caps the collapsed child call preview and reports the hidden count', () => {
    const manyCalls = Array.from({ length: 8 }, (_, index) => ({
      tool: `cua-driver.call_${index}`,
      status: 'completed',
      input: { index },
    }))

    renderWithProviders(<ToolCallPart part={completedExecute({ toolCalls: manyCalls })} messageID="msg_1" />)

    expect(screen.getAllByRole('button', { name: /cua-driver\.call_/ })).toHaveLength(5)
    expect(screen.getByText('(3 more calls)')).toBeInTheDocument()
    expect(screen.queryByText('Code')).not.toBeInTheDocument()
    expect(screen.queryByText('cua-driver.call_5 [index=5]')).not.toBeInTheDocument()
  })

  it('reveals the code and output detail from the header on desktop', () => {
    const manyCalls = Array.from({ length: 8 }, (_, index) => ({
      tool: `cua-driver.call_${index}`,
      status: 'completed',
      input: { index },
    }))

    renderWithProviders(<ToolCallPart part={completedExecute({ toolCalls: manyCalls })} messageID="msg_1" />)

    fireEvent.click(screen.getByRole('button', { name: /execute/ }))

    expect(screen.getByText('Code')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.queryByText('(3 more calls)')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /cua-driver\.call_/ })).toHaveLength(8)
    expect(screen.getByText('cua-driver.call_5 [index=5]')).toBeInTheDocument()
  })

  it('reports a completed script that failed at runtime', () => {
    renderWithProviders(
      <ToolCallPart
        part={completedExecute({ error: true }, 'Error: tool not found\n    at execute')}
        messageID="msg_1"
      />,
    )

    expect(screen.getByText(/Failed/)).toBeInTheDocument()
    expect(screen.getByText('↳ Error: tool not found')).toBeInTheDocument()
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
  })

  const runningExecute = (): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_exec',
    name: 'execute',
    time: { created: 1, ran: 2 },
    state: {
      status: 'running',
      input: { code: 'await tools.listWindows({ app: "TextEdit" })' },
      metadata: {},
    },
  })

  it('shows the waiting permission state while the script awaits permission', () => {
    mocks.useToolCallPermission.mockReturnValue(
      permissionFor({ type: 'tool', messageID: 'msg_1', id: 'call_exec' }),
    )

    renderWithProviders(<ToolCallPart part={runningExecute()} messageID="msg_1" />)

    expect(screen.getByText('awaiting permission')).toBeInTheDocument()
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
  })

  it('toggles aria-expanded on the header button', () => {
    renderWithProviders(<ToolCallPart part={completedExecute({ toolCalls: childCalls })} messageID="msg_1" />)

    const header = screen.getByRole('button', { name: /execute/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens a file reference from an expanded child call input', () => {
    const onFileClick = vi.fn()
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_exec',
      name: 'execute',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: { code: 'await tools.read({ path: "src/app.ts" })' },
        content: [{ type: 'text', text: 'read ok' }],
        metadata: { toolCalls: [{ tool: 'read', status: 'completed', input: { path: 'src/app.ts' } }] },
      },
    }

    renderWithProviders(<ToolCallPart part={part} messageID="msg_1" onFileClick={onFileClick} />)

    fireEvent.click(screen.getByRole('button', { name: /read \[path=src\/app.ts\]/ }))
    const reference = screen.getByRole('button', { name: 'Open src/app.ts' })
    expect(reference).toHaveAttribute('title', 'Click to open src/app.ts')
    fireEvent.click(reference)

    expect(onFileClick).toHaveBeenCalledWith('src/app.ts')
  })
})

describe('ToolCallPart file content', () => {
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

  const screenshotUri = 'data:image/png;base64,aGVsbG8='

  it('shows an execute screenshot while collapsed', () => {
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_exec_files',
      name: 'execute',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: { code: 'await tools.screenshot()' },
        content: [
          { type: 'text', text: 'Captured the window' },
          { type: 'file', uri: screenshotUri, mime: 'image/png', name: 'screenshot.png' },
        ],
        metadata: {},
      },
    }

    renderWithProviders(<ToolCallPart part={part} messageID="msg_1" />)

    expect(screen.getByRole('button', { name: /execute/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByAltText('screenshot.png')).toHaveAttribute('src', screenshotUri)
  })

  it('shows a generic tool screenshot while collapsed', () => {
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_screenshot',
      name: 'screenshot',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: {},
        content: [{ type: 'file', uri: screenshotUri, mime: 'image/png', name: 'screenshot.png' }],
        metadata: {},
      },
    }

    renderWithProviders(<ToolCallPart part={part} messageID="msg_1" />)

    expect(screen.getByAltText('screenshot.png')).toHaveAttribute('src', screenshotUri)
  })

  it('does not render an empty file content wrapper', () => {
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_text_only',
      name: 'screenshot',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: {},
        content: [{ type: 'text', text: 'no files' }],
        metadata: {},
      },
    }

    const { container } = renderWithProviders(<ToolCallPart part={part} messageID="msg_1" />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.flex-wrap')).toBeNull()
  })
})

describe('ToolCallPart open walkthrough action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSettings.mockReturnValue({
      preferences: { expandToolCalls: false },
      isLoading: false,
      updateSettings: vi.fn(),
      isUpdating: false,
    })
    mocks.useToolCallPermission.mockReturnValue(null)
  })

  const openWalkthrough = (status: 'running' | 'completed'): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_ocm',
    name: 'ocm',
    time: status === 'completed' ? { created: 1, ran: 2, completed: 3 } : { created: 1, ran: 2 },
    state:
      status === 'completed'
        ? {
            status: 'completed',
            input: { action: 'open_walkthrough', params: {} },
            content: [{ type: 'text', text: 'Walkthrough opened' }],
          }
        : {
            status: 'running',
            input: { action: 'open_walkthrough', params: {} },
            metadata: {},
          },
  })

  it('renders an Open walkthrough button and calls the opener', () => {
    const onOpenWalkthrough = vi.fn()

    renderWithProviders(
      <ToolCallPart part={openWalkthrough('completed')} messageID="msg_1" onOpenWalkthrough={onOpenWalkthrough} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open walkthrough' }))

    expect(onOpenWalkthrough).toHaveBeenCalledTimes(1)
  })

  it('passes the requested source to the opener', () => {
    const onOpenWalkthrough = vi.fn()
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_ocm',
      name: 'ocm',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: { action: 'open_walkthrough', params: { source: { kind: 'staged' } } },
        content: [{ type: 'text', text: 'Walkthrough opened' }],
      },
    }

    renderWithProviders(
      <ToolCallPart part={part} messageID="msg_1" onOpenWalkthrough={onOpenWalkthrough} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open walkthrough' }))

    expect(onOpenWalkthrough).toHaveBeenCalledWith({ kind: 'staged' })
  })

  it('passes no source when the call invalidates one', () => {
    const onOpenWalkthrough = vi.fn()
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_ocm',
      name: 'ocm',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: { action: 'open_walkthrough', params: { source: { kind: 'nonsense' } } },
        content: [{ type: 'text', text: 'Walkthrough opened' }],
      },
    }

    renderWithProviders(
      <ToolCallPart part={part} messageID="msg_1" onOpenWalkthrough={onOpenWalkthrough} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open walkthrough' }))

    expect(onOpenWalkthrough).toHaveBeenCalledWith(undefined)
  })

  it('does not render the button while the call is still running', () => {
    renderWithProviders(
      <ToolCallPart part={openWalkthrough('running')} messageID="msg_1" onOpenWalkthrough={vi.fn()} />,
    )

    expect(screen.queryByRole('button', { name: 'Open walkthrough' })).not.toBeInTheDocument()
  })

  it('does not render the button for another ocm action', () => {
    const otherAction: SessionMessageAssistantTool = {
      type: 'tool',
      id: 'call_ocm',
      name: 'ocm',
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: 'completed',
        input: { action: 'something_else' },
        content: [{ type: 'text', text: 'ok' }],
      },
    }

    renderWithProviders(<ToolCallPart part={otherAction} messageID="msg_1" onOpenWalkthrough={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Open walkthrough' })).not.toBeInTheDocument()
  })
})

describe('ToolCallPart shell preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSettings.mockReturnValue({
      preferences: { expandToolCalls: false },
      isLoading: false,
      updateSettings: vi.fn(),
      isUpdating: false,
    })
    mocks.useToolCallPermission.mockReturnValue(null)
  })

  it('shows only the tail of a long shell output until the details are opened', () => {
    const lines = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`)

    renderWithProviders(
      <ToolCallPart
        part={{
          type: 'tool',
          id: 'call_lines',
          name: 'shell',
          time: { created: 1, ran: 2, completed: 3 },
          state: {
            status: 'completed',
            input: { command: 'seq 25' },
            content: [{ type: 'text', text: lines.join('\n') }],
            metadata: {},
          },
        }}
        messageID="msg_1"
      />,
    )

    const preview = screen.getByRole('button', { name: 'Show shell details' })
    expect(within(preview).getByText('(15 earlier lines)')).toBeInTheDocument()
    expect(preview.textContent).toMatch(/\bline 25\b/)
    expect(preview.textContent).not.toMatch(/\bline 1\b/)
  })
})

describe('ToolCallPart shell details scrolling', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSettings.mockReturnValue({
      preferences: { expandToolCalls: false },
      isLoading: false,
      updateSettings: vi.fn(),
      isUpdating: false,
    })
    mocks.useToolCallPermission.mockReturnValue(null)
    Element.prototype.scrollIntoView = scrollIntoView
  })

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView
  })

  const completedShell = (): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_scroll',
    name: 'shell',
    time: { created: 1, ran: 2, completed: 3 },
    state: {
      status: 'completed',
      input: { command: 'seq 25' },
      content: [{ type: 'text', text: 'line 24\nline 25' }],
      metadata: {},
    },
  })

  it('does not scroll when the shell details open from the preference', () => {
    mocks.useSettings.mockReturnValue({
      preferences: { expandToolCalls: true },
      isLoading: false,
      updateSettings: vi.fn(),
      isUpdating: false,
    })

    renderWithProviders(<ToolCallPart part={completedShell()} messageID="msg_1" />)

    expect(screen.getByText('Command:')).toBeInTheDocument()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls once when the user opens the shell details', () => {
    renderWithProviders(<ToolCallPart part={completedShell()} messageID="msg_1" />)

    expect(screen.queryByText('Command:')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show shell details' }))

    expect(screen.getByText('Command:')).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' })
  })
})

describe('ToolCallPart show artifact action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSettings.mockReturnValue({
      preferences: { expandToolCalls: false },
      isLoading: false,
      updateSettings: vi.fn(),
      isUpdating: false,
    })
    mocks.useToolCallPermission.mockReturnValue(null)
  })

  const showArtifact = (params: unknown, metadata?: Record<string, string>): SessionMessageAssistantTool => ({
    type: 'tool',
    id: 'call_artifact',
    name: 'ocm',
    time: { created: 1, ran: 2, completed: 3 },
    state: {
      status: 'completed',
      input: { action: 'show_artifact', params },
      content: [{ type: 'text', text: 'Artifact shown' }],
      metadata,
    },
  })

  it('renders the sandboxed iframe, path label, and open-in-new-tab link', () => {
    const src = getFileApiUrl('/repo/reports/summary.html', { params: { raw: true } })

    renderWithProviders(
      <ToolCallPart
        part={showArtifact({ title: 'Report', path: 'reports/summary.html' })}
        messageID="msg_1"
        directory="/repo"
      />,
    )

    const iframe = screen.getByTitle('Report')
    expect(iframe.tagName).toBe('IFRAME')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(iframe).toHaveAttribute('src', src)

    const pathLabel = screen.getByText('reports/summary.html')
    expect(pathLabel).toHaveAttribute('title', 'reports/summary.html')

    const link = screen.getByRole('link', { name: 'Open in new tab' })
    expect(link).toHaveAttribute('href', src)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('prefers the backend-resolved metadata path over the directory join', () => {
    const src = getFileApiUrl('/workspace/sessions/ses_1/report.html', { params: { raw: true } })

    renderWithProviders(
      <ToolCallPart
        part={showArtifact(
          { title: 'Report', path: 'reports/summary.html' },
          { path: '/workspace/sessions/ses_1/report.html' },
        )}
        messageID="msg_1"
        directory="/repo"
      />,
    )

    expect(screen.getByTitle('Report')).toHaveAttribute('src', src)
    expect(screen.getByText('reports/summary.html')).toHaveAttribute('title', 'reports/summary.html')
  })

  it('maps a repo path outside the workspace to the repo-local path', () => {
    const src = getFileApiUrl('assistant/reports/summary.html', { params: { raw: true } })

    renderWithProviders(
      <ToolCallPart
        part={showArtifact({ title: 'Report', path: 'reports/summary.html' })}
        messageID="msg_1"
        directory="/workspace/repos/assistant"
        repoFullPath="/workspace/repos/assistant"
        repoLocalPath="assistant"
      />,
    )

    expect(screen.getByTitle('Report')).toHaveAttribute('src', src)
  })

  it('resolves an absolute artifact path without a session directory', () => {
    const src = getFileApiUrl('/tmp/artifacts/report.html', { params: { raw: true } })

    renderWithProviders(
      <ToolCallPart
        part={showArtifact({ title: 'Report', path: '/tmp/artifacts/report.html' })}
        messageID="msg_1"
      />,
    )

    const iframe = screen.getByTitle('Report')
    expect(iframe).toHaveAttribute('src', src)
    expect(screen.getByText('/tmp/artifacts/report.html')).toHaveAttribute('title', '/tmp/artifacts/report.html')
  })

  it('remounts the iframe with an unchanged src when Reload is clicked', () => {
    const src = getFileApiUrl('/repo/reports/summary.html', { params: { raw: true } })

    const { container } = renderWithProviders(
      <ToolCallPart
        part={showArtifact({ title: 'Report', path: 'reports/summary.html' })}
        messageID="msg_1"
        directory="/repo"
      />,
    )

    const before = container.querySelector('iframe')
    expect(before).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reload artifact' }))

    const after = container.querySelector('iframe')
    expect(after).not.toBe(before)
    expect(after).toHaveAttribute('src', src)
  })

  it('falls back to the generic tool card for invalid params', () => {
    const { container } = renderWithProviders(
      <ToolCallPart part={showArtifact({ title: 'No path' })} messageID="msg_1" directory="/repo" />,
    )

    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByText('ocm')).toBeInTheDocument()
  })

  it('falls back to the generic tool card for a relative path without a directory', () => {
    const { container } = renderWithProviders(
      <ToolCallPart part={showArtifact({ title: 'Report', path: 'reports/summary.html' })} messageID="msg_1" />,
    )

    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByText('ocm')).toBeInTheDocument()
  })
})
