import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { FormInfo } from '@opencode-manager/shared/opencode'
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
  showToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), loading: vi.fn() },
}))

const formsState = {
  bySession: {} as Record<string, FormInfo | null>,
  reply: vi.fn(),
  cancel: vi.fn(),
}

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

vi.mock('@/components/session/SessionList', () => ({
  SessionList: vi.fn(() => null),
}))

vi.mock('@/components/file-browser/FileBrowserSheet', () => ({
  FileBrowserSheet: vi.fn(() => null),
}))

vi.mock('@/components/repo/RepoMcpDialog', () => ({
  RepoMcpDialog: vi.fn(() => null),
}))

vi.mock('@/components/repo/ResetPermissionsDialog', () => ({
  ResetPermissionsDialog: vi.fn(() => null),
}))

vi.mock('@/components/repo/RepoSkillsDialog', () => ({
  RepoSkillsDialog: vi.fn(() => null),
}))

vi.mock('@/components/source-control', () => ({
  SourceControlPanel: vi.fn(() => null),
}))

vi.mock('@/components/notifications/PendingActionsGroup', () => ({
  PendingActionsGroup: vi.fn(() => null),
}))

vi.mock('@/components/message/PromptInput', () => ({
  PromptInput: vi.fn(() => <div>MockedPromptInput</div>),
}))

const VIEWED_SESSION_ID = 'viewed-session'

function createForm(id: string, sessionID: string, title: string): FormInfo {
  return {
    id,
    sessionID,
    title,
    fields: [
      { key: 'q0', title: 'Confirm', type: 'string', options: [{ value: 'Yes', label: 'Yes' }] },
    ],
  }
}

const viewedSessionForm = createForm('form-viewed', VIEWED_SESSION_ID, 'Continue A')
const otherSessionForm = createForm('form-other', 'other-session', 'Continue B')

function renderTree() {
  return (
    <MemoryRouter initialEntries={[`/repos/1/sessions/${VIEWED_SESSION_ID}`]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Routes>
          <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

describe('SessionDetail form prompt session scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    formsState.bySession = {}
    formsState.reply = vi.fn().mockResolvedValue(undefined)
    formsState.cancel = vi.fn().mockResolvedValue(undefined)

    mocks.useSession.mockReturnValue({ data: undefined, isLoading: false })
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
    mocks.usePermissions.mockReturnValue({
      pendingCount: 0,
      syncForSession: vi.fn(),
    })
    mocks.useForms.mockImplementation(() => ({
      current: null,
      getForSession: (sessionID: string) => formsState.bySession[sessionID] ?? null,
      pendingCount: 0,
      reply: formsState.reply,
      cancel: formsState.cancel,
      syncForSession: vi.fn(),
    }))
    mocks.useSSEHealth.mockReturnValue({ isHealthy: true })
    mocks.useConfig.mockReturnValue({ data: undefined, isLoading: false })
    mocks.useMobile.mockReturnValue(false)
    mocks.useAutoScroll.mockReturnValue({ scrollToBottom: vi.fn() })
    mocks.useDialogParam.mockReturnValue([false, vi.fn()])
    mocks.useSidebarAction.mockReturnValue(undefined)
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'idle' })
  })

  it('renders the viewed session form when another session owns the globally current form', async () => {
    formsState.bySession[VIEWED_SESSION_ID] = viewedSessionForm
    formsState.bySession['other-session'] = otherSessionForm

    render(renderTree())

    await waitFor(() => {
      expect(screen.getByText('Continue A')).toBeInTheDocument()
    })
  })

  it('renders no form prompt when only another session has a pending form', async () => {
    formsState.bySession['other-session'] = otherSessionForm

    render(renderTree())

    await waitFor(() => expect(screen.getByText('MockedPromptInput')).toBeInTheDocument())
    expect(screen.queryByText('Continue B')).not.toBeInTheDocument()
  })

  it('submits the viewed session form through the facade', async () => {
    formsState.bySession[VIEWED_SESSION_ID] = viewedSessionForm
    formsState.bySession['other-session'] = otherSessionForm

    render(renderTree())

    await waitFor(() => expect(screen.getByText('Continue A')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(formsState.reply).toHaveBeenCalledWith('form-viewed', { q0: 'Yes' })
    })
  })

  it('clears a minimized indicator once its form resolves elsewhere and opens the next form', async () => {
    formsState.bySession[VIEWED_SESSION_ID] = viewedSessionForm
    const { rerender } = render(renderTree())

    await waitFor(() => expect(screen.getByText('Continue A')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Continue A' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dismiss form' })).toBeInTheDocument())

    formsState.bySession[VIEWED_SESSION_ID] = null
    rerender(renderTree())
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Dismiss form' })).not.toBeInTheDocument(),
    )

    formsState.bySession[VIEWED_SESSION_ID] = otherSessionForm
    rerender(renderTree())
    await waitFor(() => expect(screen.getByText('Continue B')).toBeInTheDocument())
  })

  it('dismisses a minimized form locally and then opens the next form', async () => {
    formsState.bySession[VIEWED_SESSION_ID] = viewedSessionForm
    formsState.cancel.mockImplementation(async () => {
      formsState.bySession[VIEWED_SESSION_ID] = null
    })
    const { rerender } = render(renderTree())

    await waitFor(() => expect(screen.getByText('Continue A')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Continue A' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss form' }))

    await waitFor(() => expect(formsState.cancel).toHaveBeenCalledWith('form-viewed'))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Dismiss form' })).not.toBeInTheDocument(),
    )

    formsState.bySession[VIEWED_SESSION_ID] = otherSessionForm
    rerender(renderTree())
    await waitFor(() => expect(screen.getByText('Continue B')).toBeInTheDocument())
  })

  it('retains a minimized form and reports an error when dismissal fails', async () => {
    formsState.bySession[VIEWED_SESSION_ID] = viewedSessionForm
    formsState.cancel.mockRejectedValue(new Error('boom'))
    render(renderTree())

    await waitFor(() => expect(screen.getByText('Continue A')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Continue A' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss form' }))

    await waitFor(() =>
      expect(mocks.showToast.error).toHaveBeenCalledWith('Failed to dismiss form'),
    )
    expect(screen.getByRole('button', { name: 'Dismiss form' })).toBeInTheDocument()
  })
})
