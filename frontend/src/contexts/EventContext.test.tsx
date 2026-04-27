import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionRequest } from '@/api/types'
import { EventProvider, useQuestions } from './EventContext'

const mocks = vi.hoisted(() => ({
  listRepos: vi.fn(),
  listPendingPermissions: vi.fn(),
  listPendingQuestions: vi.fn(),
  subscribeToSSE: vi.fn(),
  addSSEDirectory: vi.fn(),
  ensureSSEConnected: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  listRepos: mocks.listRepos,
}))

vi.mock('@/api/opencode', () => ({
  OpenCodeClient: vi.fn(() => ({
    listPendingPermissions: mocks.listPendingPermissions,
    listPendingQuestions: mocks.listPendingQuestions,
  })),
}))

vi.mock('@/lib/sseManager', () => ({
  subscribeToSSE: mocks.subscribeToSSE,
  addSSEDirectory: mocks.addSSEDirectory,
  ensureSSEConnected: mocks.ensureSSEConnected,
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

function Harness() {
  const { current, pendingCount, syncForSession, navigateToCurrent } = useQuestions()
  const location = useLocation()

  return (
    <div>
      <div data-testid="count">{pendingCount}</div>
      <div data-testid="current">{current?.id ?? 'none'}</div>
      <div data-testid="path">{location.pathname}</div>
      <button onClick={() => syncForSession('/repo', 'session-1')}>Sync</button>
      <button onClick={navigateToCurrent}>Navigate</button>
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
    mocks.subscribeToSSE.mockReturnValue(() => {})
    mocks.addSSEDirectory.mockReturnValue(() => {})
    mocks.ensureSSEConnected.mockResolvedValue(true)
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
})
