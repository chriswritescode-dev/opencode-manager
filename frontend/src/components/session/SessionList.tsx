import { useCallback, useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useDeleteSession, useCreateSession } from "@/hooks/useOpenCode";
import type { DeleteSessionTarget } from "@/hooks/useOpenCode";
import type { Session } from "@/api/types";
import { useSessionPins, useToggleSessionPin } from '@/hooks/useSessionPins';
import { buildSessionKey, buildPinnedSessionKeys } from '@/lib/sessionKey';
import { partitionSessions } from './session-partition';
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { SessionCard } from "./SessionCard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Pencil, X } from "lucide-react";
import { useSessionSearch } from "@/hooks/useSessionSearch";

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
  const primaryDirectory = directoriesList[0];
  const sessionCreateDirectory = createDirectory ?? primaryDirectory;
  const getSessionSelectionKey = useCallback((session: Session) =>
    buildSessionKey(session.location.directory, session.id),
  []);
  const {
    query,
    setQuery,
    trimmedQuery,
    sessions,
    filteredSessions,
    isSearchPending,
    isLoading,
    isPlaceholderData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    canFetchNextPage,
  } = useSessionSearch(directoriesList);
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

  const { pinned: pinnedSessions, today: todaySessions, older: olderSessions } = useMemo(
    () => partitionSessions(filteredSessions, pinnedKeys, getSessionSelectionKey),
    [filteredSessions, pinnedKeys, getSessionSelectionKey],
  );

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
    if (scrollHeight - scrollTop - clientHeight <= 240 && canFetchNextPage) {
      void fetchNextPage();
    }
  }, [canFetchNextPage, fetchNextPage]);

  useEffect(() => {
    const sessionList = sessionListRef.current;
    const isNearBottom = sessionList
      ? sessionList.scrollHeight - sessionList.scrollTop - sessionList.clientHeight <= 240
      : filteredSessions.length === 0;
    if (!isLoading && isNearBottom && canFetchNextPage) {
      void fetchNextPage();
    }
  }, [isLoading, filteredSessions, canFetchNextPage, fetchNextPage]);

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
    return (
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
    if (!trimmedQuery && !renderSessions) {
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
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9 h-9"
                autoComplete="off"
                name="session-search"
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
        <div className="flex flex-col gap-4">
          {isLoading && !renderSessions ? (
            <div className="text-sm text-muted-foreground text-center py-4">Loading sessions...</div>
          ) : renderSessions ? (
            renderSessions({
              sessions: filteredSessions,
              searchQuery: query,
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
