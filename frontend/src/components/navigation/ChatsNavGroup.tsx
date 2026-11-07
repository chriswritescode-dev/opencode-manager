import { useLocation, useNavigate } from 'react-router-dom'
import { parseChatSessionRoute } from '@/lib/navigation'
import { usePersistentBoolean } from '@/hooks/usePersistentBoolean'
import { useChatSessions, type ChatSessionRow } from '@/hooks/useChats'
import {
  NewChatButton,
  RepoNavGroup,
  SessionNavLink,
  SessionNavRow,
  SessionNavStatus,
} from '@/components/navigation/RepoSessionNav'
import {
  SIDEBAR_CHATS_PER_PAGE,
  isCurrentSessionItem,
  type SidebarSessionItem,
} from '@/components/navigation/sidebar-session-tree'

const CHATS_GROUP_OPEN_STORAGE_KEY = 'oc:sidebar:chats-open'

function toChatItem(row: ChatSessionRow): SidebarSessionItem {
  return {
    key: row.key,
    session: row.session,
    chatId: row.chat.id,
    repoLabel: 'Chat',
    branchLabel: null,
    isWorktree: false,
    isPinned: row.isPinned,
    path: row.path,
  }
}

/**
 * The sidebar's chat group: the newest chat sessions above the repositories, expandable to more
 * pages and persisted independently of the repository accordion.
 */
export function ChatsNavGroup() {
  const navigate = useNavigate()
  const location = useLocation()
  const [isOpen, toggleOpen] = usePersistentBoolean(CHATS_GROUP_OPEN_STORAGE_KEY, true)
  const { rows, hasMore, showMore, isLoading, isError } = useChatSessions(SIDEBAR_CHATS_PER_PAGE)
  const firstRow = rows[0]

  const openGroup = () => {
    if (firstRow) navigate(firstRow.path)
  }

  return (
    <RepoNavGroup
      name="Chats"
      isOpen={isOpen}
      isCurrent={parseChatSessionRoute(location.pathname) !== null}
      onOpenRepo={openGroup}
      onToggle={toggleOpen}
      actions={<NewChatButton onOpenSession={navigate} />}
    >
      {isLoading ? (
        <SessionNavStatus>Loading chats...</SessionNavStatus>
      ) : isError ? (
        <SessionNavStatus>Failed to load chats</SessionNavStatus>
      ) : rows.length === 0 ? (
        <SessionNavStatus>No chats</SessionNavStatus>
      ) : (
        rows.map((row) => {
          const item = toChatItem(row)
          return (
            <SessionNavRow
              key={item.key}
              item={item}
              isCurrent={isCurrentSessionItem(item, location.pathname)}
              onSelect={navigate}
            />
          )
        })
      )}
      {hasMore && <SessionNavLink onClick={showMore}>Show more</SessionNavLink>}
    </RepoNavGroup>
  )
}
