import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { SessionDetail } from '../SessionDetail'
import { LocationCatcher } from '@/test/test-utils'
import { BUILTIN_COMMANDS } from '@/lib/builtinCommands'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useSessionTranscript: vi.fn(),
  useSSE: vi.fn(),
  useRepoActivity: vi.fn(),
  usePermissions: vi.fn(),
  useForms: vi.fn(),
  useSSEHealth: vi.fn(),
  useConfig: vi.fn(),
  useMobile: vi.fn(),
  useAutoScroll: vi.fn(),
  dialogSetters: {} as Record<string, ReturnType<typeof vi.fn>>,
  openSettings: vi.fn(),
  setSettingsTab: vi.fn(),
  useSessionStatusForSession: vi.fn(),
  compactSession: vi.fn(),
  listSessionMessages: vi.fn(),
  forkSession: vi.fn(),
  updateSession: vi.fn(),
  createSession: vi.fn(),
  updateSettings: vi.fn(),
  copyTextToClipboard: vi.fn(),
  downloadMarkdown: vi.fn(),
  setStatus: vi.fn(),
  setPromptValue: vi.fn(),
  openModelPicker: vi.fn(),
  promptInputProps: null as Record<string, unknown> | null,
  scrollIntoView: vi.fn(),
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  },
}))

vi.mock('@/config', () => ({
  OPENCODE_API_ENDPOINT: 'http://localhost:5551/api/opencode',
  API_BASE_URL: 'http://localhost:5551',
  SERVER_PORT: 5003,
  OPENCODE_PORT: 5551,
  FILE_LIMITS: {},
  DEFAULTS: {},
  ALLOWED_MIME_TYPES: [],
  GIT_PROVIDERS: [],
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return {
    ...actual,
    compactSession: mocks.compactSession,
    listSessionMessages: mocks.listSessionMessages,
    forkSession: mocks.forkSession,
  }
})

vi.mock('@/lib/exportSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/exportSession')>()
  return {
    ...actual,
    downloadMarkdown: mocks.downloadMarkdown,
  }
})

vi.mock('@/lib/clipboard', () => ({
  copyTextToClipboard: mocks.copyTextToClipboard,
}))

vi.mock('@/lib/toast', () => ({
  showToast: mocks.showToast,
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSession: mocks.useSession,
  useInterruptSession: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateSession: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: mocks.updateSession })),
  useCreateSession: vi.fn(() => ({ mutateAsync: mocks.createSession })),
  useConfig: mocks.useConfig,
  useSendPrompt: vi.fn(() => ({ mutate: vi.fn() })),
  useSendShell: vi.fn(() => ({ mutate: vi.fn() })),
  useAgents: vi.fn(() => ({ data: [] })),
}))

vi.mock('@/hooks/useSessionTranscript', () => ({
  useSessionTranscript: mocks.useSessionTranscript,
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useModelSelection: vi.fn(() => ({ model: null, modelString: null, modelRef: null })),
}))

vi.mock('@/hooks/useTTS', () => ({
  useTTS: vi.fn(() => ({ isEnabled: false })),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(() => ({
    preferences: { expandToolCalls: false },
    updateSettings: mocks.updateSettings,
  })),
}))

vi.mock('@/hooks/useSettingsDialog', () => ({
  useSettingsDialog: vi.fn(() => ({ open: mocks.openSettings, setActiveTab: mocks.setSettingsTab })),
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
  useSwipeBack: vi.fn(() => ({ ref: vi.fn() })),
}))

vi.mock('@/hooks/useVisualViewport', () => ({
  useVisualViewport: vi.fn(() => ({ keyboardHeight: 0 })),
}))

vi.mock('@/contexts/KeyboardShortcutsContext', () => ({
  useShortcutActions: vi.fn(),
}))

vi.mock('@/hooks/useAutoScroll', () => ({
  useAutoScroll: mocks.useAutoScroll,
}))

vi.mock('@/hooks/useDialogParam', () => ({
  useDialogParam: vi.fn((name: string) => [false, mocks.dialogSetters[name]]),
}))

