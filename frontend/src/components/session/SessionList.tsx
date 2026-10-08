import { useCallback, useState, useMemo, useEffect, useRef, useId, type ReactNode } from "react";
import { useSessionsAcrossDirectories, useDeleteSession, useCreateSession } from "@/hooks/useOpenCode";
import type { DeleteSessionTarget } from "@/hooks/useOpenCode";
import type { Session } from "@/api/types";
import { useSessionPins, useToggleSessionPin } from '@/hooks/useSessionPins';
import { buildSessionKey, buildPinnedSessionKeys } from '@/lib/sessionKey';
import { partitionSessions, selectRootSessions } from './session-partition';
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { SessionCard } from "./SessionCard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Pencil, X } from "lucide-react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

interface SessionListProps {
  directory?: string;
  directories?: string[];
  createDirectory?: string;
  activeSessionID?: string;
  onSelectSession: (sessionID: string) => void;
  renderSessions?: (args: SessionListRenderArgs) => ReactNode;
}

/**
 * Lets a caller lay out the loaded root sessions itself, for example grouped by worktree.
 * Search, paging, pinning, selection and delete stay owned by SessionList.
 */
export interface SessionListRenderArgs {
  sessions: Session[];
  searchQuery: string;
  renderSessionCard: (session: Session) => ReactNode;
}

