import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionList } from './SessionList'

const { createSessionMock, deleteSessionMock, sessionsData, createSessionState, fetchNextPageMock, hasNextPageRef, isFetchingNextPageRef, lastSessionsHookArgs, sessionPinsData, togglePinMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  sessionsData: [] as Array<{ id: string; title: string; directory: string; workspaceID?: string; parentID?: string; time: { updated: number } }>,
  createSessionState: { directory: undefined as string | undefined },
  fetchNextPageMock: vi.fn(),
  hasNextPageRef: { current: false },
  isFetchingNextPageRef: { current: false },
  lastSessionsHookArgs: { current: undefined as { opcodeUrl: string; directories: string[]; options?: { search?: string; limit?: number } } | undefined },
  sessionPinsData: [] as Array<{ sessionId: string; directory: string; pinnedAt: number }>,
  togglePinMock: vi.fn(),
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSessionsAcrossDirectories: (opcodeUrl: string, directories: string[], options?: { search?: string; limit?: number }) => {
    lastSessionsHookArgs.current = { opcodeUrl, directories, options }
    // Simulate server-side search: return empty data when a search query is active
    const data = options?.search ? [] : sessionsData
    return {
      data,
      isLoading: false,
      fetchNextPage: fetchNextPageMock,
      hasNextPage: hasNextPageRef.current,
      isFetchingNextPage: isFetchingNextPageRef.current,
    }
  },
  useCreateSession: (_opcodeUrl: string, directory?: string) => {
    createSessionState.directory = directory
    return { mutate: createSessionMock }
  },
  useDeleteSession: () => ({ mutateAsync: deleteSessionMock, isPending: false }),
}))

vi.mock('@/hooks/useSessionPins', () => ({
  useSessionPins: () => ({ data: sessionPinsData }),
  useToggleSessionPin: () => ({ mutate: togglePinMock }),
}))