vi.mock('@/hooks/useAutoPlayLastResponse', () => ({
  getAssistantText: vi.fn(() => ''),
  getLatestPlayableAssistantMessage: vi.fn(() => null),
  useAutoPlayLastResponse: vi.fn(() => {}),
}))

vi.mock('@/stores/uiStateStore', () => ({
  useUIState: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    typeof selector === 'function'
      ? selector({ isEditingMessage: false })
      : false
  ),
}))

vi.mock('@/stores/sessionStatusStore', () => ({
  useSessionStatus: vi.fn((selector: (state: { setStatus: typeof mocks.setStatus }) => unknown) =>
    selector({ setStatus: mocks.setStatus })
  ),
  useSessionStatusForSession: mocks.useSessionStatusForSession,
}))

vi.mock('@/hooks/useSSE', () => ({
  useSSE: mocks.useSSE,
}))

vi.mock('@/hooks/useRepoActivity', () => ({
  useRepoActivity: mocks.useRepoActivity,
}))

vi.mock('@/contexts/EventContext', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    usePermissions: mocks.usePermissions,
    useForms: mocks.useForms,
    useSSEHealth: mocks.useSSEHealth,
  }
})

vi.mock('@/api/repos', () => ({
  getRepo: vi.fn(() => Promise.resolve({
    id: 1,
    repoUrl: 'https://github.com/test/repo',
    localPath: '/test/repo',
    sourcePath: null,
    fullPath: '/test/repo',
    branch: 'main',
    currentBranch: 'main',
    fullSlug: 'test/repo',
    repoType: 'github' as const,
  })),
  initializeAssistantMode: vi.fn(() => Promise.resolve({ directory: '/test/repo' })),
}))

vi.mock('@/components/session/BackgroundWorkBar', () => ({ BackgroundWorkBar: vi.fn(() => null) }))
vi.mock('@/components/session/SessionGoalBar', () => ({ SessionGoalBar: vi.fn(() => null) }))
vi.mock('@/hooks/useSessionGoals', () => ({
  useSessionGoal: vi.fn(() => ({ data: undefined })),
  useStartSessionGoal: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  usePauseSessionGoal: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useResumeSessionGoal: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCancelSessionGoal: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))
vi.mock('@/components/session/SideQuestionDialog', () => ({ SideQuestionDialog: vi.fn(() => null) }))
vi.mock('@/components/session/ChangesWalkthroughSheet', () => ({ ChangesWalkthroughSheet: vi.fn(() => null) }))
vi.mock('@/components/navigation/ToolSidePanel', () => ({ ToolSidePanel: vi.fn(() => null) }))
vi.mock('@/hooks/useToolPanel', () => ({
  useToolPanel: vi.fn(() => ({ activeTool: null, toggleTool: vi.fn(), closePanel: vi.fn() })),
}))
vi.mock('@/components/session/SessionList', () => ({ SessionList: vi.fn(() => null) }))
vi.mock('@/components/file-browser/FileBrowserSheet', () => ({ FileBrowserSheet: vi.fn(() => null) }))
vi.mock('@/components/repo/RepoMcpDialog', () => ({ RepoMcpDialog: vi.fn(() => null) }))
vi.mock('@/components/repo/RepoActionsDialog', () => ({ RepoActionsDialog: vi.fn(() => null) }))
vi.mock('@/components/repo/ResetPermissionsDialog', () => ({ ResetPermissionsDialog: vi.fn(() => null) }))
vi.mock('@/components/repo/RepoSkillsDialog', () => ({ RepoSkillsDialog: vi.fn(() => null) }))
vi.mock('@/components/source-control', () => ({ SourceControlPanel: vi.fn(() => null) }))
vi.mock('@/components/session/FormPrompt', () => ({ FormPrompt: vi.fn(() => null) }))
vi.mock('@/components/session/MinimizedFormIndicator', () => ({ MinimizedFormIndicator: vi.fn(() => null) }))
vi.mock('@/components/notifications/PendingActionsGroup', () => ({ PendingActionsGroup: vi.fn(() => null) }))
vi.mock('@/components/message/MessageThread', async () => {
  const { createElement } = await import('react')
  return {
    MessageThread: ({ messages }: { messages: SessionMessageInfo[] }) =>
      createElement(
        'div',
        null,
        messages.map((message) =>
          createElement('div', { key: message.id, 'data-message-id': message.id }),
        ),
      ),
  }
})
vi.mock('@/components/message/PromptInput', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    PromptInput: forwardRef((props: Record<string, unknown>, ref) => {
      mocks.promptInputProps = props
      useImperativeHandle(ref, () => ({
        setPromptValue: mocks.setPromptValue,
        openModelPicker: mocks.openModelPicker,
      }))
      return null
    }),
  }
})

