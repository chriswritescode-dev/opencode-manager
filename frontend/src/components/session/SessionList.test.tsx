import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { SessionList } from './SessionList'

const { createSessionMock, deleteSessionMock, sessionsData, createSessionState, fetchNextPageMock, hasNextPageRef, isFetchingNextPageRef, isFetchNextPageErrorRef, useRealSessionsHookRef, lastSessionsHookArgs, sessionPinsData, togglePinMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  sessionsData: [] as Array<{ id: string; title: string; location: { directory: string }; parentID?: string; time: { updated: number } }>,
  createSessionState: { directory: undefined as string | undefined },
  fetchNextPageMock: vi.fn(),
  hasNextPageRef: { current: false },
  isFetchingNextPageRef: { current: false },
  isFetchNextPageErrorRef: { current: false },
  useRealSessionsHookRef: { current: false },
  lastSessionsHookArgs: { current: undefined as { directories: string[]; options?: { search?: string; limit?: number } } | undefined },
  sessionPinsData: [] as Array<{ sessionId: string; directory: string; pinnedAt: number }>,
  togglePinMock: vi.fn(),
}))

vi.mock('@/hooks/useOpenCode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOpenCode')>()
  return {
    ...actual,
    useSessionsAcrossDirectories: (directories: string[], options?: { search?: string; limit?: number }) => {
      if (useRealSessionsHookRef.current) {
        return actual.useSessionsAcrossDirectories(directories, options)
      }
      lastSessionsHookArgs.current = { directories, options }
      const data = options?.search ? [] : sessionsData
      return {
        data,
        isLoading: false,
        fetchNextPage: fetchNextPageMock,
        hasNextPage: hasNextPageRef.current,
        isFetchingNextPage: isFetchingNextPageRef.current,
        isFetchNextPageError: isFetchNextPageErrorRef.current,
      }
    },
    useCreateSession: (directory?: string) => {
      createSessionState.directory = directory
      return { mutate: createSessionMock }
    },
    useDeleteSession: () => ({ mutateAsync: deleteSessionMock, isPending: false }),
  }
})

vi.mock('@/hooks/useSessionPins', () => ({
  useSessionPins: () => ({ data: sessionPinsData }),
  useToggleSessionPin: () => ({ mutate: togglePinMock }),
}))

