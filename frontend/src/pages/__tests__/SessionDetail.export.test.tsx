import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { SessionDetail } from '../SessionDetail'

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
  useDialogParam: vi.fn(),
  useSidebarAction: vi.fn(),
  useSessionStatusForSession: vi.fn(),
  listSessionMessages: vi.fn(),
  downloadMarkdown: vi.fn(),
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  },
  PromptInput: vi.fn(),
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
    listSessionMessages: mocks.listSessionMessages,
  }
})

vi.mock('@/lib/exportSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/exportSession')>()
  return {
    ...actual,
    downloadMarkdown: mocks.downloadMarkdown,
  }
})

vi.mock('@/lib/toast', () => ({
  showToast: mocks.showToast,
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSession: mocks.useSession,
  useInterruptSession: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateSession: vi.fn(() => ({ mutate: vi.fn() })),
  useCreateSession: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useConfig: mocks.useConfig,
  useSendPrompt: vi.fn(() => ({ mutate: vi.fn() })),
  useSendShell: vi.fn(() => ({ mutate: vi.fn() })),
  useAgents: vi.fn(() => ({ data: [] })),
}))

vi.mock('@/hooks/useSessionTranscript', () => ({
  useSessionTranscript: mocks.useSessionTranscript,
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useModelSelection: vi.fn(() => ({ model: null, modelString: null })),
}))

vi.mock('@/hooks/useTTS', () => ({
  useTTS: vi.fn(() => ({ isEnabled: false })),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(() => ({
    preferences: { expandToolCalls: false },
    updateSettings: vi.fn(),
  })),
}))

vi.mock('@/hooks/useSettingsDialog', () => ({
  useSettingsDialog: vi.fn(() => ({ open: vi.fn() })),
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
  useSwipeBack: vi.fn(() => ({ ref: vi.fn() })),
}))

vi.mock('@/hooks/useVisualViewport', () => ({
  useVisualViewport: vi.fn(() => ({ keyboardHeight: 0 })),
}))

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(() => ({ leaderActive: false })),
}))

vi.mock('@/hooks/useAutoScroll', () => ({
  useAutoScroll: mocks.useAutoScroll,
}))

vi.mock('@/hooks/useDialogParam', () => ({
  useDialogParam: vi.fn(() => [false, vi.fn()]),
}))

vi.mock('@/hooks/useSidebarAction', () => ({
  useSidebarAction: vi.fn(() => {}),
}))

vi.mock('@/hooks/useAutoPlayLastResponse', () => ({
  getAssistantText: vi.fn(() => ''),
  getLatestPlayableAssistantMessage: vi.fn(() => null),
  useAutoPlayLastResponse: vi.fn(() => {}),
}))

vi.mock('@/stores/uiStateStore', () => ({
  useUIState: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    typeof selector === 'function'
      ? selector({ isEditingMessage: false, setActivePromptFileBasePath: vi.fn() })
      : false
  ),
}))

vi.mock('@/stores/sessionStatusStore', () => ({
  useSessionStatus: vi.fn(() => ({ setStatus: vi.fn() })),
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

vi.mock('@/components/session/SessionList', () => ({ SessionList: vi.fn(() => null) }))
vi.mock('@/components/file-browser/FileBrowserSheet', () => ({ FileBrowserSheet: vi.fn(() => null) }))
vi.mock('@/components/repo/RepoMcpDialog', () => ({ RepoMcpDialog: vi.fn(() => null) }))
vi.mock('@/components/repo/ResetPermissionsDialog', () => ({ ResetPermissionsDialog: vi.fn(() => null) }))
vi.mock('@/components/repo/RepoSkillsDialog', () => ({ RepoSkillsDialog: vi.fn(() => null) }))
vi.mock('@/components/source-control', () => ({ SourceControlPanel: vi.fn(() => null) }))
vi.mock('@/components/session/FormPrompt', () => ({ FormPrompt: vi.fn(() => null) }))
vi.mock('@/components/session/MinimizedFormIndicator', () => ({ MinimizedFormIndicator: vi.fn(() => null) }))
vi.mock('@/components/notifications/PendingActionsGroup', () => ({ PendingActionsGroup: vi.fn(() => null) }))
vi.mock('@/components/message/MessageThread', () => ({ MessageThread: vi.fn(() => null) }))
vi.mock('@/components/message/PromptInput', () => ({ PromptInput: mocks.PromptInput }))

const SESSION_ID = 'session-1'

function createUserMessage(id: string, text: string): SessionMessageInfo {
  return {
    id,
    type: 'user',
    text,
    time: { created: 1000 },
  } as SessionMessageInfo
}

const createSession = (revert?: { messageID: string }) => ({
  id: SESSION_ID,
  title: 'Export Session',
  time: { created: 1000, updated: 2000 },
  location: { directory: '/test/repo' },
  ...(revert ? { revert } : {}),
})

describe('SessionDetail export history', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useSession.mockReturnValue({ data: createSession(), isLoading: false })
    mocks.useSessionTranscript.mockReturnValue({
      messages: [createUserMessage('4', 'visible-transcript-only')],
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
    mocks.useDialogParam.mockReturnValue([false, vi.fn()])
    mocks.useSidebarAction.mockReturnValue(undefined)
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'idle' })
    mocks.downloadMarkdown.mockResolvedValue(true)
  })

  const renderSessionDetail = () =>
    render(
      <MemoryRouter initialEntries={[`/repos/1/sessions/${SESSION_ID}`]}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Routes>
            <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

  const exportHandler = async () => {
    await waitFor(() => expect(mocks.PromptInput).toHaveBeenCalled())
    const props = mocks.PromptInput.mock.calls.at(-1)?.[0] as { onExportSession?: () => Promise<void> }
    expect(props.onExportSession).toBeTypeOf('function')
    return props.onExportSession!
  }

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
    const handler = await exportHandler()

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
    const handler = await exportHandler()

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
    const handler = await exportHandler()

    await act(async () => {
      await handler()
    })

    const content = mocks.downloadMarkdown.mock.calls[0][0] as string
    expect(content).toContain('oldest-marker')
    expect(content).not.toContain('middle-marker')
    expect(content).not.toContain('newest-marker')
  })
})
