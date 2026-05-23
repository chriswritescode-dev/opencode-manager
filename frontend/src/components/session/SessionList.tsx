import { useState, useMemo } from "react";
import { useSessions, useDeleteSession, useCreateSession } from "@/hooks/useOpenCode";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { SessionCard } from "./SessionCard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Pencil, X } from "lucide-react";

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
  const createSession = useCreateSession(opcodeUrl, directory, (newSession) => {
    onSelectSession(newSession.id);
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | string[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return filteredSessions.filter((session) => new Date(session.time.updated) >= today);
  }, [filteredSessions]);

  const olderSessions = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return filteredSessions.filter((session) => new Date(session.time.updated) < today);
  }, [filteredSessions]);

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading sessions...</div>;
  }

  if (!sessions || sessions.length === 0) {
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

  const handleDelete = (sessionId: string, e: React.MouseEvent<HTMLButtonElement>) => {
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
      setManageMode(false);
    }
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setSessionToDelete(null);
    setSelectedSessions(new Set());
    setManageMode(false);
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

  const allVisibleSelected =
    filteredSessions.length > 0 &&
    filteredSessions.every((s) => selectedSessions.has(s.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedSessions(new Set());
    } else {
      setSelectedSessions(new Set(filteredSessions.map((s) => s.id)));
    }
  };

  const handleBulkDelete = () => {
    if (selectedSessions.size > 0) {
      setSessionToDelete(Array.from(selectedSessions));
      setDeleteDialogOpen(true);
    }
  };

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
                className="pl-9 h-9"
                autoComplete="off"
                name="session-search"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
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

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-4 min-h-0 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
        <div className="flex flex-col gap-4">
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
                      onToggleSelection={(selected) => toggleSessionSelection(session.id, selected)}
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
                  onToggleSelection={(selected) => toggleSessionSelection(session.id, selected)}
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
        sessionCount={Array.isArray(sessionToDelete) ? sessionToDelete.length : 1}
      />
    </div>
  );
};
