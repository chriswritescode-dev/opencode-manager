import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TerminalInfo } from '@opencode-manager/shared/types'
import type { Repo } from '@/api/types'
import { AssistantRedirect } from '../AssistantRedirect'

const mocks = vi.hoisted(() => ({
  getRepo: vi.fn(),
  useSSE: vi.fn(),
  useCreateSession: vi.fn(),
  useTerminals: vi.fn(),
  useCreateTerminal: vi.fn(),
  useRemoveTerminal: vi.fn(),
  usePreviewPorts: vi.fn(),
  createPreviewSession: vi.fn(),
}))

vi.mock('@/api/repos', () => ({ getRepo: mocks.getRepo }))
vi.mock('@/hooks/useSSE', () => ({ useSSE: mocks.useSSE }))
vi.mock('@/hooks/useOpenCode', () => ({ useCreateSession: mocks.useCreateSession }))
vi.mock('@/api/terminals', () => ({
  useTerminals: mocks.useTerminals,
  useCreateTerminal: mocks.useCreateTerminal,
  useRemoveTerminal: mocks.useRemoveTerminal,
}))
vi.mock('@/api/preview', () => ({
  usePreviewPorts: mocks.usePreviewPorts,
  createPreviewSession: mocks.createPreviewSession,
}))

vi.mock('@/components/session/SessionList', () => ({ SessionList: () => null }))
vi.mock('@/components/file-browser/FileBrowserSheet', () => ({ FileBrowserSheet: () => null }))
vi.mock('@/components/repo/RepoMcpDialog', () => ({ RepoMcpDialog: () => null }))
vi.mock('@/components/repo/RepoSkillsDialog', () => ({ RepoSkillsDialog: () => null }))
vi.mock('@/components/repo/ResetPermissionsDialog', () => ({ ResetPermissionsDialog: () => null }))
vi.mock('@/components/source-control', () => ({ SourceControlPanel: () => null }))
vi.mock('@/components/notifications/PendingActionsGroup', () => ({ PendingActionsGroup: () => null }))

vi.mock('@/components/terminal/TerminalView', async () => {
  const React = await import('react')
  return {
    TerminalView: React.forwardRef(function MockTerminalView(
      props: { ptyID: string; onOpenLink?: (uri: string) => void },
      ref: React.Ref<unknown>,
    ) {
      React.useImperativeHandle(ref, () => ({ send: vi.fn() }))
      return React.createElement(
        'div',
        { 'data-testid': 'terminal-view', 'data-pty-id': props.ptyID },
        React.createElement(
          'button',
          { type: 'button', onClick: () => props.onOpenLink?.('http://localhost:5173/dashboard') },
          'local-link',
        ),
        React.createElement(
          'button',
          { type: 'button', onClick: () => props.onOpenLink?.('https://example.com/docs') },
          'external-link',
        ),
      )
    }),
  }
})

const assistantDirectory = '/abs/assistant'
const baseRepo: Repo = {
  id: 0,
  name: 'Assistant',
  localPath: 'assistant',
  fullPath: assistantDirectory,
  defaultBranch: 'main',
  currentBranch: 'main',
  branch: 'main',
  cloneStatus: 'ready',
  clonedAt: 1,
  isWorktree: false,
}

const runningTerminal: TerminalInfo = {
  id: 't1',
  title: 'Terminal',
  kind: 'shell',
  cwd: assistantDirectory,
  status: 'running',
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderAssistantRedirect(initialEntry = '/assistant?dialog=terminal') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <AssistantRedirect />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AssistantRedirect preview routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRepo.mockResolvedValue(baseRepo)
    mocks.useSSE.mockReturnValue(undefined)
    mocks.useCreateSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    mocks.useTerminals.mockReturnValue({
      data: [runningTerminal],
      isLoading: false,
      isSuccess: true,
      refetch: vi.fn(),
    })
    mocks.useCreateTerminal.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useRemoveTerminal.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.usePreviewPorts.mockReturnValue({
      data: {
        enabled: true,
        ports: [{ port: 5173, host: '127.0.0.1', pid: 10, command: 'vite', cwd: assistantDirectory, inDirectory: true }],
      },
      isLoading: false,
      refetch: vi.fn(),
    })
    mocks.createPreviewSession.mockResolvedValue({ token: 'tok', previewPort: 5004, publicUrl: null })
  })

  it('opens preview in the docked panel when a terminal localhost link is followed', async () => {
    const user = userEvent.setup()
    renderAssistantRedirect()

    await user.click(await screen.findByRole('button', { name: 'local-link' }))

    const iframe = await waitFor(() => {
      const element = document.querySelector('iframe[title="Preview"]')
      expect(element).not.toBeNull()
      return element as HTMLIFrameElement
    })
    expect(iframe.getAttribute('src')).toContain('token=tok')
    expect(iframe.getAttribute('src')).toContain('path=%2Fdashboard')
    expect(mocks.createPreviewSession).toHaveBeenCalledWith(5173)

    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('panel=preview')
    expect(location).toContain('previewPort=5173')
    expect(location).toContain('previewPath=%2Fdashboard')
  })

  it('opens external terminal links in a new tab without mounting the preview panel', async () => {
    const user = userEvent.setup()
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    renderAssistantRedirect()

    await user.click(await screen.findByRole('button', { name: 'external-link' }))

    expect(openSpy).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer')
    expect(mocks.createPreviewSession).not.toHaveBeenCalled()
    expect(document.querySelector('iframe[title="Preview"]')).toBeNull()
    expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toContain('panel=terminal')
  })
})