describe('SessionList', () => {
  beforeEach(() => {
    sessionsData.splice(0, sessionsData.length,
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', directory: '/w/a', workspaceID: 'wrk_a', time: { updated: Date.now() } },
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', directory: '/w/b', workspaceID: 'wrk_b', time: { updated: Date.now() } },
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', directory: '/w/c', workspaceID: 'wrk_c', time: { updated: Date.now() } },
    )
    createSessionMock.mockReset()
    createSessionState.directory = undefined
    deleteSessionMock.mockReset()
    deleteSessionMock.mockResolvedValue(undefined)
    fetchNextPageMock.mockReset()
    hasNextPageRef.current = false
    isFetchingNextPageRef.current = false
    lastSessionsHookArgs.current = undefined
    sessionPinsData.splice(0, sessionPinsData.length)
    togglePinMock.mockReset()
  })

  it('selects duplicate session IDs independently by workspace directory', async () => {
    const user = userEvent.setup()

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a', '/w/b', '/w/c']}
        onSelectSession={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Manage sessions' }))
    await user.click(screen.getByRole('button', { name: 'Select All' }))

    expect(screen.getByText('3 selected')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog', { name: 'Delete Sessions' })
    expect(dialog).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleteSessionMock).toHaveBeenCalledWith([
        { id: 'ses_same', directory: '/w/a', workspaceID: 'wrk_a' },
        { id: 'ses_same', directory: '/w/b', workspaceID: 'wrk_b' },
        { id: 'ses_same', directory: '/w/c', workspaceID: 'wrk_c' },
      ])
    })
  })

  it('deduplicates repeated session records from the same workspace directory', async () => {
    const user = userEvent.setup()
    sessionsData.splice(0, sessionsData.length,
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', directory: '/w/a', time: { updated: Date.now() } },
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', directory: '/w/a', time: { updated: Date.now() } },
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', directory: '/w/a', time: { updated: Date.now() } },
    )

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a', '/w/a', '/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getAllByText('audit: mic-warmup 1/2 #2')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Manage sessions' }))
    await user.click(screen.getByRole('button', { name: 'Select All' }))

    expect(screen.getByText('1 selected')).toBeTruthy()
  })

  it('creates sessions in the explicit create directory', async () => {
    const user = userEvent.setup()
    sessionsData.splice(0, sessionsData.length)

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a', '/w/b']}
        createDirectory="/w/b"
        onSelectSession={vi.fn()}
      />,
    )

    await user.click(screen.getByText('No sessions yet'))

    expect(createSessionState.directory).toBe('/w/b')
    expect(createSessionMock).toHaveBeenCalledWith({ agent: undefined })
  })

  it('passes search query and limit option to useSessionsAcrossDirectories', async () => {
    const user = userEvent.setup()

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    const searchInput = screen.getByPlaceholderText('Search sessions...')
    await user.type(searchInput, 'deploy')

    await waitFor(() => {
      expect(lastSessionsHookArgs.current?.options?.search).toBe('deploy')
      expect(lastSessionsHookArgs.current?.options?.limit).toBe(25)
    })
  })

  it('fetches next page when scrolling near the bottom and hasNextPage is true', async () => {
    hasNextPageRef.current = true

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    const scrollContainer = screen.getByRole('region', { name: 'Sessions' })
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 300, configurable: true })

    fireEvent.scroll(scrollContainer)

    await waitFor(() => {
      expect(fetchNextPageMock).toHaveBeenCalled()
    })
  })

  it('does not fetch next page on scroll when isFetchingNextPage is true', async () => {
    hasNextPageRef.current = true
    isFetchingNextPageRef.current = true

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    const scrollContainer = screen.getByRole('region', { name: 'Sessions' })
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 300, configurable: true })

    fireEvent.scroll(scrollContainer)

    await waitFor(() => {
      expect(fetchNextPageMock).not.toHaveBeenCalled()
    })
  })

  it('shows search-results empty state instead of create-session card when search returns no results', async () => {
    const user = userEvent.setup()
    // Default beforeEach data has 3 sessions; typing search triggers mock to return empty data

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    await user.type(screen.getByPlaceholderText('Search sessions...'), 'nonexistent')

    await waitFor(() => {
      expect(screen.getByText('No sessions found')).toBeTruthy()
    })
    expect(screen.queryByText('No sessions yet')).toBeNull()
    expect(screen.queryByText('Click here to start a new session')).toBeNull()
  })

  it('shows create-session card when there are no sessions and no active search', () => {
    sessionsData.splice(0, sessionsData.length)

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getByText('No sessions yet')).toBeTruthy()
    expect(screen.getByText('Click here to start a new session')).toBeTruthy()
  })

  it('shows loading state instead of create-session card when the first page is empty but more pages are pending', () => {
    sessionsData.splice(0, sessionsData.length)
    hasNextPageRef.current = true

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getByText('Loading sessions...')).toBeTruthy()
    expect(screen.queryByText('No sessions yet')).toBeNull()
    expect(screen.queryByText('Click here to start a new session')).toBeNull()
  })

  it('auto-fetches next page when all visible sessions are filtered out as child sessions', async () => {
    sessionsData.splice(0, sessionsData.length,
      { id: 'child1', title: 'child session', directory: '/w/a', parentID: 'parent1', time: { updated: Date.now() } },
      { id: 'child2', title: 'child session 2', directory: '/w/a', parentID: 'parent2', time: { updated: Date.now() } },
    )
    hasNextPageRef.current = true
    isFetchingNextPageRef.current = false

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(fetchNextPageMock).toHaveBeenCalled()
    })
  })

  it('renders pinned session under a Pinned heading and excludes it from Today', () => {
    const pinnedTime = Date.now()
    sessionPinsData.push({ sessionId: 'ses_a', directory: '/w/a', pinnedAt: pinnedTime })
    sessionsData.splice(0, sessionsData.length,
      { id: 'ses_a', title: 'pinned session', directory: '/w/a', time: { updated: pinnedTime } },
    )

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getByText('Pinned')).toBeTruthy()
    expect(screen.getByText('pinned session')).toBeTruthy()
    // Pinned sessions are excluded from Today/Older, so Today heading should not appear
    expect(screen.queryByText('Today')).toBeNull()
  })

  it('calls togglePinMock with correct args when Pin to top is clicked', async () => {
    const user = userEvent.setup()
    sessionsData.splice(0, sessionsData.length,
      { id: 'ses_x', title: 'test session', directory: '/w/a', time: { updated: Date.now() } },
    )

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    const actionsButton = screen.getByRole('button', { name: 'Session actions' })
    await user.click(actionsButton)

    const pinItem = screen.getByText('Pin to top')
    await user.click(pinItem)

    expect(togglePinMock).toHaveBeenCalledWith({ sessionId: 'ses_x', directory: '/w/a', pinned: true })
  })
})
