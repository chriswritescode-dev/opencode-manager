import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Chat } from '@opencode-manager/shared/schemas'
import { ChatsNavGroup } from './ChatsNavGroup'

type SessionFixture = {
  id: string
  projectID: string
  title: string
  time: { created: number; updated: number; archived?: number }
  location: { directory: string }
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

const mocks = vi.hoisted(() => ({
  listChats: vi.fn(),
  createChat: vi.fn(),
  sessionsData: [] as SessionFixture[],
  useSessionsAcrossDirectories: vi.fn(),
  useSessionPins: vi.fn(),
  showToast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/api/chats', () => ({
  listChats: mocks.listChats,
  createChat: mocks.createChat,
}))

vi.mock('@/hooks/useOpenCode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOpenCode')>()
  return {
    ...actual,
    useSessionsAcrossDirectories: mocks.useSessionsAcrossDirectories,
    removeDeletedSessionsFromListCaches: vi.fn(),
    cleanupSessionPins: vi.fn(),
  }
})

vi.mock('@/hooks/useSessionPins', () => ({
  SESSION_PINS_QUERY_KEY: ['session-pins'],
  useSessionPins: mocks.useSessionPins,
}))

vi.mock('@/lib/toast', () => ({ showToast: mocks.showToast }))

vi.mock('@/contexts/EventContext', () => ({
  usePermissions: () => ({ hasForSession: () => false }),
  useForms: () => ({ hasForSession: () => false }),
}))

function chat(id: string, directory: string): Chat {
  return { id, directory, filesPath: `${directory}/files`, createdAt: 1000 }
}

function createSession(id: string, directory: string, updated = Date.now()): SessionFixture {
  return {
    id,
    projectID: 'proj-1',
    title: `Session ${id}`,
    time: { created: updated - 10000, updated },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

const chatA = chat('20240103120000-aaaaaa', '/chats/a')
const chatB = chat('20240102120000-bbbbbb', '/chats/b')
const chatC = chat('20240101120000-cccccc', '/chats/c')
const chatD = chat('20231231120000-dddddd', '/chats/d')
const chatE = chat('20231230120000-eeeeee', '/chats/e')
const chatF = chat('20231229120000-ffffff', '/chats/f')

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function createWrapper(initialEntries: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        {children}
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const chatRows = () => screen.getAllByText(/^Session /).map((row) => row.textContent)

describe('ChatsNavGroup', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.listChats.mockReset()
    mocks.createChat.mockReset()
    mocks.sessionsData.splice(
      0,
      mocks.sessionsData.length,
      createSession('a1', '/chats/a'),
      createSession('b1', '/chats/b'),
      createSession('c1', '/chats/c'),
      createSession('d1', '/chats/d'),
      createSession('e1', '/chats/e'),
      createSession('f1', '/chats/f'),
    )
    mocks.listChats.mockImplementation(async ({ cursor }: { cursor?: string }) => {
      if (cursor === 'cursor_2') return { chats: [chatD, chatE, chatF] }
      return { chats: [chatA, chatB, chatC], nextCursor: 'cursor_2' }
    })
    mocks.createChat.mockResolvedValue({
      chat: chat('20240104120000-111111', '/chats/new'),
      sessionId: 'ses_new',
    })
    mocks.useSessionsAcrossDirectories.mockImplementation((directories: string[]) => ({
      data: mocks.sessionsData.filter((session) => directories.includes(session.location.directory)),
      isLoading: false,
      isError: false,
      error: null,
    }))
    mocks.useSessionPins.mockReturnValue({ data: [] })
    mocks.showToast.success.mockReset()
    mocks.showToast.error.mockReset()
  })

  it('lists the newest chats and loads the next page with Show more', async () => {
    const user = userEvent.setup()
    render(<ChatsNavGroup />, { wrapper: createWrapper(['/']) })

    await screen.findByRole('button', { name: /^Session a1/ })
    expect(chatRows()).toEqual(['Session a1', 'Session b1', 'Session c1'])
    expect(mocks.listChats).toHaveBeenCalledWith({ limit: 3, cursor: undefined })

    await user.click(screen.getByText('Show more'))

    await waitFor(() => expect(chatRows()).toHaveLength(6))
    expect(chatRows()).toEqual([
      'Session a1',
      'Session b1',
      'Session c1',
      'Session d1',
      'Session e1',
      'Session f1',
    ])
    expect(mocks.listChats).toHaveBeenLastCalledWith({ limit: 3, cursor: 'cursor_2' })
    expect(screen.queryByText('Show more')).toBeNull()
  })

  it('creates a chat and opens its session from the + button', async () => {
    const user = userEvent.setup()
    render(<ChatsNavGroup />, { wrapper: createWrapper(['/']) })

    await screen.findByRole('button', { name: /^Session a1/ })
    await user.click(screen.getByRole('button', { name: 'New chat' }))

    await waitFor(() => expect(mocks.createChat).toHaveBeenCalledWith({}))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/chats/20240104120000-111111/sessions/ses_new',
      ),
    )
  })

  it('folds the group and keeps that choice for the next mount', async () => {
    const user = userEvent.setup()
    const firstRender = render(<ChatsNavGroup />, { wrapper: createWrapper(['/']) })

    await screen.findByRole('button', { name: /^Session a1/ })
    expect(screen.getByRole('button', { name: 'Show sessions in Chats' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Show sessions in Chats' }))

    expect(screen.getByRole('button', { name: 'Show sessions in Chats' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('button', { name: /^Session a1/ })).toBeNull()

    firstRender.unmount()
    render(<ChatsNavGroup />, { wrapper: createWrapper(['/']) })

    expect(screen.getByRole('button', { name: 'Show sessions in Chats' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('button', { name: /^Session a1/ })).toBeNull()
  })

  it('marks the open chat session and group as current', async () => {
    render(<ChatsNavGroup />, {
      wrapper: createWrapper([`/chats/${chatA.id}/sessions/a1`]),
    })

    expect(await screen.findByRole('button', { name: /^Session a1/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('button', { name: /^Session b1/ })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Chats' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows an empty state when there are no chats', async () => {
    mocks.listChats.mockResolvedValue({ chats: [] })

    render(<ChatsNavGroup />, { wrapper: createWrapper(['/']) })

    expect(await screen.findByText('No chats')).toBeTruthy()
  })
})
