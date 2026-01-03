import { useState, useMemo } from "react";
import { useSessions, useDeleteSession } from "@/hooks/useOpenCode";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { SessionCard } from "./SessionCard";
import { Trash2, Search, MoreVertical } from "lucide-react";

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

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-2 pb-3 flex-shrink-0 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          {filteredSessions && filteredSessions.length > 0 && (
            <Button
              onClick={toggleSelectAll}
              variant={selectedSessions.size > 0 ? "default" : "outline"}
              className="whitespace-nowrap hidden md:flex"
            >
              {filteredSessions.every((session) =>
                selectedSessions.has(session.id),
              )
                ? "Deselect All"
                : "Select All"}
            </Button>
          )}
          <Button
            onClick={handleBulkDelete}
            variant="destructive"
            disabled={selectedSessions.size === 0}
            className="hidden md:flex whitespace-nowrap"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete ({selectedSessions.size})
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="md:hidden"
                disabled={filteredSessions.length === 0}
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {filteredSessions.length > 0 && (
                <DropdownMenuItem onClick={toggleSelectAll}>
                  {filteredSessions.every((session) =>
                    selectedSessions.has(session.id),
                  )
                    ? "Deselect All"
                    : "Select All"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem 
                onClick={handleBulkDelete}
                disabled={selectedSessions.size === 0}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete ({selectedSessions.size})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 min-h-0">
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
