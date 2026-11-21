import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import type { Chat, SessionPin } from '@opencode-manager/shared/schemas'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { SESSION_PINS_QUERY_KEY } from '@/hooks/useSessionPins'
import { appRoutes } from '@/test/fixtures/appRoutes'
import { makeSession } from '@/test/fixtures/api'
import { createTestQueryClient, renderHookWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'
import {
  useChat,
  useChatFolders,
  useChatSessions,
  useCreateChat,
  useDeleteChatSession,
} from './useChats'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
} as const

const CHATS_PATH = '/api/chats'
const PINS_PATH = '/api/session-pins'
const CHAT_ITEM_PATH = '/api/chats/:chatId'
const CHAT_SESSION_PATH = '/api/chats/:chatId/sessions/:sessionId'

const NEW_CHAT_ID = '20240102-120000-aaaaaa'
const MID_CHAT_ID = '20240102-110000-cccccc'
const OLD_CHAT_ID = '20240101-100000-bbbbbb'

function chat(id: string, directory: string): Chat {
  return { id, directory, filesPath: `chats/${id}`, createdAt: 1000 }
}

function makePin(sessionId: string, directory: string, pinnedAt: number): SessionPin {
  return { sessionId, directory, pinnedAt }
}

function chatsRoute(pages: Record<string, Chat[]>, nextCursors: Record<string, string> = {}): FetchRoute {
  return {
    method: 'GET',
    path: CHATS_PATH,
    respond: (request) => {
      const cursor = request.searchParams.get('cursor') ?? ''
      const chats = pages[cursor] ?? []
      const nextCursor = nextCursors[cursor]
      return { json: nextCursor === undefined ? { chats } : { chats, nextCursor } }
    },
  }
}

function sessionListKey(directory: string): readonly unknown[] {
  return ['opencode', 'sessions', directory, {}, LOCAL_OPENCODE_SERVER_ID]
}

interface SessionListCache {
  pages: Array<{ items: Array<{ id: string }> }>
  pageParams: unknown[]
}

function listCacheSessionIds(queryClient: QueryClient, directory: string): string[] {
  const cached = queryClient.getQueryData<SessionListCache>(sessionListKey(directory))
  return cached?.pages.flatMap((page) => page.items.map((item) => item.id)) ?? []
}

describe('useChatFolders', () => {
  it('pages chats and flattens pages in order', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useChatFolders(2), {
      ...hookProviders,
      fetchRoutes: [
        chatsRoute(
          {
            '': [chat(NEW_CHAT_ID, '/chats/new'), chat(MID_CHAT_ID, '/chats/mid')],
            [MID_CHAT_ID]: [chat(OLD_CHAT_ID, '/chats/old')],
          },
          { '': MID_CHAT_ID },
        ),
      ],
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.chats.map((entry) => entry.id)).toEqual([NEW_CHAT_ID, MID_CHAT_ID])
    expect(result.current.hasNextPage).toBe(true)
    expect(fetchFake.lastRequest('GET', CHATS_PATH)?.searchParams.get('limit')).toBe('2')

    await act(async () => {
      await result.current.fetchNextPage()
    })

    await waitFor(() => expect(result.current.chats).toHaveLength(3))

    expect(result.current.chats.map((entry) => entry.id)).toEqual([NEW_CHAT_ID, MID_CHAT_ID, OLD_CHAT_ID])
    expect(fetchFake.lastRequest('GET', CHATS_PATH)?.searchParams.get('cursor')).toBe(MID_CHAT_ID)
  })
})

describe('useChatSessions', () => {
  it('orders rows by folder then update time, keeps pinned first, drops archived sessions', async () => {
    const now = Date.now()
    const newestChat = chat(NEW_CHAT_ID, '/chats/new')
    const olderChat = chat(OLD_CHAT_ID, '/chats/old')

    const { result } = renderHookWithProviders(() => useChatSessions(2), {
      ...hookProviders,
      fetchRoutes: [
        chatsRoute({ '': [newestChat, olderChat] }),
        ...appRoutes({
          sessions: [
            makeSession({ id: 'ses_new_older', title: 'Session ses_new_older', location: { directory: '/chats/new' }, time: { created: now - 3000, updated: now - 3000 } }),
            makeSession({ id: 'ses_old_pinned', title: 'Session ses_old_pinned', location: { directory: '/chats/old' }, time: { created: now - 4000, updated: now - 4000 } }),
            makeSession({ id: 'ses_new_newer', title: 'Session ses_new_newer', location: { directory: '/chats/new' }, time: { created: now - 1000, updated: now - 1000 } }),
            makeSession({ id: 'ses_old_unpinned', title: 'Session ses_old_unpinned', location: { directory: '/chats/old' }, time: { created: now - 500, updated: now - 500 } }),
            makeSession({ id: 'ses_archived', title: 'Session ses_archived', location: { directory: '/chats/new' }, time: { created: now - 500, updated: now - 500, archived: now - 500 } }),
            makeSession({ id: 'ses_unrelated', title: 'Session ses_unrelated', location: { directory: '/chats/other' }, time: { created: now - 1000, updated: now - 1000 } }),
          ],
          pins: [makePin('ses_old_pinned', '/chats/old', now)],
        }),
      ],
    })

    await waitFor(() => expect(result.current.rows).toHaveLength(4))

    expect(result.current.rows.map((row) => row.session.id)).toEqual([
      'ses_old_pinned',
      'ses_new_newer',
      'ses_new_older',
      'ses_old_unpinned',
    ])

    const pinnedRow = result.current.rows[0]
    expect(pinnedRow?.isPinned).toBe(true)
    expect(pinnedRow?.chat.id).toBe(olderChat.id)
    expect(pinnedRow?.path).toBe(`/chats/${olderChat.id}/sessions/ses_old_pinned`)
    expect(result.current.rows[1]?.isPinned).toBe(false)
    expect(result.current.rows[1]?.path).toBe(`/chats/${newestChat.id}/sessions/ses_new_newer`)
    expect(result.current.hasMore).toBe(false)
  })
})