const SESSION_ID = 'session-1'

const createSession = (revert?: { messageID: string }) => ({
  id: SESSION_ID,
  title: 'Command Session',
  time: { created: 1000, updated: 2000 },
  location: { directory: '/test/repo' },
  ...(revert ? { revert } : {}),
})

function createUserMessage(id: string, text: string): SessionMessageInfo {
  return {
    id,
    type: 'user',
    text,
    time: { created: 1000 },
  } as SessionMessageInfo
}

describe('SessionDetail command actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.promptInputProps = null

    mocks.useSession.mockReturnValue({ data: createSession(), isLoading: false })
    mocks.useSessionTranscript.mockReturnValue({
      messages: [],
      pending: [],
      status: 'idle',
      isLoading: false,
      fetchOlder: vi.fn(),
      hasOlder: false,
    })
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useRepoActivity.mockReturnValue(undefined)
    mocks.usePermissions.mockReturnValue({ pendingCount: 0, syncForSession: vi.fn() })
    mocks.useForms.mockReturnValue({
      current: null,
      getForSession: vi.fn(() => null),
      pendingCount: 0,
      reply: vi.fn(),
      cancel: vi.fn(),
      syncForSession: vi.fn(),
    })
    mocks.useSSEHealth.mockReturnValue({ isHealthy: true })
    mocks.useConfig.mockReturnValue({ data: undefined, isLoading: false })
    mocks.useMobile.mockReturnValue(false)
    mocks.useAutoScroll.mockReturnValue({ scrollToBottom: vi.fn() })
    mocks.dialogSetters = {
      files: vi.fn(),
      mcp: vi.fn(),
      skills: vi.fn(),
      sourceControl: vi.fn(),
      resetPermissions: vi.fn(),
      walkthrough: vi.fn(),
    }
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'idle' })
    mocks.compactSession.mockResolvedValue(undefined)
    mocks.listSessionMessages.mockResolvedValue({ messages: [] })
    mocks.downloadMarkdown.mockResolvedValue(true)
    Element.prototype.scrollIntoView = mocks.scrollIntoView
  })

  const sessionDetailElement = (
    captured?: { search: { current: string }; pathname: { current: string } },
  ) => (
    <MemoryRouter initialEntries={[`/repos/1/sessions/${SESSION_ID}`]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {captured && (
          <LocationCatcher
            capturedSearch={captured.search}
            capturedPathname={captured.pathname}
          />
        )}
        <Routes>
          <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  )

  const renderSessionDetail = (
    captured?: { search: { current: string }; pathname: { current: string } },
  ) => render(sessionDetailElement(captured))

  const commandHandler = async (name: string) => {
    await waitFor(() => expect(mocks.promptInputProps).not.toBeNull())
    const commandActions = mocks.promptInputProps?.commandActions as Record<string, (argument?: string) => Promise<void>>
    const handler = commandActions[name]
    expect(handler).toBeTypeOf('function')
    return handler
  }

  const mockTranscriptMessages = (messages: SessionMessageInfo[]) => {
    mocks.useSessionTranscript.mockReturnValue({
      messages,
      pending: [],
      status: 'idle',
      isLoading: false,
      fetchOlder: vi.fn(),
      hasOlder: false,
    })
  }

  it('compacts the session through the shared handler and resolves the toast', async () => {
    renderSessionDetail()
    const compact = await commandHandler('compact')

    await act(async () => {
      await compact()
    })

    expect(mocks.setStatus).toHaveBeenCalledWith(SESSION_ID, { type: 'compact' })
    expect(mocks.compactSession).toHaveBeenCalledWith(SESSION_ID)
    expect(mocks.showToast.loading).toHaveBeenCalledWith('Compacting session...', { id: `compact-${SESSION_ID}` })
    expect(mocks.showToast.success).toHaveBeenCalledWith('Compaction requested', { id: `compact-${SESSION_ID}` })
  })

  it('resets the session status to idle when compaction fails', async () => {
    mocks.compactSession.mockRejectedValueOnce(new Error('nope'))
    renderSessionDetail()
    const compact = await commandHandler('compact')

    await act(async () => {
      await compact()
    })

    expect(mocks.setStatus).toHaveBeenCalledWith(SESSION_ID, { type: 'idle' })
    expect(mocks.showToast.error).toHaveBeenCalledWith('Compact failed: nope', { id: `compact-${SESSION_ID}` })
  })

  it('renames the session through the shared handler', async () => {
    renderSessionDetail()
    const renameSession = await commandHandler('renameSession')

    await act(async () => {
      await renameSession('  New name ')
    })

    expect(mocks.updateSession).toHaveBeenCalledWith({ sessionID: SESSION_ID, title: 'New name' })
    expect(mocks.showToast.success).not.toHaveBeenCalled()
  })

  it('regenerates the title when the command has no argument', async () => {
    renderSessionDetail()
    const renameSession = await commandHandler('renameSession')

    await act(async () => {
      await renameSession('')
    })

    expect(mocks.updateSession).toHaveBeenCalledWith({ sessionID: SESSION_ID, title: '' })
    expect(mocks.showToast.success).toHaveBeenCalledWith('Session title regenerated')
  })

  it('shows the error toast when renaming fails', async () => {
    mocks.updateSession.mockRejectedValueOnce(new Error('nope'))
    renderSessionDetail()
    const renameSession = await commandHandler('renameSession')

    await act(async () => {
      await renameSession('New name')
    })

    expect(mocks.showToast.error).toHaveBeenCalledWith('Rename failed: nope')
  })

  it('copies the complete history across pages to the clipboard', async () => {
    mocks.listSessionMessages.mockImplementation(
      (_sessionID: string, input: { cursor?: string } = {}) => {
        if (!input.cursor) {
          return Promise.resolve({
            messages: [
              createUserMessage('2', 'middle-marker'),
              createUserMessage('3', 'newest-marker'),
            ],
            nextCursor: 'cursor-1',
          })
        }
        return Promise.resolve({
          messages: [
            createUserMessage('1', 'oldest-marker'),
            createUserMessage('2', 'middle-marker'),
          ],
        })
      },
    )
    mocks.copyTextToClipboard.mockResolvedValue(true)

    renderSessionDetail()
    const copyTranscript = await commandHandler('copyTranscript')

    await act(async () => {
      await copyTranscript()
    })

    expect(mocks.listSessionMessages).toHaveBeenCalledWith(SESSION_ID, {})
    expect(mocks.listSessionMessages).toHaveBeenCalledWith(SESSION_ID, { cursor: 'cursor-1' })
    expect(mocks.copyTextToClipboard).toHaveBeenCalledTimes(1)

    const content = await (mocks.copyTextToClipboard.mock.calls[0][0] as Promise<string>)
    expect(content.match(/oldest-marker/g)).toHaveLength(1)
    expect(content.match(/middle-marker/g)).toHaveLength(1)
    expect(content.match(/newest-marker/g)).toHaveLength(1)
    expect(content.indexOf('oldest-marker')).toBeLessThan(content.indexOf('middle-marker'))
    expect(content.indexOf('middle-marker')).toBeLessThan(content.indexOf('newest-marker'))
    expect(mocks.showToast.success).toHaveBeenCalledWith('Session transcript copied')
  })

  it('opens the side question dialog with the command argument', async () => {
    const { SideQuestionDialog } = await import('@/components/session/SideQuestionDialog')

    renderSessionDetail()
    const askSideQuestion = await commandHandler('askSideQuestion')

    await act(async () => {
      await askSideQuestion('why?')
    })

    expect(vi.mocked(SideQuestionDialog)).toHaveBeenCalled()
    const props = vi.mocked(SideQuestionDialog).mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(props).toMatchObject({
      open: true,
      sessionID: SESSION_ID,
      initialQuestion: 'why?',
    })
  })

  it('shows the error toast when the transcript fetch fails', async () => {
    mocks.listSessionMessages.mockRejectedValueOnce(new Error('page fetch failed'))
    mocks.copyTextToClipboard.mockImplementation(async (content: string | Promise<string>) => {
      try {
        await content
        return true
      } catch {
        return false
      }
    })

    renderSessionDetail()
    const copyTranscript = await commandHandler('copyTranscript')

    await act(async () => {
      await copyTranscript()
    })

    expect(mocks.showToast.error).toHaveBeenCalledWith('Failed to copy session transcript')
    expect(mocks.showToast.success).not.toHaveBeenCalled()
  })

  it('opens the fork picker from the forkSession command action', async () => {
    renderSessionDetail()
    const forkSessionAction = await commandHandler('forkSession')

    await act(async () => {
      await forkSessionAction()
    })

    expect(await screen.findByText('Entire conversation')).toBeInTheDocument()
  })

  it('lists the full session history when forking', async () => {
    mockTranscriptMessages([createUserMessage('1', 'first prompt')])
    mocks.listSessionMessages.mockResolvedValue({
      messages: [
        createUserMessage('1', 'first prompt'),
        createUserMessage('2', 'history-only prompt'),
      ],
    })

    renderSessionDetail()
    const forkSessionAction = await commandHandler('forkSession')
    await act(async () => {
      await forkSessionAction()
    })

    expect(await screen.findByText('history-only prompt')).toBeInTheDocument()
    expect(mocks.listSessionMessages).toHaveBeenCalledWith(SESSION_ID, {})
  })

  it('forks before the chosen message and pre-fills the composer', async () => {
    mockTranscriptMessages([
      createUserMessage('1', 'first prompt'),
      createUserMessage('2', 'second prompt'),
    ])
    mocks.listSessionMessages.mockResolvedValue({
      messages: [
        createUserMessage('1', 'first prompt'),
        createUserMessage('2', 'second prompt'),
      ],
    })
    mocks.forkSession.mockResolvedValue({ id: 'session-2' })
    const captured = { search: { current: '' }, pathname: { current: '' } }

    renderSessionDetail(captured)
    const forkSessionAction = await commandHandler('forkSession')
    await act(async () => {
      await forkSessionAction()
    })

    fireEvent.click(await screen.findByText('second prompt'))

    await waitFor(() => expect(mocks.forkSession).toHaveBeenCalledWith(SESSION_ID, '2'))
    expect(mocks.setPromptValue).toHaveBeenCalledWith('second prompt')
    await waitFor(() => expect(captured.pathname.current).toBe('/repos/1/sessions/session-2'))
    expect(mocks.showToast.success).toHaveBeenCalledWith('Session forked')
  })

  it('pre-fills the composer from a full-history message that is not in the loaded transcript', async () => {
    mockTranscriptMessages([createUserMessage('1', 'first prompt')])
    mocks.listSessionMessages.mockResolvedValue({
      messages: [
        createUserMessage('1', 'first prompt'),
        createUserMessage('2', 'history-only prompt'),
      ],
    })
    mocks.forkSession.mockResolvedValue({ id: 'session-2' })

    renderSessionDetail()
    const forkSessionAction = await commandHandler('forkSession')
    await act(async () => {
      await forkSessionAction()
    })

    fireEvent.click(await screen.findByText('history-only prompt'))

    await waitFor(() => expect(mocks.forkSession).toHaveBeenCalledWith(SESSION_ID, '2'))
    expect(mocks.setPromptValue).toHaveBeenCalledWith('history-only prompt')
  })

  it('forks the entire conversation from the leading option without pre-filling', async () => {
    mockTranscriptMessages([createUserMessage('1', 'first prompt')])
    mocks.forkSession.mockResolvedValue({ id: 'session-2' })

    renderSessionDetail()
    const forkSessionAction = await commandHandler('forkSession')
    await act(async () => {
      await forkSessionAction()
    })

    fireEvent.click(await screen.findByText('Entire conversation'))

    await waitFor(() => expect(mocks.forkSession).toHaveBeenCalledWith(SESSION_ID, undefined))
    expect(mocks.setPromptValue).not.toHaveBeenCalled()
  })

  it('closes the fork picker and shows an error when the history fetch fails', async () => {
    mocks.listSessionMessages.mockRejectedValueOnce(new Error('history failed'))

    renderSessionDetail()
    const forkSessionAction = await commandHandler('forkSession')
    await act(async () => {
      await forkSessionAction()
    })

    await waitFor(() => expect(mocks.showToast.error).toHaveBeenCalledWith('Failed to load messages'))
    await waitFor(() => expect(screen.queryByText('Entire conversation')).not.toBeInTheDocument())
  })

  it('jumps to the chosen message from the timeline picker', async () => {
    mockTranscriptMessages([
      createUserMessage('1', 'first prompt'),
      createUserMessage('2', 'second prompt'),
    ])

    renderSessionDetail()
    const jumpToMessage = await commandHandler('jumpToMessage')
    await act(async () => {
      await jumpToMessage()
    })

    expect(await screen.findByText('Jump to message')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('second prompt'))

    await waitFor(() => expect(mocks.scrollIntoView).toHaveBeenCalled())
    const target = document.querySelector('[data-message-id="2"]')
    expect(target).not.toBeNull()
    expect(mocks.scrollIntoView.mock.instances.at(-1)).toBe(target)
    expect(mocks.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
  })

  it('lists only the loaded transcript in the timeline picker', async () => {
    mockTranscriptMessages([createUserMessage('1', 'visible-transcript')])
    mocks.listSessionMessages.mockResolvedValue({
      messages: [createUserMessage('2', 'history-only prompt')],
    })

    renderSessionDetail()
    const jumpToMessage = await commandHandler('jumpToMessage')
    await act(async () => {
      await jumpToMessage()
    })

    expect(await screen.findByText('visible-transcript')).toBeInTheDocument()
    expect(screen.queryByText('history-only prompt')).not.toBeInTheDocument()
    expect(mocks.listSessionMessages).not.toHaveBeenCalled()
  })

  it('mounts no picker while no picker mode is active', async () => {
    renderSessionDetail()
    await waitFor(() => expect(mocks.promptInputProps).not.toBeNull())

    expect(screen.queryByText('Fork session')).not.toBeInTheDocument()
    expect(screen.queryByText('Jump to message')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search messages')).not.toBeInTheDocument()
  })

  it('opens the model picker from the showModels command action', async () => {
    renderSessionDetail()
    const showModels = await commandHandler('showModels')

    await act(async () => {
      await showModels()
    })

    expect(mocks.openModelPicker).toHaveBeenCalledTimes(1)
  })

  it('keeps commandActions referentially stable across re-renders', async () => {
    const view = renderSessionDetail()
    await waitFor(() => expect(mocks.promptInputProps).not.toBeNull())
    const firstActions = mocks.promptInputProps?.commandActions

    mockTranscriptMessages([createUserMessage('9', 'changed transcript')])
    view.rerender(sessionDetailElement())

    await waitFor(() => expect(mocks.promptInputProps?.commandActions).toBe(firstActions))
  })

  it('opens the MCP dialog from the showMcp command action', async () => {
    renderSessionDetail()
    const showMcp = await commandHandler('showMcp')

    await act(async () => {
      await showMcp()
    })

    expect(mocks.dialogSetters.mcp).toHaveBeenCalledWith(true)
  })

  it('opens the skills dialog from the showSkills command action', async () => {
    renderSessionDetail()
    const showSkills = await commandHandler('showSkills')

    await act(async () => {
      await showSkills()
    })

    expect(mocks.dialogSetters.skills).toHaveBeenCalledWith(true)
  })

  it('opens the walkthrough dialog from the showWalkthrough command action', async () => {
    renderSessionDetail()
    const showWalkthrough = await commandHandler('showWalkthrough')

    await act(async () => {
      await showWalkthrough()
    })

    expect(mocks.dialogSetters.walkthrough).toHaveBeenCalledWith(true)
  })

  it('opens settings from the showSettings command action', async () => {
    renderSessionDetail()
    const showSettings = await commandHandler('showSettings')

    await act(async () => {
      await showSettings()
    })

    expect(mocks.openSettings).toHaveBeenCalledTimes(1)
  })

  it('maps the help command to the showSettings action', () => {
    expect(BUILTIN_COMMANDS.find((command) => command.name === 'help')?.action).toBe('showSettings')
  })

  it('opens the providers tab from the connectProvider command action', async () => {
    renderSessionDetail()
    const connectProvider = await commandHandler('connectProvider')

    await act(async () => {
      await connectProvider()
    })

    expect(mocks.setSettingsTab).toHaveBeenCalledWith('providers')
  })

  it('exports complete history across pages in oldest-first order without duplicates', async () => {
    mocks.listSessionMessages.mockImplementation(
      (_sessionID: string, input: { cursor?: string } = {}) => {
        if (!input.cursor) {
          return Promise.resolve({
            messages: [
              createUserMessage('2', 'middle-marker'),
              createUserMessage('3', 'newest-marker'),
            ],
            nextCursor: 'cursor-1',
          })
        }
        return Promise.resolve({
          messages: [
            createUserMessage('1', 'oldest-marker'),
            createUserMessage('2', 'middle-marker'),
          ],
        })
      },
    )

    renderSessionDetail()
    const handler = await commandHandler('exportSession')

    await act(async () => {
      await handler()
    })

    expect(mocks.listSessionMessages).toHaveBeenCalledWith(SESSION_ID, {})
    expect(mocks.listSessionMessages).toHaveBeenCalledWith(SESSION_ID, { cursor: 'cursor-1' })
    expect(mocks.downloadMarkdown).toHaveBeenCalledTimes(1)

    const content = mocks.downloadMarkdown.mock.calls[0][0] as string
    expect(content.match(/oldest-marker/g)).toHaveLength(1)
    expect(content.match(/middle-marker/g)).toHaveLength(1)
    expect(content.match(/newest-marker/g)).toHaveLength(1)
    expect(content.indexOf('oldest-marker')).toBeLessThan(content.indexOf('middle-marker'))
    expect(content.indexOf('middle-marker')).toBeLessThan(content.indexOf('newest-marker'))
    expect(mocks.showToast.error).not.toHaveBeenCalled()
  })

  it('does not download a partial export when a later page fails', async () => {
    mocks.listSessionMessages
      .mockResolvedValueOnce({
        messages: [createUserMessage('3', 'newest-marker')],
        nextCursor: 'cursor-1',
      })
      .mockRejectedValueOnce(new Error('page fetch failed'))

    renderSessionDetail()
    const handler = await commandHandler('exportSession')

    await act(async () => {
      await handler()
    })

    expect(mocks.downloadMarkdown).not.toHaveBeenCalled()
    expect(mocks.showToast.error).toHaveBeenCalledWith('Failed to export session')
    expect(mocks.showToast.success).not.toHaveBeenCalled()
  })

  it('applies the staged-revert boundary to the complete history', async () => {
    mocks.useSession.mockReturnValue({
      data: createSession({ messageID: '2' }),
      isLoading: false,
    })
    mocks.listSessionMessages.mockImplementation(
      (_sessionID: string, input: { cursor?: string } = {}) => {
        if (!input.cursor) {
          return Promise.resolve({
            messages: [
              createUserMessage('2', 'middle-marker'),
              createUserMessage('3', 'newest-marker'),
            ],
            nextCursor: 'cursor-1',
          })
        }
        return Promise.resolve({
          messages: [createUserMessage('1', 'oldest-marker')],
        })
      },
    )

    renderSessionDetail()
    const handler = await commandHandler('exportSession')

    await act(async () => {
      await handler()
    })

    const content = mocks.downloadMarkdown.mock.calls[0][0] as string
    expect(content).toContain('oldest-marker')
    expect(content).not.toContain('middle-marker')
    expect(content).not.toContain('newest-marker')
  })
})
