import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat } from '@opencode-manager/shared/schemas'
import type { Session } from '@/api/types'
import { FetchError } from '@/api/fetchWrapper'
import {
  useChat,
  useChatFolders,
  useChatSessions,
  useCreateChat,
  useDeleteChatSession,
} from './useChats'

const mocks = vi.hoisted(() => ({
  listChats: vi.fn(),
  getChat: vi.fn(),
  createChat: vi.fn(),
  deleteChatSession: vi.fn(),
  useSessionsAcrossDirectories: vi.fn(),
  removeDeletedSessionsFromListCaches: vi.fn(),
  cleanupSessionPins: vi.fn(),
  useSessionPins: vi.fn(),
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/api/chats', () => ({
  listChats: mocks.listChats,
  getChat: mocks.getChat,
  createChat: mocks.createChat,
  deleteChatSession: mocks.deleteChatSession,
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSessionsAcrossDirectories: mocks.useSessionsAcrossDirectories,
  removeDeletedSessionsFromListCaches: mocks.removeDeletedSessionsFromListCaches,
  cleanupSessionPins: mocks.cleanupSessionPins,
}))

vi.mock('@/hooks/useSessionPins', () => ({
  useSessionPins: mocks.useSessionPins,
}))

vi.mock('@/lib/toast', () => ({
  showToast: mocks.showToast,
}))

const chat = (id: string, directory: string): Chat => ({
  id,
  directory,
  filesPath: `${directory}/files`,
  createdAt: 1000,
})

const session = (id: string, directory: string, updated: number): Session => ({
  id,
  projectID: 'proj_1',
  title: `Session ${id}`,
  time: { created: updated, updated },
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
})

const createQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useChatFolders', () => {
  beforeEach(() => {
    mocks.listChats.mockReset()
  })

  it('pages chats and flattens pages in order', async () => {
    mocks.listChats.mockImplementation(async ({ cursor }: { cursor?: string }) => {
      if (cursor === 'cursor_2') {
        return { chats: [chat('20240101100000-bbbbbb', '/chats/old')] }
      }
      return {
        chats: [
          chat('20240102120000-aaaaaa', '/chats/new'),
          chat('20240102110000-cccccc', '/chats/mid'),
        ],
        nextCursor: 'cursor_2',
      }
    })

    const queryClient = createQueryClient()
    const { result } = renderHook(() => useChatFolders(2), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.chats.map((entry) => entry.id)).toEqual([
      '20240102120000-aaaaaa',
      '20240102110000-cccccc',
    ])
    expect(result.current.hasNextPage).toBe(true)

    await act(async () => {
      await result.current.fetchNextPage()
    })

    await waitFor(() => expect(result.current.chats).toHaveLength(3))

    expect(result.current.chats.map((entry) => entry.id)).toEqual([
      '20240102120000-aaaaaa',
      '20240102110000-cccccc',
      '20240101100000-bbbbbb',
    ])
    expect(mocks.listChats).toHaveBeenLastCalledWith({ limit: 2, cursor: 'cursor_2' })
  })
})

describe('useChatSessions', () => {
  beforeEach(() => {
    mocks.listChats.mockReset()
    mocks.useSessionsAcrossDirectories.mockReset()
    mocks.useSessionPins.mockReset()
    mocks.useSessionsAcrossDirectories.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    })
    mocks.useSessionPins.mockReturnValue({ data: [] })
  })

  it('orders rows by folder then update time, keeps pinned first, drops archived sessions', async () => {
    const now = Date.now()
    const newestChat = chat('20240102120000-aaaaaa', '/chats/new')
    const olderChat = chat('20240101100000-bbbbbb', '/chats/old')
    mocks.listChats.mockResolvedValue({ chats: [newestChat, olderChat] })

    const archived = session('ses_archived', '/chats/new', now - 500)
    archived.time.archived = now - 500
    mocks.useSessionsAcrossDirectories.mockReturnValue({
      data: [
        session('ses_new_older', '/chats/new', now - 3000),
        session('ses_old_pinned', '/chats/old', now - 4000),
        session('ses_new_newer', '/chats/new', now - 1000),
        session('ses_old_unpinned', '/chats/old', now - 500),
        archived,
        session('ses_unrelated', '/chats/other', now - 1000),
      ],
      isLoading: false,
      isError: false,
      error: null,
    })
    mocks.useSessionPins.mockReturnValue({
      data: [{ sessionId: 'ses_old_pinned', directory: '/chats/old', pinnedAt: now }],
    })

    const queryClient = createQueryClient()
    const { result } = renderHook(() => useChatSessions(2), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.rows).toHaveLength(4))

    expect(result.current.rows.map((row) => row.session.id)).toEqual([
      'ses_old_pinned',
      'ses_new_newer',
      'ses_new_older',
      'ses_old_unpinned',
    ])
    expect(mocks.useSessionsAcrossDirectories).toHaveBeenCalledWith(['/chats/new', '/chats/old'])

    const pinnedRow = result.current.rows[0]
    expect(pinnedRow.isPinned).toBe(true)
    expect(pinnedRow.chat.id).toBe(olderChat.id)
    expect(pinnedRow.path).toBe(`/chats/${olderChat.id}/sessions/ses_old_pinned`)
    expect(result.current.rows[1].isPinned).toBe(false)
    expect(result.current.rows[1].path).toBe(`/chats/${newestChat.id}/sessions/ses_new_newer`)

    const folders = renderHook(() => useChatFolders(2), {
      wrapper: createWrapper(queryClient),
    })
    await waitFor(() =>
      expect(folders.result.current.chats.map((entry) => entry.id)).toEqual([
        newestChat.id,
        olderChat.id,
      ]),
    )
    expect(result.current.hasMore).toBe(false)
  })
})

