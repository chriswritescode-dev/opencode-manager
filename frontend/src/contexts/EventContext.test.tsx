import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionRequest, QuestionRequest } from '@/api/types'
import { EventProvider, usePermissions, useQuestions, useSSEHealth } from './EventContext'

const mocks = vi.hoisted(() => ({
  listRepos: vi.fn(),
  listPendingPermissions: vi.fn(),
  listPendingQuestions: vi.fn(),
  replyToQuestion: vi.fn(),
  rejectQuestion: vi.fn(),
  subscribeGlobalMonitor: vi.fn(),
  getHealth: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  listRepos: mocks.listRepos,
}))

vi.mock('@/api/opencode', () => ({
  OpenCodeClient: vi.fn(() => ({
    listPendingPermissions: mocks.listPendingPermissions,
    listPendingQuestions: mocks.listPendingQuestions,
    replyToQuestion: mocks.replyToQuestion,
    rejectQuestion: mocks.rejectQuestion,
  })),
}))

vi.mock('@/lib/opencode-event-stream', () => ({
  openCodeEventStream: {
    subscribeGlobalMonitor: mocks.subscribeGlobalMonitor,
    getHealth: mocks.getHealth,
  },
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))

const pendingQuestion: QuestionRequest = {
  id: 'question-1',
  sessionID: 'session-1',
  questions: [
    {
      question: 'Continue?',
      header: 'Confirm',
      options: [
        {
          label: 'Yes',
          description: 'Continue',
        },
      ],
      multiple: false,
    },
  ],
}

const secondPendingQuestion: QuestionRequest = {
  id: 'question-2',
  sessionID: 'session-2',
  questions: [
    {
      question: 'Deploy?',
      header: 'Deploy',
      options: [
        {
          label: 'Yes',
          description: 'Deploy changes',
        },
      ],
      multiple: false,
    },
  ],
}

const pendingPermission: PermissionRequest = {
  id: 'permission-1',
  sessionID: 'session-1',
  permission: 'bash',
  patterns: ['echo hello'],
  metadata: {},
  always: [],
  tool: {
    messageID: 'message-1',
    callID: 'call-1',
  },
}

function Harness() {
  const { current, pendingCount, syncForSession, navigateToCurrent, reject, reply } = useQuestions()
  const permissions = usePermissions()
  const permissionForCall = permissions.getForCallID('call-1', 'session-1')
  const location = useLocation()

  return (
    <div>
      <div data-testid="count">{pendingCount}</div>
      <div data-testid="current">{current?.id ?? 'none'}</div>
      <div data-testid="permission-count">{permissions.pendingCount}</div>
      <div data-testid="permission-current">{permissions.current?.id ?? 'none'}</div>
      <div data-testid="permission-call">{permissionForCall?.id ?? 'none'}</div>
      <div data-testid="path">{location.pathname}</div>
      <button onClick={() => syncForSession('/repo', 'session-1')}>Sync</button>
      <button onClick={() => permissions.syncForSession('/repo', 'session-1')}>Sync Permissions</button>
      <button onClick={navigateToCurrent}>Navigate</button>
      <button onClick={() => current && reject(current.id)}>Dismiss</button>
      <button onClick={() => current && reply(current.id, [['Yes']])}>Reply</button>
    </div>
  )
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <EventProvider>{children}</EventProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

describe('EventProvider questions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listRepos.mockResolvedValue([])
    mocks.listPendingPermissions.mockResolvedValue([])
    mocks.listPendingQuestions.mockResolvedValue([])
    mocks.replyToQuestion.mockResolvedValue(undefined)
    mocks.rejectQuestion.mockResolvedValue(undefined)
    mocks.getHealth.mockReturnValue({ isConnected: false, isHealthy: false, lastEventAt: null, isStalled: false })
    mocks.subscribeGlobalMonitor.mockReturnValue({
      dispose: vi.fn(),
      updateDirectories: vi.fn(),
      reconnect: vi.fn(),
      reportVisibility: vi.fn(),
    })
  })

  it('syncs missed pending questions for a session', async () => {
    mocks.listPendingQuestions.mockResolvedValue([pendingQuestion])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      expect(screen.getByTestId('current')).toHaveTextContent('question-1')
    })
  })

  it('syncs missed pending permissions for a session', async () => {
    mocks.listPendingPermissions.mockResolvedValue([pendingPermission])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
      expect(screen.getByTestId('permission-call')).toHaveTextContent('permission-1')
    })
  })

  it('clears stale pending permissions for a session', async () => {
    mocks.listPendingPermissions
      .mockResolvedValueOnce([pendingPermission])
      .mockResolvedValueOnce([])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('0')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('none')
    })
  })

  it('clears stale pending questions for a session', async () => {
    mocks.listPendingQuestions
      .mockResolvedValueOnce([pendingQuestion])
      .mockResolvedValueOnce([])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('reconciles pending questions for the whole directory', async () => {
    mocks.listPendingQuestions
      .mockResolvedValueOnce([pendingQuestion, secondPendingQuestion])
      .mockResolvedValueOnce([pendingQuestion])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('2')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      expect(screen.getByTestId('current')).toHaveTextContent('question-1')
    })
  })

  it('reconciles stale pending questions after reconnect', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPendingQuestions
      .mockResolvedValueOnce([pendingQuestion])
      .mockResolvedValueOnce([])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void
    handleStatusChange(true)

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('navigates to a synced pending question without session query cache', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPendingQuestions.mockResolvedValue([pendingQuestion])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('current')).toHaveTextContent('question-1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Navigate' }))

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/repos/123/sessions/session-1')
    })
  })

  it('clears a pending question after dismiss succeeds', async () => {
    mocks.listPendingQuestions.mockResolvedValue([pendingQuestion])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('clears a pending question after reply succeeds', async () => {
    mocks.listPendingQuestions.mockResolvedValue([pendingQuestion])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Reply' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('exposes sseHealth through context', async () => {
    mocks.getHealth.mockReturnValue({ isConnected: true, isHealthy: true, lastEventAt: Date.now(), isStalled: false })
    mocks.subscribeGlobalMonitor.mockImplementation(({ onHealthChange }) => {
      onHealthChange({ isConnected: false, isHealthy: false, lastEventAt: null, isStalled: false })
      return {
        dispose: vi.fn(),
        updateDirectories: vi.fn(),
        reconnect: vi.fn(),
        reportVisibility: vi.fn(),
      }
    })

    const TestComponent = () => {
      const { isConnected, isHealthy, isStalled } = useSSEHealth()
      return (
        <div>
          <div data-testid="connected">{String(isConnected)}</div>
          <div data-testid="healthy">{String(isHealthy)}</div>
          <div data-testid="stalled">{String(isStalled)}</div>
        </div>
      )
    }

    render(<TestComponent />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('connected')).toHaveTextContent('false')
      expect(screen.getByTestId('healthy')).toHaveTextContent('false')
    })
  })
})
