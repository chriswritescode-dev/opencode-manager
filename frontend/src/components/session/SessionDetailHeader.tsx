import { BackButton } from "@/components/ui/back-button";
import { ContextUsageIndicator } from "@/components/session/ContextUsageIndicator";
import { BranchSwitcher } from "@/components/repo/BranchSwitcher";
import { Button } from "@/components/ui/button";
import { Loader2, Settings, FolderOpen } from "lucide-react";
import { useState } from "react";

interface Repo {
  id: number;
  repoUrl: string;
  fullPath: string;
  localPath: string;
  currentBranch?: string;
  isWorktree?: boolean;
  cloneStatus: 'ready' | 'cloning' | 'error';
}

interface SessionDetailHeaderProps {
  repo: Repo;
  sessionId: string;
  sessionTitle: string;
  repoId: number;
  isConnected: boolean;
  opcodeUrl: string | null;
  repoDirectory: string | undefined;
  onFileBrowserOpen: () => void;
  onSettingsOpen: () => void;
  onSessionTitleUpdate: (newTitle: string) => void;
}

export function SessionDetailHeader({
  repo,
  sessionId,
  sessionTitle,
  repoId,
  isConnected,
  opcodeUrl,
  repoDirectory,
  onFileBrowserOpen,
  onSettingsOpen,
  onSessionTitleUpdate,
}: SessionDetailHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(sessionTitle);

  if (repo.cloneStatus !== 'ready') {
    return (
      <div className="sticky top-0 z-10 border-b border-border bg-gradient-to-b from-background via-background to-background backdrop-blur-sm px-2 sm:px-4 py-1.5 sm:py-2">
        <div className="flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mr-2" />
          <span className="text-sm text-muted-foreground">
            {repo.cloneStatus === 'cloning' ? 'Cloning repository...' : 'Repository not ready'}
          </span>
        </div>
      </div>
    );
  }

  const repoName = repo.repoUrl.split("/").pop()?.replace(".git", "") || "Repository";
  const currentBranch = repo.currentBranch || "main";

  const handleTitleClick = () => {
    setIsEditing(true);
    setEditTitle(sessionTitle);
  };

  const handleTitleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editTitle.trim() && editTitle !== sessionTitle) {
      onSessionTitleUpdate(editTitle.trim());
    }
    setIsEditing(false);
  };

  const handleTitleBlur = () => {
    if (editTitle.trim() && editTitle !== sessionTitle) {
      onSessionTitleUpdate(editTitle.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditTitle(sessionTitle);
      setIsEditing(false);
    } else if (e.key === 'Enter') {
      handleTitleSubmit(e);
    }
  };

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-gradient-to-b from-background via-background to-background backdrop-blur-sm px-2 sm:px-4 py-1.5 sm:py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
          <BackButton to={`/repos/${repoId}`} className="text-xs sm:text-sm" />
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <form onSubmit={handleTitleSubmit} className="min-w-0">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={handleKeyDown}
                  className="text-xs sm:text-base font-semibold bg-background border border-border rounded px-1 outline-none w-full truncate focus:border-primary sm:max-w-[250px]"
                  autoFocus
                />
              </form>
            ) : (
              <h1 
                className="text-xs sm:text-base font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent truncate cursor-pointer hover:opacity-80 transition-opacity"
                onClick={handleTitleClick}
              >
                {sessionTitle}
              </h1>
            )}
            <div className="flex items-center gap-2">
              <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                {repoName}
              </p>
              <BranchSwitcher
                repoId={repoId}
                currentBranch={currentBranch}
                isWorktree={repo.isWorktree}
                repoUrl={repo.repoUrl}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
          <div className="hidden sm:block">
            <ContextUsageIndicator
              opcodeUrl={opcodeUrl}
              sessionID={sessionId}
              directory={repoDirectory}
            />
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <div
              className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}
            />
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onFileBrowserOpen}
            className="text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
          >
            <FolderOpen className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onSettingsOpen}
            className="text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
