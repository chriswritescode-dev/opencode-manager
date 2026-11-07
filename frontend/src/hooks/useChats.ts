import { useMemo } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { Chat, CreateChatRequest } from '@opencode-manager/shared/schemas'
import { buildChatSessionPath } from '@opencode-manager/shared/utils'
import { createChat, deleteChatSession, getChat, listChats } from '@/api/chats'
import { FetchError } from '@/api/fetchWrapper'
import type { Session } from '@/api/types'
import {
  cleanupSessionPins,
  removeDeletedSessionsFromListCaches,
  useSessionsAcrossDirectories,
} from '@/hooks/useOpenCode'
import { useSessionPins } from '@/hooks/useSessionPins'
import { invalidateSessionListCaches } from '@/lib/queryInvalidation'
import { parseNetworkError } from '@/lib/opencode-errors'
import { buildPinnedSessionKeys, getSessionKey } from '@/lib/sessionKey'
import { partitionSessions } from '@/components/session/session-partition'
import { showToast } from '@/lib/toast'

const EMPTY_CHATS: Chat[] = []

/** A session of a loaded chat folder, ready to render in the chat list. */
export interface ChatSessionRow {
  key: string
  session: Session
  chat: Chat
  path: string
  isPinned: boolean
}

/** Paginated chat folders, newest first. */
export function useChatFolders(pageSize = 10) {
  const query = useInfiniteQuery({
    queryKey: ['chats', pageSize],
    queryFn: ({ pageParam }) => listChats({ limit: pageSize, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const chats = useMemo(
    () => query.data?.pages.flatMap((page) => page.chats) ?? EMPTY_CHATS,
    [query.data],
  )

  return {
    chats,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}

/** Root sessions of loaded chat folders, ordered and partitioned for the chat list. */
export function useChatSessions(pageSize = 10) {
  const folders = useChatFolders(pageSize)
  const chats = folders.chats
  const directories = useMemo(() => chats.map((chat) => chat.directory), [chats])
  const sessions = useSessionsAcrossDirectories(directories)
  const { data: pins = [] } = useSessionPins()

  const rows = useMemo<ChatSessionRow[]>(() => {
    const chatsByDirectory = new Map<string, { chat: Chat; order: number }>()
    chats.forEach((chat, order) => {
      if (!chatsByDirectory.has(chat.directory)) {
        chatsByDirectory.set(chat.directory, { chat, order })
      }
    })

    const pinnedKeys = buildPinnedSessionKeys(pins)
    const ordered = sessions.data
      .flatMap((session) => {
        if (session.parentID || session.time.archived) return []
        const entry = chatsByDirectory.get(session.location.directory)
        return entry ? [{ session, order: entry.order }] : []
      })
      .sort((a, b) => a.order - b.order || b.session.time.updated - a.session.time.updated)
      .map((entry) => entry.session)

    const partitioned = partitionSessions(ordered, pinnedKeys, getSessionKey)
    const pinnedSessionKeys = new Set(partitioned.pinned.map(getSessionKey))
    const orderedRows = [
      ...partitioned.pinned,
      ...ordered.filter((session) => !pinnedSessionKeys.has(getSessionKey(session))),
    ]

    return orderedRows.flatMap((session) => {
      const entry = chatsByDirectory.get(session.location.directory)
      if (!entry) return []
      const key = getSessionKey(session)
      return [{
        key,
        session,
        chat: entry.chat,
        path: buildChatSessionPath(entry.chat.id, session.id),
        isPinned: pinnedKeys.has(key),
      }]
    })
  }, [chats, pins, sessions.data])

  return {
    rows,
    chats,
    hasMore: Boolean(folders.hasNextPage),
    showMore: folders.fetchNextPage,
    isLoading: folders.isLoading || sessions.isLoading,
    isError: folders.isError || sessions.isError,
    error: folders.error ?? sessions.error,
  }
}

/** Creates a chat folder and navigates to its first session through `onCreated`. */
export function useCreateChat(onCreated?: (path: string) => void) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input?: CreateChatRequest) => createChat(input ?? {}),
    onSuccess: (response) => {
      invalidateSessionListCaches(queryClient)
      void queryClient.invalidateQueries({ queryKey: ['chats'] })
      onCreated?.(buildChatSessionPath(response.chat.id, response.sessionId))
    },
    onError: (error) => {
      const parsed = parseNetworkError(error)
      showToast.error(parsed.title, {
        description: parsed.message,
        duration: 5000,
      })
    },
  })
}

/** Deletes one session from a chat folder and removes it from list and pin caches. */
export function useDeleteChatSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (variables: { chatId: string; sessionId: string; directory?: string }) =>
      deleteChatSession(variables.chatId, variables.sessionId),
    onSuccess: (_response, variables) => {
      removeDeletedSessionsFromListCaches(queryClient, variables.sessionId)
      cleanupSessionPins(
        queryClient,
        variables.directory
          ? { id: variables.sessionId, directory: variables.directory }
          : variables.sessionId,
        variables.directory,
      )
      void queryClient.invalidateQueries({ queryKey: ['chats'] })
      showToast.success('Chat deleted')
    },
    onError: () => {
      invalidateSessionListCaches(queryClient)
      showToast.error('Failed to delete chat')
    },
  })
}

/** Reads one chat folder, resolving a missing chat to `null`. */
export function useChat(chatId?: string) {
  return useQuery({
    queryKey: ['chats', 'item', chatId],
    queryFn: async () => {
      try {
        return await getChat(chatId!)
      } catch (error) {
        if (error instanceof FetchError && error.statusCode === 404) return null
        throw error
      }
    },
    enabled: !!chatId,
    retry: (failureCount, error) =>
      !(error instanceof FetchError && error.statusCode === 404) && failureCount < 3,
  })
}