describe('useCreateChat', () => {
  it('creates the chat, invalidates caches and reports the built session path', async () => {
    const createdChat = chat(NEW_CHAT_ID, '/chats/new')
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['chats', 10], { pages: [], pageParams: [] })
    queryClient.setQueryData(sessionListKey('/chats/new'), { pages: [], pageParams: [] })
    const onCreated = vi.fn()

    const { result, fetchFake } = renderHookWithProviders(() => useCreateChat(onCreated), {
      ...hookProviders,
      queryClient,
      fetchRoutes: [
        {
          method: 'POST',
          path: CHATS_PATH,
          respond: () => ({ json: { chat: createdChat, sessionId: 'ses_new' } }),
        },
      ],
    })

    await act(async () => {
      await result.current.mutateAsync({ title: 'New chat' })
    })

    expect(fetchFake.lastRequest('POST', CHATS_PATH)?.body).toEqual({ title: 'New chat' })
    expect(onCreated).toHaveBeenCalledWith(`/chats/${createdChat.id}/sessions/ses_new`)
    await waitFor(() => expect(queryClient.getQueryState(['chats', 10])?.isInvalidated).toBe(true))
    await waitFor(() =>
      expect(queryClient.getQueryState(sessionListKey('/chats/new'))?.isInvalidated).toBe(true),
    )
  })
})

describe('useDeleteChatSession', () => {
  it('deletes the session, updates list caches and shows a success toast', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['chats', 10], { pages: [], pageParams: [] })
    queryClient.setQueryData(SESSION_PINS_QUERY_KEY, [makePin('ses_new', '/chats/new', 1)])
    queryClient.setQueryData(sessionListKey('/chats/new'), {
      pages: [{ items: [makeSession({ id: 'ses_new' })] }],
      pageParams: [],
    })

    const { result, fetchFake } = renderHookWithProviders(() => useDeleteChatSession(), {
      ...hookProviders,
      queryClient,
      fetchRoutes: [
        { method: 'DELETE', path: CHAT_SESSION_PATH, respond: () => ({ json: { deleted: true, folderRemoved: false } }) },
        { method: 'PUT', path: PINS_PATH, respond: () => ({ json: { pins: [] } }) },
        { method: 'GET', path: PINS_PATH, respond: () => ({ json: { pins: [] } }) },
        { method: 'GET', path: CHAT_ITEM_PATH, respond: () => ({ status: 404, json: { error: 'Chat not found' } }) },
      ],
    })

    await act(async () => {
      await result.current.mutateAsync({
        chatId: NEW_CHAT_ID,
        sessionId: 'ses_new',
        directory: '/chats/new',
      })
    })

    expect(fetchFake.findRequests('DELETE', CHAT_SESSION_PATH)).toHaveLength(1)
    expect(listCacheSessionIds(queryClient, '/chats/new')).toEqual([])
    expect(fetchFake.lastRequest('PUT', PINS_PATH)?.body).toEqual({
      sessionId: 'ses_new',
      directory: '/chats/new',
      pinned: false,
    })
    expect(await screen.findByText('Chat deleted')).toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryState(['chats', 10])?.isInvalidated).toBe(true))
  })
})

describe('useChat', () => {
  it('resolves a missing chat to null', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useChat(NEW_CHAT_ID), {
      ...hookProviders,
      fetchRoutes: [
        { method: 'GET', path: CHAT_ITEM_PATH, respond: () => ({ status: 404, json: { error: 'Chat not found' } }) },
      ],
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data).toBeNull()
    expect(fetchFake.findRequests('GET', CHAT_ITEM_PATH)).toHaveLength(1)
  })
})