describe('useCreateChat', () => {
  beforeEach(() => {
    mocks.createChat.mockReset()
    mocks.showToast.success.mockReset()
    mocks.showToast.error.mockReset()
  })

  it('creates the chat, invalidates caches and reports the built session path', async () => {
    const createdChat = chat('20240102120000-aaaaaa', '/chats/new')
    mocks.createChat.mockResolvedValue({ chat: createdChat, sessionId: 'ses_new' })

    const queryClient = createQueryClient()
    const sessionsKey = ['opencode', 'sessions', '/chats/new', {}]
    const chatsKey = ['chats', 10]
    queryClient.setQueryData(sessionsKey, { pages: [], pageParams: [] })
    queryClient.setQueryData(chatsKey, { pages: [], pageParams: [] })

    const onCreated = vi.fn()
    const { result } = renderHook(() => useCreateChat(onCreated), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ title: 'New chat' })
    })

    expect(mocks.createChat).toHaveBeenCalledWith({ title: 'New chat' })
    expect(onCreated).toHaveBeenCalledWith(`/chats/${createdChat.id}/sessions/ses_new`)

    await waitFor(() => expect(queryClient.getQueryState(chatsKey)?.isInvalidated).toBe(true))
    await waitFor(() => expect(queryClient.getQueryState(sessionsKey)?.isInvalidated).toBe(true))
  })
})

describe('useDeleteChatSession', () => {
  beforeEach(() => {
    mocks.deleteChatSession.mockReset()
    mocks.removeDeletedSessionsFromListCaches.mockReset()
    mocks.cleanupSessionPins.mockReset()
    mocks.showToast.success.mockReset()
    mocks.showToast.error.mockReset()
  })

  it('deletes the session, updates list caches and shows a success toast', async () => {
    mocks.deleteChatSession.mockResolvedValue({ deleted: true, folderRemoved: false })

    const queryClient = createQueryClient()
    const chatsKey = ['chats', 10]
    queryClient.setQueryData(chatsKey, { pages: [], pageParams: [] })

    const { result } = renderHook(() => useDeleteChatSession(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        chatId: '20240102120000-aaaaaa',
        sessionId: 'ses_new',
        directory: '/chats/new',
      })
    })

    expect(mocks.deleteChatSession).toHaveBeenCalledWith('20240102120000-aaaaaa', 'ses_new')
    expect(mocks.removeDeletedSessionsFromListCaches).toHaveBeenCalledWith(queryClient, 'ses_new')
    expect(mocks.cleanupSessionPins).toHaveBeenCalledWith(
      queryClient,
      { id: 'ses_new', directory: '/chats/new' },
      '/chats/new',
    )
    expect(mocks.showToast.success).toHaveBeenCalledWith('Chat deleted')
    await waitFor(() => expect(queryClient.getQueryState(chatsKey)?.isInvalidated).toBe(true))
  })
})

describe('useChat', () => {
  beforeEach(() => {
    mocks.getChat.mockReset()
  })

  it('resolves a missing chat to null', async () => {
    mocks.getChat.mockRejectedValue(new FetchError('Chat not found', 404))

    const queryClient = createQueryClient()
    const { result } = renderHook(() => useChat('20240102120000-aaaaaa'), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data).toBeNull()
    expect(mocks.getChat).toHaveBeenCalledTimes(1)
  })
})
