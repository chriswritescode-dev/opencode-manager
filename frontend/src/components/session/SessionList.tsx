import { useState, useMemo } from "react";
import { useSessions, useDeleteSession } from "@/hooks/useOpenCode";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { SessionCard } from "./SessionCard";

interface SessionListProps {
  opcodeUrl: string;
  directory?: string;
  activeSessionID?: string;
  onSelectSession: (sessionID: string) => void;
}

export const SessionList = ({
  opcodeUrl,
  directory,
  activeSessionID,
  onSelectSession,
}: SessionListProps) => {
  const { data: sessions, isLoading } = useSessions(opcodeUrl, directory);
  const deleteSession = useDeleteSession(opcodeUrl, directory);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<
    string | string[] | null
  >(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(
    new Set(),
  );
  const [manageMode, setManageMode] = useState(false);

  const filteredSessions = useMemo(() => {
    if (!sessions) return [];

    let filtered = sessions.filter((session) => {
      if (session.parentID) return false;
      if (directory && session.directory && session.directory !== directory) return false;
      return true;
    });

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((session) =>
        (session.title || "Untitled Session").toLowerCase().includes(query),
      );
    }

    return filtered.sort((a, b) => b.time.updated - a.time.updated);
  }, [sessions, searchQuery, directory]);

  const todaySessions = useMemo(() => {
    if (!filteredSessions) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return filteredSessions.filter((session) => new Date(session.time.updated) >= today);
  }, [filteredSessions]);

  const olderSessions = useMemo(() => {
    if (!filteredSessions) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return filteredSessions.filter((session) => new Date(session.time.updated) < today);
  }, [filteredSessions]);

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading sessions...</div>;
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No sessions yet. Create one to get started.
      </div>
    );
  }

  const handleDelete = (
    sessionId: string,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation();
    setSessionToDelete(sessionId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (sessionToDelete) {
      await deleteSession.mutateAsync(sessionToDelete);
      setDeleteDialogOpen(false);
      setSessionToDelete(null);
      setSelectedSessions(new Set());
    }
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setSessionToDelete(null);
    setSelectedSessions(new Set());
  };

  const toggleSessionSelection = (sessionId: string, selected: boolean) => {
    const newSelected = new Set(selectedSessions);
    if (selected) {
      newSelected.add(sessionId);
    } else {
      newSelected.delete(sessionId);
    }
    setSelectedSessions(newSelected);
  };

  const toggleManageMode = () => {
    setManageMode((prev) => {
      if (!prev) {
        return true;
      } else {
        setSelectedSessions(new Set());
        return false;
      }
    });
  };

  const toggleSelectAll = () => {
    if (!filteredSessions || filteredSessions.length === 0) return;
    
    const allFilteredSelected = filteredSessions.every((session) =>
      selectedSessions.has(session.id),
    );

    if (allFilteredSelected) {
      setSelectedSessions(new Set());
    } else {
      const filteredIds = filteredSessions.map((s) => s.id);
      setSelectedSessions(new Set(filteredIds));
    }
  };

  const handleBulkDelete = () => {
    if (selectedSessions.size > 0) {
      setSessionToDelete(Array.from(selectedSessions));
      setDeleteDialogOpen(true);
    }
  };

  const handleDeleteAll = () => {
    if (!filteredSessions || filteredSessions.length === 0) return;
    setSessionToDelete(filteredSessions.map((s) => s.id));
    setDeleteDialogOpen(true);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-2 flex-shrink-0">
        <ListToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedCount={selectedSessions.size}
          totalCount={filteredSessions.length}
          allSelected={
            filteredSessions.length > 0 &&
            filteredSessions.every((session) => selectedSessions.has(session.id))
          }
          onToggleSelectAll={toggleSelectAll}
          onDelete={handleBulkDelete}
          onDeleteAll={handleDeleteAll}
          manageMode={manageMode}
          onToggleManageMode={toggleManageMode}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-4 min-h-0 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
        <div className="flex flex-col gap-2">
          {filteredSessions.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              No sessions found
            </div>
          ) : (
            <>
              {todaySessions.length > 0 && (
                <>
                  <div className="text-xs font-semibold text-muted-foreground px-1 py-2">
                    Today
                  </div>
                  {todaySessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      isSelected={selectedSessions.has(session.id)}
                      isActive={activeSessionID === session.id}
                      manageMode={manageMode}
                      onSelect={onSelectSession}
                      onToggleSelection={(selected) => {
                        toggleSessionSelection(session.id, selected);
                      }}
                      onDelete={(e) => handleDelete(session.id, e)}
                    />
                  ))}
                </>
              )}

              {todaySessions.length > 0 && olderSessions.length > 0 && (
                <div className="my-2 h-px bg-border/80" />
              )}
              {olderSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  isSelected={selectedSessions.has(session.id)}
                  isActive={activeSessionID === session.id}
                  manageMode={manageMode}
                  onSelect={onSelectSession}
                  onToggleSelection={(selected) => {
                    toggleSessionSelection(session.id, selected);
                  }}
                  onDelete={(e) => handleDelete(session.id, e)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      <DeleteSessionDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        isDeleting={deleteSession.isPending}
        sessionCount={
          Array.isArray(sessionToDelete) ? sessionToDelete.length : 1
        }
      />
    </div>
  );
};
