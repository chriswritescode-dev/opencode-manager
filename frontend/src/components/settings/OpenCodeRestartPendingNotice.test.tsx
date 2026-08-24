import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OpenCodeRestartPendingNotice } from './OpenCodeRestartPendingNotice'

const {
  mockRestartOpenCodeServer,
  mockGetActiveOpenCodeSessions,
  healthState,
} = vi.hoisted(() => ({
  mockRestartOpenCodeServer: vi.fn(),
  mockGetActiveOpenCodeSessions: vi.fn(),
  healthState: { data: { opencode: 'healthy', opencodeRestartPending: false } as Record<string, unknown> },
}))

vi.mock('@/hooks/useServerHealth', () => ({
  useServerHealth: () => healthState,
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    restartOpenCodeServer: mockRestartOpenCodeServer,
    getActiveOpenCodeSessions: mockGetActiveOpenCodeSessions,
  },
}))

const NOTICE_TEXT = 'Configuration changes are saved but require a server restart to take effect.'

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('OpenCodeRestartPendingNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    healthState.data = { opencode: 'healthy', opencodeRestartPending: false }
    mockRestartOpenCodeServer.mockResolvedValue({ success: true, message: 'ok' })
    mockGetActiveOpenCodeSessions.mockResolvedValue({ count: 2, sessions: [] })
  })

  it('renders nothing when no restart is pending', () => {
    renderWithQuery(<OpenCodeRestartPendingNotice />)

    expect(screen.queryByText(NOTICE_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restart now/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()
  })

  it('auto-opens the restart dialog when the pending flag flips to true', async () => {
    const { rerender } = renderWithQuery(<OpenCodeRestartPendingNotice />)
    expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()

    healthState.data = { opencode: 'healthy', opencodeRestartPending: true }
    rerender(<OpenCodeRestartPendingNotice />)

    expect(await screen.findByText('Restart OpenCode Server?')).toBeInTheDocument()
    expect(screen.getByText(/2 sessions are currently working/i)).toBeInTheDocument()
    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument()
    expect(mockGetActiveOpenCodeSessions).toHaveBeenCalledTimes(1)
  })

  it('closes the dialog with "Later" without issuing a restart', async () => {
    healthState.data = { opencode: 'healthy', opencodeRestartPending: true }
    const user = userEvent.setup()
    renderWithQuery(<OpenCodeRestartPendingNotice />)

    await screen.findByText('Restart OpenCode Server?')
    await user.click(screen.getByRole('button', { name: /later/i }))

    await waitFor(() => {
      expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()
    })
    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument()
    expect(mockRestartOpenCodeServer).not.toHaveBeenCalled()
  })

  it('restarts exactly once via the notice button plus dialog confirmation', async () => {
    healthState.data = { opencode: 'healthy', opencodeRestartPending: true }
    const user = userEvent.setup()
    renderWithQuery(<OpenCodeRestartPendingNotice />)

    await screen.findByText('Restart OpenCode Server?')
    await user.click(screen.getByRole('button', { name: /later/i }))
    await waitFor(() => {
      expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /restart now/i }))
    expect(await screen.findByText('Restart OpenCode Server?')).toBeInTheDocument()
    expect(mockGetActiveOpenCodeSessions).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: /restart now/i }))
    await waitFor(() => {
      expect(mockRestartOpenCodeServer).toHaveBeenCalledTimes(1)
    })
  })

  it('does not re-open a dismissed dialog on re-render while the flag stays true', async () => {
    healthState.data = { opencode: 'healthy', opencodeRestartPending: true }
    const user = userEvent.setup()
    const { rerender } = renderWithQuery(<OpenCodeRestartPendingNotice />)

    await screen.findByText('Restart OpenCode Server?')
    await user.click(screen.getByRole('button', { name: /later/i }))
    await waitFor(() => {
      expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()
    })

    rerender(<OpenCodeRestartPendingNotice />)

    expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()
    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument()
    expect(mockGetActiveOpenCodeSessions).toHaveBeenCalledTimes(1)
    expect(mockRestartOpenCodeServer).not.toHaveBeenCalled()
  })
})
