import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import type { Session } from '@/api/types'
import { Button } from '@/components/ui/button'
import { DeleteSessionDialog } from '@/components/session/DeleteSessionDialog'
import {
  SessionPickerList,
  type SessionPickerRow,
  type SessionPickerSection,
} from '@/components/session/SessionPickerList'
import {
  PickerSearchBar,
  optionId,
  usePickerCursor,
  usePickerKeyNav,
} from '@/components/session/usePickerKeyboardNav'
import { useChatSessions, useDeleteChatSession, type ChatSessionRow } from '@/hooks/useChats'
import { useToggleSessionPin } from '@/hooks/useSessionPins'

interface ChatPickerContentProps {
  open: boolean
  activeSessionID?: string
  onNavigate: (path: string) => void
  onDeleteActiveSession: () => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  searchTrailing?: React.ReactNode
}

/**
 * Chat sessions for the shared session picker: newest first, filtered by title, with pin and
 * confirm-before-delete actions on the same row menu as every other picker list.
 */
export function ChatPickerContent({
  open,
  activeSessionID,
  onNavigate,
  onDeleteActiveSession,
  searchInputRef,
  searchTrailing,
}: ChatPickerContentProps) {
  const { rows: chatRows, hasMore, showMore, isLoading, isError } = useChatSessions(10)
  const listId = useId()
  const optionBaseId = useId()
  const togglePin = useToggleSessionPin()
  const deleteChatSession = useDeleteChatSession()
  const [query, setQuery] = useState('')
  const [chatToDelete, setChatToDelete] = useState<ChatSessionRow | null>(null)
  const trimmedQuery = query.trim()

  const pinnedKeys = useMemo(
    () => new Set(chatRows.filter((row) => row.isPinned).map((row) => row.key)),
    [chatRows],
  )
  const rowByKey = useMemo(() => new Map(chatRows.map((row) => [row.key, row])), [chatRows])

  const sections = useMemo<SessionPickerSection[]>(() => {
    const needle = trimmedQuery.toLowerCase()
    const filtered = needle
      ? chatRows.filter((row) => (row.session.title ?? '').toLowerCase().includes(needle))
      : chatRows
    return filtered.length > 0 ? [{ id: 'chats', heading: 'Chats', rows: filtered }] : []
  }, [chatRows, trimmedQuery])
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections])

  const activeRow = useMemo(
    () => rows.find((row) => row.session.id === activeSessionID),
    [rows, activeSessionID],
  )
  const defaultCursorKey = !trimmedQuery && activeRow ? activeRow.key : rows[0]?.key ?? null

  const {
    rowIndexByKey,
    cursorIndex,
    cursorRow,
    registerRef,
    moveCursor,
    resetCursor,
  } = usePickerCursor(rows, defaultCursorKey)

  const openRow = useCallback(
    (row: SessionPickerRow | undefined) => {
      if (!row) return
      const chatRow = rowByKey.get(row.key)
      if (chatRow) onNavigate(chatRow.path)
    },
    [rowByKey, onNavigate],
  )

  const requestDeleteRow = useCallback(
    (row: SessionPickerRow | undefined) => {
      const chatRow = row ? rowByKey.get(row.key) : undefined
      if (chatRow) setChatToDelete(chatRow)
    },
    [rowByKey],
  )

  const handleRequestDelete = useCallback(
    (session: Session) => {
      const chatRow = chatRows.find((row) => row.session.id === session.id)
      if (chatRow) setChatToDelete(chatRow)
    },
    [chatRows],
  )

  const handleTogglePin = useCallback(
    (row: SessionPickerRow) => {
      const chatRow = rowByKey.get(row.key)
      if (!chatRow) return
      togglePin.mutate({
        sessionId: chatRow.session.id,
        directory: chatRow.session.location.directory,
        pinned: !pinnedKeys.has(chatRow.key),
      })
    },
    [rowByKey, pinnedKeys, togglePin],
  )

  useEffect(() => {
    resetCursor()
  }, [trimmedQuery, resetCursor])

  const handleSearchKeyDown = usePickerKeyNav({
    rows,
    cursorIndex,
    cursorRow,
    moveCursor,
    onOpenRow: openRow,
    onDeleteRow: requestDeleteRow,
  })

  const confirmDelete = useCallback(() => {
    if (!chatToDelete) return
    if (chatToDelete.session.id === activeSessionID) onDeleteActiveSession()
    void deleteChatSession
      .mutateAsync({
        chatId: chatToDelete.chat.id,
        sessionId: chatToDelete.session.id,
        directory: chatToDelete.session.location.directory,
      })
      .catch(() => undefined)
      .finally(() => setChatToDelete(null))
  }, [chatToDelete, activeSessionID, onDeleteActiveSession, deleteChatSession])

  const emptyState = isLoading
    ? 'Loading chats...'
    : isError
      ? 'Failed to load chats'
      : trimmedQuery
        ? 'No chats found'
        : 'No chats yet'

  return (
    <>
      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <PickerSearchBar
          inputRef={searchInputRef}
          listId={listId}
          open={open}
          activeDescendantId={cursorIndex >= 0 ? optionId(optionBaseId, cursorIndex) : undefined}
          value={query}
          onChange={setQuery}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search chats..."
          name="chat-picker-search"
          trailing={searchTrailing}
        />

        <SessionPickerList
          listId={listId}
          optionBaseId={optionBaseId}
          ariaLabel="Chats"
          sections={sections}
          rows={rows}
          rowIndexByKey={rowIndexByKey}
          cursorIndex={cursorIndex}
          activeSessionID={activeSessionID}
          pinnedKeys={pinnedKeys}
          pendingDeleteKey={null}
          showRepo={false}
          emptyState={emptyState}
          onOpenRow={openRow}
          onHoverRow={moveCursor}
          onTogglePin={handleTogglePin}
          onRequestDelete={handleRequestDelete}
          registerRef={registerRef}
        >
          {hasMore && (
            <div className="flex justify-center py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void showMore()
                }}
              >
                Show more
              </Button>
            </div>
          )}
        </SessionPickerList>

        <div className="mt-2 shrink-0 px-4 text-xs text-muted-foreground pointer-coarse:hidden sm:px-0">
          ↑↓ move · Enter open · Ctrl+D delete
        </div>
      </div>

      <DeleteSessionDialog
        open={chatToDelete !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setChatToDelete(null)
        }}
        onConfirm={confirmDelete}
        onCancel={() => setChatToDelete(null)}
        isDeleting={deleteChatSession.isPending}
      />
    </>
  )
}
