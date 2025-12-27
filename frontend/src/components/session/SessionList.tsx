import { useState, useMemo } from "react";
import { useSessions, useDeleteSession } from "@/hooks/useOpenCode";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { Trash2, Clock, Search, MoreVertical } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
      <div className="p-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
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

      <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
        <div className="flex flex-col gap-2">
          {filteredSessions.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              No sessions found
            </div>
          ) : (
            filteredSessions.map((session) => (
              <Card
                key={session.id}
                className={`p-3 cursor-pointer transition-all ${
                  selectedSessions.has(session.id)
                    ? "border-blue-500 shadow-lg shadow-blue-900/30 dark:shadow-blue-900/30 bg-accent"
                    : activeSessionID === session.id
                      ? "bg-accent border-border"
                      : "bg-card border-border hover:bg-accent hover:border-border"
                } hover:shadow-lg`}
                onClick={() => onSelectSession(session.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <Checkbox
                      checked={selectedSessions.has(session.id)}
                      onCheckedChange={(checked) => {
                        toggleSessionSelection(session.id, checked === true);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className="w-5 h-5 flex-shrink-0 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-foreground truncate">
                        {session.title || "Untitled Session"}
                      </h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(session.time.updated), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    className="h-6 w-6 p-0 text-foreground hover:text-red-600 dark:hover:text-red-400 bg-transparent border-none cursor-pointer"
                    onClick={(e) => handleDelete(session.id, e)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            ))
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