describe('SessionList', () => {
  beforeEach(() => {
    sessionsData.splice(0, sessionsData.length,
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', location: { directory: '/w/a' }, time: { updated: Date.now() } },
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', location: { directory: '/w/b' }, time: { updated: Date.now() } },
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', location: { directory: '/w/c' }, time: { updated: Date.now() } },
    )
    createSessionMock.mockReset()
    createSessionState.directory = undefined
    deleteSessionMock.mockReset()
    deleteSessionMock.mockResolvedValue(undefined)
    fetchNextPageMock.mockReset()
    hasNextPageRef.current = false
    isFetchingNextPageRef.current = false
    isFetchNextPageErrorRef.current = false
    useRealSessionsHookRef.current = false
    lastSessionsHookArgs.current = undefined
    sessionPinsData.splice(0, sessionPinsData.length)
    togglePinMock.mockReset()
  })

  it('selects duplicate session IDs independently by directory', async () => {
    const user = userEvent.setup()

    render(
      <SessionList
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
        { id: 'ses_same', directory: '/w/a' },
        { id: 'ses_same', directory: '/w/b' },
        { id: 'ses_same', directory: '/w/c' },
      ])
    })
  })

  it('deduplicates repeated session records from the same workspace directory', async () => {
    const user = userEvent.setup()
    sessionsData.splice(0, sessionsData.length,
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', location: { directory: '/w/a' }, time: { updated: Date.now() } },
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', location: { directory: '/w/a' }, time: { updated: Date.now() } },
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', location: { directory: '/w/a' }, time: { updated: Date.now() } },
    )

    render(
      <SessionList
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
      { id: 'child1', title: 'child session', location: { directory: '/w/a' }, parentID: 'parent1', time: { updated: Date.now() } },
      { id: 'child2', title: 'child session 2', location: { directory: '/w/a' }, parentID: 'parent2', time: { updated: Date.now() } },
    )
    hasNextPageRef.current = true
    isFetchingNextPageRef.current = false

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(fetchNextPageMock).toHaveBeenCalled()
    })
  })

  it('auto-fetches next page when filtered sessions underfill the scroll viewport', async () => {
    sessionsData.splice(0, sessionsData.length,
      { id: 'root1', title: 'root session 1', location: { directory: '/w/a' }, time: { updated: 4 } },
      { id: 'root2', title: 'root session 2', location: { directory: '/w/a' }, time: { updated: 3 } },
      { id: 'root3', title: 'root session 3', location: { directory: '/w/a' }, time: { updated: 2 } },
      { id: 'root4', title: 'root session 4', location: { directory: '/w/a' }, time: { updated: 1 } },
      ...Array.from({ length: 21 }, (_, index) => ({
        id: `child${index}`,
        title: `child session ${index}`,
        location: { directory: '/w/a' },
        parentID: `root${index}`,
        time: { updated: index },
      })),
    )
    hasNextPageRef.current = true
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 300 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 500 })

    try {
      render(
        <SessionList
            directories={['/w/a']}
          onSelectSession={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(fetchNextPageMock).toHaveBeenCalled()
      })
    } finally {
      if (scrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor)
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
      }
      if (clientHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor)
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
      }
    }
  })

  it('renders pinned session under a Pinned heading and excludes it from Today', () => {
    const pinnedTime = Date.now()
    sessionPinsData.push({ sessionId: 'ses_a', directory: '/w/a', pinnedAt: pinnedTime })
    sessionsData.splice(0, sessionsData.length,
      { id: 'ses_a', title: 'pinned session', location: { directory: '/w/a' }, time: { updated: pinnedTime } },
    )

    render(
      <SessionList
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
      { id: 'ses_x', title: 'test session', location: { directory: '/w/a' }, time: { updated: Date.now() } },
    )

    render(
      <SessionList
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

  it('shows a retry action and stops automatic pagination while a next-page error is active', async () => {
    hasNextPageRef.current = true
    isFetchNextPageErrorRef.current = true

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getByText('Failed to load more sessions.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()

    const scrollContainer = screen.getByRole('region', { name: 'Sessions' })
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 300, configurable: true })
    fireEvent.scroll(scrollContainer)

    await waitFor(() => {
      expect(fetchNextPageMock).not.toHaveBeenCalled()
    })
  })

  it('retries the next page when the retry action is clicked after an error', async () => {
    hasNextPageRef.current = true
    isFetchNextPageErrorRef.current = true
    const user = userEvent.setup()

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(fetchNextPageMock).toHaveBeenCalledTimes(1)
  })

  it('shows the retry action instead of the loading state when the first page is empty and the next page failed', () => {
    sessionsData.splice(0, sessionsData.length)
    hasNextPageRef.current = true
    isFetchNextPageErrorRef.current = true

    render(
      <SessionList
        directories={['/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByText('Loading sessions...')).toBeNull()
  })

  it('stops automatic pagination after a persistent next-page error and appends older roots on explicit retry with real React Query', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const pageOneItems = [
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `root${index}`,
        projectID: 'proj_1',
        title: `root session ${index}`,
        time: { created: 100 + index, updated: 100 + index },
        location: { directory: '/w/a' },
      })),
      ...Array.from({ length: 21 }, (_, index) => ({
        id: `child${index}`,
        projectID: 'proj_1',
        parentID: `root${index}`,
        title: `child session ${index}`,
        time: { created: index, updated: index },
        location: { directory: '/w/a' },
      })),
    ]

    let cursorAttempts = 0
    let recovered = false
    let resolveRecovery: ((response: Response) => void) | undefined
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('cursor=cursor_next')) {
        cursorAttempts += 1
        if (!recovered) {
          return Promise.resolve(new Response(JSON.stringify({ error: 'persistent failure' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }))
        }
        return new Promise<Response>((resolve) => {
          resolveRecovery = resolve
        })
      }
      return Promise.resolve(new Response(JSON.stringify({
        data: pageOneItems,
        cursor: { next: 'cursor_next' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    useRealSessionsHookRef.current = true
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1, retryDelay: 0 }, mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    let unmount: (() => void) | undefined
    try {
      const rendered = render(
        <SessionList
            directories={['/w/a']}
          onSelectSession={vi.fn()}
        />,
        { wrapper },
      )
      unmount = rendered.unmount

      await waitFor(() => {
        expect(screen.getByText('root session 0')).toBeTruthy()
      })

      await waitFor(() => {
        expect(screen.getByText('Failed to load more sessions.')).toBeTruthy()
      })
      expect(cursorAttempts).toBe(2)

      const scrollContainer = screen.getByRole('region', { name: 'Sessions' })
      fireEvent.scroll(scrollContainer)
      fireEvent.scroll(scrollContainer)

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(cursorAttempts).toBe(2)

      recovered = true
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => {
        expect(resolveRecovery).toBeDefined()
      })
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
      expect(screen.getByText('Loading more sessions...')).toBeTruthy()
      expect(screen.getByText('root session 0')).toBeTruthy()
      expect(screen.queryByText('child session 0')).toBeNull()

      resolveRecovery?.(new Response(JSON.stringify({
        data: [{ id: 'older_root', projectID: 'proj_1', title: 'older root session', time: { created: 1, updated: 1 }, location: { directory: '/w/a' } }],
        cursor: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

      await waitFor(() => {
        expect(screen.getByText('older root session')).toBeTruthy()
      })
      expect(cursorAttempts).toBe(3)
      expect(screen.getByText('root session 0')).toBeTruthy()
      expect(screen.queryByText('child session 0')).toBeNull()
      expect(screen.queryByText('Failed to load more sessions.')).toBeNull()
    } finally {
      unmount?.()
      queryClient.clear()
      vi.unstubAllGlobals()
    }
  })
})
