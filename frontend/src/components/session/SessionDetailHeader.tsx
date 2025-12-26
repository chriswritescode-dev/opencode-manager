import { BackButton } from "@/components/ui/back-button";
import { ContextUsageIndicator } from "@/components/session/ContextUsageIndicator";
import { BranchSwitcher } from "@/components/repo/BranchSwitcher";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Loader2, Settings, CornerUpLeft, Plug, FolderOpen, MoreVertical } from "lucide-react";
import { useState } from "react";

interface Repo {
  id: number;
  repoUrl?: string | null;
  fullPath: string;
  localPath: string;
  currentBranch?: string;
  isWorktree?: boolean;
  isLocal?: boolean;
  cloneStatus: 'ready' | 'cloning' | 'error';
}

interface SessionDetailHeaderProps {
  repo: Repo;
  sessionId: string;
  sessionTitle: string;
  repoId: number;
  isConnected: boolean;
  isReconnecting?: boolean;
  opcodeUrl: string | null;
  repoDirectory: string | undefined;
  parentSessionId?: string;
  onFileBrowserOpen: () => void;
  onSettingsOpen: () => void;
  onMcpDialogOpen: () => void;
  onSessionTitleUpdate: (newTitle: string) => void;
  onParentSessionClick?: () => void;
}

export function SessionDetailHeader({
  repo,
  sessionId,
  sessionTitle,
  repoId,
  isConnected,
  isReconnecting,
  opcodeUrl,
  repoDirectory,
  parentSessionId,
  onFileBrowserOpen,
  onSettingsOpen,
  onMcpDialogOpen,
  onSessionTitleUpdate,
  onParentSessionClick,
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

  const repoName = repo.repoUrl?.split("/").pop()?.replace(".git", "") || repo.localPath || "Repository";
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
          {parentSessionId ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onParentSessionClick}
                className="text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/20 h-7 px-2 gap-1"
                title="Back to parent session"
              >
                <CornerUpLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline text-xs">Parent</span>
              </Button>
              <div className="hidden sm:block">
                <BackButton to={`/repos/${repoId}`} className="text-xs sm:text-sm" />
              </div>
            </>
          ) : (
            <BackButton to={`/repos/${repoId}`} className="text-xs sm:text-sm" />
          )}
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <form onSubmit={handleTitleSubmit} className="min-w-0">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={handleKeyDown}
                  className="text-[16px] sm:text-base font-semibold bg-background border border-border rounded px-1 outline-none w-full truncate focus:border-primary sm:max-w-[250px]"
                  autoFocus
                />
              </form>
            ) : (
              <h1 
                className="text-xs text-green-500 sm:text-base font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent truncate cursor-pointer hover:opacity-80 transition-opacity"
                onClick={handleTitleClick}
              >
                {sessionTitle}
              </h1>
            )}
            <p className="text-[10px] sm:text-xs text-green-600 dark:text-green-400 truncate">
              {repoName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
          <div>
            <ContextUsageIndicator
              opcodeUrl={opcodeUrl}
              sessionID={sessionId}
              directory={repoDirectory}
              isConnected={isConnected}
              isReconnecting={isReconnecting}
            />
          </div>
          <BranchSwitcher
            repoId={repoId}
            currentBranch={currentBranch}
            isWorktree={repo.isWorktree}
            repoUrl={repo.repoUrl}
            repoLocalPath={repo.localPath}
            className="max-w-[80px] sm:w-[140px] sm:max-w-[140px]"
            iconOnly
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={onFileBrowserOpen}
            className="hidden sm:flex text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
            title="Files"
          >
            <FolderOpen className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onMcpDialogOpen}
            className="hidden sm:flex text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
            title="MCP Servers"
          >
            <Plug className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onSettingsOpen}
            className="hidden sm:flex text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="sm:hidden text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
                title="Options"
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <div className="px-2 py-1.5">
                <BranchSwitcher
                  repoId={repoId}
                  currentBranch={currentBranch}
                  isWorktree={repo.isWorktree}
                  repoUrl={repo.repoUrl}
                  repoLocalPath={repo.localPath}
                  iconOnly={false}
                  className="w-full"
                />
              </div>
              <div className="h-px bg-border my-1" />
              <DropdownMenuItem onClick={onFileBrowserOpen}>
                <FolderOpen className="w-4 h-4 mr-2" /> Files
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onMcpDialogOpen}>
                <Plug className="w-4 h-4 mr-2" /> MCP
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onSettingsOpen}>
                <Settings className="w-4 h-4 mr-2" /> Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