export const SessionList = ({
  directory,
  directories,
  createDirectory,
  activeSessionID,
  onSelectSession,
  renderSessions,
}: SessionListProps) => {
  const directoriesList = useMemo(() => {
    const source = directories && directories.length > 0 ? directories : directory ? [directory] : [];
    return Array.from(new Set(source.filter(Boolean)));
  }, [directory, directories]);
  const directorySet = useMemo(() => new Set(directoriesList), [directoriesList]);
  const primaryDirectory = directoriesList[0];
  const sessionCreateDirectory = createDirectory ?? primaryDirectory;
  const getSessionSelectionKey = useCallback((session: Session) =>
    buildSessionKey(session.location.directory, session.id),
  []);
  const [searchQuery, setSearchQuery] = useState("");
  const trimmedSearchQuery = searchQuery.trim();
  const debouncedSearchQuery = useDebouncedValue(trimmedSearchQuery, 150);
  const search = trimmedSearchQuery ? debouncedSearchQuery : '';
  const { data: sessions, isLoading, isPlaceholderData, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = useSessionsAcrossDirectories(directoriesList, { search, limit: 25, keepPreviousResults: true });
  const deleteSession = useDeleteSession(directoriesList);
  const createSession = useCreateSession(sessionCreateDirectory, (newSession) => {
    onSelectSession(newSession.id);
  });
  const { data: sessionPins } = useSessionPins();
  const togglePin = useToggleSessionPin();
  const pinnedKeys = useMemo(
    () => buildPinnedSessionKeys(sessionPins ?? []),
    [sessionPins],
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<DeleteSessionTarget | DeleteSessionTarget[] | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [manageMode, setManageMode] = useState(false);
  const sessionListRef = useRef<HTMLDivElement>(null);

  const rootSessions = useMemo(
    () => selectRootSessions(sessions ?? [], { directories: directorySet, keyFn: getSessionSelectionKey }),
    [sessions, directorySet, getSessionSelectionKey],
  );

  const filteredSessions = useMemo(() => {
    if (!trimmedSearchQuery) return rootSessions;
    const needle = trimmedSearchQuery.toLowerCase();
    return rootSessions.filter((session) => (session.title ?? '').toLowerCase().includes(needle));
  }, [rootSessions, trimmedSearchQuery]);

  const { pinned: pinnedSessions, today: todaySessions, older: olderSessions } = useMemo(
    () => partitionSessions(filteredSessions, pinnedKeys, getSessionSelectionKey),
    [filteredSessions, pinnedKeys, getSessionSelectionKey],
  );

  const navSessions = useMemo(
    () => [...pinnedSessions, ...todaySessions, ...olderSessions],
    [pinnedSessions, todaySessions, olderSessions],
  );

  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);

  useEffect(() => {
    setHighlightedKey(null);
  }, [trimmedSearchQuery]);

  const highlightedSession = useMemo(() => {
    if (navSessions.length === 0) return undefined;
    if (highlightedKey) {
      const stored = navSessions.find((session) => getSessionSelectionKey(session) === highlightedKey);
      if (stored) return stored;
    }
    if (!trimmedSearchQuery && activeSessionID) {
      const active = navSessions.find((session) => session.id === activeSessionID);
      if (active) return active;
    }
    return navSessions[0];
  }, [navSessions, highlightedKey, trimmedSearchQuery, activeSessionID, getSessionSelectionKey]);

  const highlightedSessionKey = highlightedSession ? getSessionSelectionKey(highlightedSession) : null;
  const highlightedIndex = highlightedSession ? navSessions.indexOf(highlightedSession) : -1;
  const listboxId = useId();
  const keyboardNavigationEnabled = !renderSessions && !manageMode;
  const isSearchPending = trimmedSearchQuery !== search || isPlaceholderData;

  const handleTogglePin = (session: Session) => {
    const directory = session.location.directory;
    const key = getSessionSelectionKey(session);
    togglePin.mutate({ sessionId: session.id, directory, pinned: !pinnedKeys.has(key) });
  };

  const handleRetryNextPage = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const handleSessionsScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight <= 240 && hasNextPage && !isFetchingNextPage && !isFetchNextPageError && !isPlaceholderData) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, isPlaceholderData, fetchNextPage]);

  useEffect(() => {
    const sessionList = sessionListRef.current;
    const isNearBottom = sessionList
      ? sessionList.scrollHeight - sessionList.scrollTop - sessionList.clientHeight <= 240
      : filteredSessions.length === 0;
    if (
      !isLoading
      && !isPlaceholderData
      && isNearBottom
      && hasNextPage
      && !isFetchingNextPage
      && !isFetchNextPageError
    ) {
      void fetchNextPage();
    }
  }, [isLoading, isPlaceholderData, filteredSessions, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  useEffect(() => {
    if (!highlightedSessionKey) return;
    const list = sessionListRef.current;
    if (!list) return;
    const highlighted = list.querySelector<HTMLElement>('[data-highlighted="true"]');
    if (highlighted && typeof highlighted.scrollIntoView === 'function') {
      highlighted.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedSessionKey]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!keyboardNavigationEnabled) return;
    if (event.nativeEvent.isComposing) return;
    if (event.altKey || event.metaKey) return;

    const selectIndex = (index: number) => {
      const session = navSessions[index];
      if (!session) return false;
      setHighlightedKey(getSessionSelectionKey(session));
      return true;
    };
    const moveBy = (delta: number) => {
      const count = navSessions.length;
      if (count === 0) return false;
      return selectIndex(((highlightedIndex + delta) % count + count) % count);
    };
    const moveClamped = (delta: number) => {
      const count = navSessions.length;
      if (count === 0) return false;
      return selectIndex(Math.min(Math.max(highlightedIndex + delta, 0), count - 1));
    };

    if (event.ctrlKey) {
      if (event.key.toLowerCase() === 'n') {
        if (moveBy(1)) event.preventDefault();
      } else if (event.key.toLowerCase() === 'p') {
        if (moveBy(-1)) event.preventDefault();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        if (moveBy(1)) event.preventDefault();
        break;
      case 'ArrowUp':
        if (moveBy(-1)) event.preventDefault();
        break;
      case 'PageDown':
        if (moveClamped(10)) event.preventDefault();
        break;
      case 'PageUp':
        if (moveClamped(-10)) event.preventDefault();
        break;
      case 'Enter':
        if (highlightedSession) {
          event.preventDefault();
          onSelectSession(highlightedSession.id);
        }
        break;
      default:
        break;
    }
  };

  const getDeleteTarget = (session: Session): DeleteSessionTarget => ({
    id: session.id,
    directory: session.location.directory,
  });

  const handleDelete = (session: Session, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setSessionToDelete(getDeleteTarget(session));
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (sessionToDelete) {
      await deleteSession.mutateAsync(sessionToDelete);
      setDeleteDialogOpen(false);
      setSessionToDelete(null);
      setSelectedSessions(new Set());
      setManageMode(false);
    }
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setSessionToDelete(null);
    setSelectedSessions(new Set());
    setManageMode(false);
  };

  const toggleSessionSelection = (session: Session, selected: boolean) => {
    const selectionKey = getSessionSelectionKey(session);
    const newSelected = new Set(selectedSessions);
    if (selected) {
      newSelected.add(selectionKey);
    } else {
      newSelected.delete(selectionKey);
    }
    setSelectedSessions(newSelected);
  };

  const allVisibleSelected =
    filteredSessions.length > 0 &&
    filteredSessions.every((session) => selectedSessions.has(getSessionSelectionKey(session)));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedSessions(new Set());
    } else {
      setSelectedSessions(new Set(filteredSessions.map(getSessionSelectionKey)));
    }
  };

  const handleBulkDelete = () => {
    if (selectedSessions.size > 0) {
      const selectedTargets = filteredSessions
        .filter((session) => selectedSessions.has(getSessionSelectionKey(session)))
        .map(getDeleteTarget);
      if (selectedTargets.length === 0) return;
      setSessionToDelete(selectedTargets);
      setDeleteDialogOpen(true);
    }
  };

  const renderSessionCard = (session: (typeof filteredSessions)[number], isPinned: boolean) => {
    const key = getSessionSelectionKey(session);
    const card = (
      <SessionCard
        key={key}
        session={session}
        isSelected={selectedSessions.has(key)}
        isActive={activeSessionID === session.id}
        manageMode={manageMode}
        isPinned={isPinned}
        onSelect={onSelectSession}
        onToggleSelection={(selected) => toggleSessionSelection(session, selected)}
        onTogglePin={() => handleTogglePin(session)}
        onDelete={(e) => handleDelete(session, e)}
      />
    );
    if (!keyboardNavigationEnabled) return card;
    const index = navSessions.indexOf(session);
    const isHighlighted = highlightedSession === session;
    return (
      <div
        key={key}
        id={`${listboxId}-option-${index}`}
        role="option"
        aria-selected={isHighlighted}
        data-highlighted={isHighlighted ? 'true' : undefined}
        className={isHighlighted ? 'rounded-lg ring-2 ring-primary/60' : undefined}
      >
        {card}
      </div>
    );
  };

  if (!isLoading && !isPlaceholderData && (!sessions || sessions.length === 0)) {
    if (isFetchNextPageError) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
          <p>Failed to load sessions.</p>
          <Button variant="outline" size="sm" onClick={handleRetryNextPage} disabled={isFetchingNextPage}>
            Retry
          </Button>
        </div>
      );
    }
    if ((hasNextPage || isFetchingNextPage) && !renderSessions) {
      return <div className="p-4 text-sm text-muted-foreground">Loading sessions...</div>;
    }
    if (!searchQuery.trim() && !renderSessions) {
      return (
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-4 min-h-0 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
          <Card
            className="p-6 cursor-pointer hover:bg-accent hover:border-border transition-all border-dashed"
            onClick={() => createSession.mutate({ agent: undefined })}
          >
            <div className="flex flex-col items-center justify-center gap-2 text-center">
              <p className="font-medium">No sessions yet</p>
              <p className="text-sm text-muted-foreground">
                Click here to start a new session
              </p>
            </div>
          </Card>
        </div>
      );
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-2 flex-shrink-0">
        {manageMode ? (
          <div className="flex items-center gap-2 bg-accent/50 rounded-md p-2">
            <span className="text-sm font-medium text-foreground shrink-0">
              {selectedSessions.size} selected
            </span>
            <Button variant="ghost" onClick={toggleSelectAll} className="shrink-0 h-9 text-xs" size="sm">
              {allVisibleSelected ? "Unselect All" : "Select All"}
            </Button>
            <Button
              variant="ghost"
              onClick={handleBulkDelete}
              disabled={selectedSessions.size === 0}
              className="shrink-0 h-9 text-xs text-destructive hover:text-destructive"
              size="sm"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Delete
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { setSelectedSessions(new Set()); setManageMode(false); }}
              className="shrink-0 size-9 ml-auto text-destructive hover:text-destructive"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="pl-9 h-9"
                autoComplete="off"
                name="session-search"
                role={keyboardNavigationEnabled ? 'combobox' : undefined}
                aria-expanded={keyboardNavigationEnabled ? true : undefined}
                aria-controls={keyboardNavigationEnabled ? listboxId : undefined}
                aria-activedescendant={keyboardNavigationEnabled && highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined}
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Manage sessions"
              className="shrink-0 size-9"
              onClick={() => {
                setManageMode(true);
              }}
            >
              <Pencil className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      <div
        ref={sessionListRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-4 min-h-0 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]"
        role="region"
        aria-label="Sessions"
        onScroll={handleSessionsScroll}
      >
        <div
          id={keyboardNavigationEnabled ? listboxId : undefined}
          role={keyboardNavigationEnabled ? 'listbox' : undefined}
          className="flex flex-col gap-4"
        >
          {isLoading && !renderSessions ? (
            <div className="text-sm text-muted-foreground text-center py-4">Loading sessions...</div>
          ) : renderSessions ? (
            renderSessions({
              sessions: filteredSessions,
              searchQuery,
              renderSessionCard: (session) => renderSessionCard(session, pinnedKeys.has(getSessionSelectionKey(session))),
            })
          ) : filteredSessions.length === 0 && !isFetchingNextPage ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              {isSearchPending ? 'Searching sessions...' : 'No sessions found'}
            </div>
          ) : (
            <>
              {pinnedSessions.length > 0 && (
                <>
                  <div className="text-xs font-semibold text-muted-foreground px-1 py-2">Pinned</div>
                  {pinnedSessions.map((session) => renderSessionCard(session, true))}
                  {(todaySessions.length > 0 || olderSessions.length > 0) && (
                    <div className="my-2 h-px bg-border/80" />
                  )}
                </>
              )}

              {todaySessions.length > 0 && (
                <>
                  <div className="text-xs font-semibold text-muted-foreground px-1 py-2">
                    Today
                  </div>
                  {todaySessions.map((session) => renderSessionCard(session, false))}
                </>
              )}

              {todaySessions.length > 0 && olderSessions.length > 0 && (
                <div className="my-2 h-px bg-border/80" />
              )}
              {olderSessions.map((session) => renderSessionCard(session, false))}
            </>
          )}
          {isFetchNextPageError && (sessions?.length ?? 0) > 0 && (
            <div className="flex flex-col items-center gap-2 py-4">
              <p className="text-sm text-muted-foreground">Failed to load more sessions.</p>
              <Button variant="outline" size="sm" onClick={handleRetryNextPage} disabled={isFetchingNextPage}>
                Retry
              </Button>
            </div>
          )}
          {isFetchingNextPage && (sessions?.length ?? 0) > 0 && (
            <div className="text-sm text-muted-foreground text-center py-4">
              Loading more sessions...
            </div>
          )}
        </div>
      </div>

      <DeleteSessionDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        isDeleting={deleteSession.isPending}
        sessionCount={Array.isArray(sessionToDelete) ? sessionToDelete.length : 1}
      />
    </div>
  );
};
